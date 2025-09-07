const express = require("express");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Setting = require("../models/setting");
const verifyToken = require("../middleware/verify-token");
const requireRole = require("../middleware/require-role");

const router = express.Router();

function makeOAuth() {
  return new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI
  );
}

// ---------- helpers ----------
function googleErr(res, err) {
  const status = err?.response?.status || 500;
  const msg =
    err?.response?.data?.error?.message || err.message || "Unknown error";
  return res.status(status).json({ error: msg });
}

async function getClinicOAuth() {
  const tokens = await Setting.get("google_app_tokens");
  if (!tokens || !tokens.access_token) return null;
  const oauth2 = makeOAuth();
  oauth2.setCredentials(tokens);
  // keep tokens fresh in DB
  oauth2.on("tokens", async (t) => {
    const merged = { ...(tokens || {}), ...t };
    await Setting.set("google_app_tokens", merged);
  });
  return oauth2;
}

async function requireClinicOAuth(req, res, next) {
  try {
    const oauth = await getClinicOAuth();
    if (!oauth)
      return res.status(401).json({ error: "Clinic Google not connected" });
    req.oauth = oauth;
    next();
  } catch (e) {
    next(e);
  }
}

// Create a secondary calendar owned by the clinic account
async function createClinicCalendar(oauth2, summary) {
  const calendar = google.calendar({ version: "v3", auth: oauth2 });
  const { data } = await calendar.calendars.insert({
    requestBody: { summary },
  });
  await calendar.calendarList
    .insert({ requestBody: { id: data.id } })
    .catch(() => {});
  return data.id; // calendarId
}

// Ensure the provider has a clinic-owned calendar (group id)
async function ensureClinicOwnedCalendar(oauth2, provider) {
  if (
    !provider.calendarId ||
    !String(provider.calendarId).includes("@group.calendar.google.com")
  ) {
    const title = provider.displayName?.trim() || provider.username;
    const id = await createClinicCalendar(oauth2, title);
    provider.calendarId = id;
    await provider.save();
  }
}

// ---------- App-level OAuth (admin only) ----------
router.get(
  "/oauth/google/app",
  verifyToken,
  requireRole("admin"),
  (req, res) => {
    const oauth2 = makeOAuth();
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state: jwt.sign({ by: req.user._id }, process.env.JWT_SECRET, {
        expiresIn: "30m",
      }),
    });
    res.redirect(url);
  }
);

// JSON endpoint to fetch Auth URL (so we can include Bearer token)
router.get(
  "/oauth/google/app/url",
  verifyToken,
  requireRole("admin"),
  (req, res) => {
    const oauth2 = makeOAuth();
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state: jwt.sign(
        { by: req.user._id, ts: Date.now() },
        process.env.JWT_SECRET,
        { expiresIn: "10m" }
      ),
    });
    res.json({ url });
  }
);

// Callback saves tokens to Settings
router.get("/oauth/google/app/callback", async (req, res, next) => {
  try {
    const oauth2 = makeOAuth();
    const { tokens } = await oauth2.getToken(req.query.code);
    await Setting.set("google_app_tokens", tokens);
    req.session.tokens = tokens;
    res.redirect("http://localhost:5173/connected");
  } catch (err) {
    next(err);
  }
});

// Disconnect clinic tokens
router.post(
  "/oauth/google/app/disconnect",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    await Setting.set("google_app_tokens", null);
    res.json({ ok: true });
  }
);

// For debugging: list calendars for the clinic account
router.get(
  "/api/gcal/calendars",
  verifyToken,
  requireRole("admin", "reception", "provider"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      const calendar = google.calendar({ version: "v3", auth: req.oauth });
      const { data } = await calendar.calendarList.list({ maxResults: 250 });
      res.json(
        (data.items || []).map((c) => ({
          id: c.id,
          summary: c.summary,
          accessRole: c.accessRole,
        }))
      );
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// ---------- Provider calendar bootstrap (admin/reception) ----------
router.post(
  "/api/gcal/providers/:id/ensure-calendar",
  verifyToken,
  requireRole("admin", "reception"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      const provider = await User.findOne({
        _id: req.params.id,
        role: "provider",
        active: true,
      });
      if (!provider)
        return res
          .status(404)
          .json({ error: "Provider not found or inactive" });

      await ensureClinicOwnedCalendar(req.oauth, provider);

      return res.json({
        ok: true,
        providerId: String(provider._id),
        calendarId: provider.calendarId,
      });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// ---------- Event APIs (use clinic tokens) ----------

// Create (double-booking protected)
router.post(
  "/api/gcal/events",
  verifyToken,
  requireRole("admin", "reception", "provider"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      const {
        providerId,
        summary,
        description,
        startISO,
        endISO,
        attendeeEmails = [],
      } = req.body;

      let effectiveProviderId = providerId;
      if (req.user.role === "provider") effectiveProviderId = req.user._id;
      else if (!effectiveProviderId)
        return res.status(400).json({ error: "providerId is required" });

      if (!startISO || !endISO)
        return res
          .status(400)
          .json({ error: "startISO and endISO are required" });
      if (new Date(startISO) >= new Date(endISO))
        return res.status(400).json({ error: "endISO must be after startISO" });

      const provider = await User.findOne({
        _id: effectiveProviderId,
        role: "provider",
        active: true,
      });
      if (!provider)
        return res
          .status(404)
          .json({ error: "Provider user not found or inactive" });

      await ensureClinicOwnedCalendar(req.oauth, provider);

      const calendar = google.calendar({ version: "v3", auth: req.oauth });

      // free/busy check
      const { data: fb } = await calendar.freebusy.query({
        requestBody: {
          timeMin: startISO,
          timeMax: endISO,
          items: [{ id: provider.calendarId }],
        },
      });
      const busy = fb?.calendars?.[provider.calendarId]?.busy || [];
      if (busy.length) {
        const first = busy[0];
        return res.status(409).json({
          ok: false,
          error: "Time range is already booked for this provider.",
          providerName: provider.displayName || provider.username,
          conflict: first ? { start: first.start, end: first.end } : null,
        });
      }

      const { data } = await calendar.events.insert({
        calendarId: provider.calendarId,
        requestBody: {
          summary,
          description,
          start: { dateTime: startISO },
          end: { dateTime: endISO },
          attendees: attendeeEmails.map((email) => ({ email })),
          reminders: { useDefault: true },
        },
      });

      res.json({
        ok: true,
        providerId: String(provider._id),
        eventId: data.id,
        htmlLink: data.htmlLink,
      });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// Agenda (single day)
router.get(
  "/api/gcal/agenda",
  verifyToken,
  requireRole("admin", "reception", "provider"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      let { day, providerId } = req.query;
      if (!day) return res.status(400).json({ error: "day is required" });

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      const provider = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!provider)
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid" });

      await ensureClinicOwnedCalendar(req.oauth, provider);

      const start = new Date(`${day}T00:00:00Z`).toISOString();
      const end = new Date(`${day}T23:59:59Z`).toISOString();

      const calendar = google.calendar({ version: "v3", auth: req.oauth });
      const { data } = await calendar.events.list({
        calendarId: provider.calendarId,
        singleEvents: true,
        orderBy: "startTime",
        timeMin: start,
        timeMax: end,
      });

      res.json({ providerId, events: data.items || [] });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// Range
router.get(
  "/api/gcal/events-range",
  verifyToken,
  requireRole("admin", "reception", "provider"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      let { timeMin, timeMax, providerId } = req.query;
      if (!timeMin || !timeMax)
        return res
          .status(400)
          .json({ error: "timeMin and timeMax are required" });

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      const provider = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!provider)
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid" });

      await ensureClinicOwnedCalendar(req.oauth, provider);

      const calendar = google.calendar({ version: "v3", auth: req.oauth });
      const { data } = await calendar.events.list({
        calendarId: provider.calendarId,
        singleEvents: true,
        orderBy: "startTime",
        timeMin,
        timeMax,
      });

      res.json({ providerId, events: data.items || [] });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// Delete
router.delete(
  "/api/gcal/events/:eventId",
  verifyToken,
  requireRole("admin", "reception", "provider"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      const { eventId } = req.params;
      let { providerId } = req.query;

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      const provider = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!provider)
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid" });

      await ensureClinicOwnedCalendar(req.oauth, provider);

      const calendar = google.calendar({ version: "v3", auth: req.oauth });
      await calendar.events.delete({
        calendarId: provider.calendarId,
        eventId,
      });

      res.json({
        ok: true,
        providerId: String(provider._id),
        deletedEventId: eventId,
      });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// Patch
router.patch(
  "/api/gcal/events/:eventId",
  verifyToken,
  requireRole("admin", "reception", "provider"),
  requireClinicOAuth,
  async (req, res) => {
    try {
      const { eventId } = req.params;
      let { providerId } = req.query;
      const { summary, description, startISO, endISO, attendeeEmails } =
        req.body;

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      if ((startISO && !endISO) || (!startISO && endISO)) {
        return res.status(400).json({
          error: "Provide both startISO and endISO when changing times",
        });
      }
      if (startISO && endISO && new Date(startISO) >= new Date(endISO)) {
        return res.status(400).json({ error: "endISO must be after startISO" });
      }

      const provider = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!provider)
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid" });

      await ensureClinicOwnedCalendar(req.oauth, provider);

      const calendar = google.calendar({ version: "v3", auth: req.oauth });

      if (startISO && endISO) {
        const { data: fb } = await calendar.freebusy.query({
          requestBody: {
            timeMin: startISO,
            timeMax: endISO,
            items: [{ id: provider.calendarId }],
          },
        });
        const busy = fb?.calendars?.[provider.calendarId]?.busy || [];
        if (busy.length) {
          const first = busy[0];
          return res.status(409).json({
            ok: false,
            error: "Time range is already booked for this provider.",
            providerName: provider.displayName || provider.username,
            conflict: first ? { start: first.start, end: first.end } : null,
          });
        }
      }

      const requestBody = {};
      if (summary !== undefined) requestBody.summary = summary;
      if (description !== undefined) requestBody.description = description;
      if (startISO && endISO) {
        requestBody.start = { dateTime: startISO };
        requestBody.end = { dateTime: endISO };
      }
      if (Array.isArray(attendeeEmails)) {
        requestBody.attendees = attendeeEmails.map((email) => ({ email }));
      }

      const { data } = await calendar.events.patch({
        calendarId: provider.calendarId,
        eventId,
        requestBody,
      });

      res.json({
        ok: true,
        providerId: String(provider._id),
        eventId: data.id,
        htmlLink: data.htmlLink,
        updatedFields: Object.keys(requestBody),
      });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

module.exports = router;
