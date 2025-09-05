const express = require("express");
const { google } = require("googleapis");
const User = require("../models/user");
const verifyToken = require("../middleware/verify-token");
const requireRole = require("../middleware/require-role");
const { makeOAuth, requireGoogle, getFreeBusy } = require("../utils/google");

const router = express.Router();

// Small helper to surface Google HTTP codes instead of generic 500s
function googleErr(res, err) {
  const status = err?.response?.status || 500;
  const msg =
    err?.response?.data?.error?.message || err.message || "Unknown error";
  return res.status(status).json({ error: msg });
}

/* ---------- OAuth ---------- */

router.get("/oauth/google", (req, res) => {
  const oauth2 = makeOAuth();
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  });
  res.redirect(url);
});

router.get("/oauth/google/callback", async (req, res, next) => {
  try {
    const oauth2 = makeOAuth();
    const { tokens } = await oauth2.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect("http://localhost:5173/connected");
  } catch (err) {
    next(err);
  }
});

router.post("/oauth/google/disconnect", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get("/oauth/google/scopes", requireGoogle, (req, res) => {
  res.json({ scope: req.session.tokens?.scope || null });
});

/* ---------- Debug: list calendars ---------- */
router.get("/api/gcal/calendars", requireGoogle, async (req, res) => {
  try {
    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const { data } = await calendar.calendarList.list({ maxResults: 250 });

    res.json(
      (data.items || []).map((c) => ({
        id: c.id, // use this as provider.calendarId
        summary: c.summary,
        accessRole: c.accessRole, // owner | writer | reader | freeBusyReader
      }))
    );
  } catch (err) {
    return googleErr(res, err);
  }
});

/* ---------- Calendar APIs ---------- */

// Create event (double-booking protected)
router.post(
  "/api/gcal/events",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
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
      if (req.user.role === "provider") {
        effectiveProviderId = req.user._id;
      } else if (!effectiveProviderId) {
        return res.status(400).json({ error: "providerId is required" });
      }

      if (!startISO || !endISO) {
        return res
          .status(400)
          .json({ error: "startISO and endISO are required" });
      }
      if (new Date(startISO) >= new Date(endISO)) {
        return res.status(400).json({ error: "endISO must be after startISO" });
      }

      const providerUser = await User.findOne({
        _id: effectiveProviderId,
        role: "provider",
        active: true,
      });
      if (!providerUser) {
        return res
          .status(404)
          .json({ error: "Provider user not found or inactive" });
      }
      if (!providerUser.calendarId) {
        return res
          .status(400)
          .json({ error: "Provider has no calendarId configured" });
      }

      const oauth2 = makeOAuth();
      oauth2.setCredentials(req.session.tokens);

      const { free, busy } = await getFreeBusy(oauth2, {
        calendarId: providerUser.calendarId,
        startISO,
        endISO,
      });
      if (!free) {
        const first = busy[0] || null;
        return res.status(409).json({
          ok: false,
          error: "Time range is already booked for this provider.",
          providerName: providerUser.username,
          conflict: first ? { start: first.start, end: first.end } : null,
        });
      }

      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const { data } = await calendar.events.insert({
        calendarId: providerUser.calendarId,
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
        providerId: String(providerUser._id),
        eventId: data.id,
        htmlLink: data.htmlLink,
      });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// Agenda for a single day
router.get(
  "/api/gcal/agenda",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res) => {
    try {
      let { day, providerId } = req.query;
      if (!day) return res.status(400).json({ error: "day is required" });

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      const providerUser = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!providerUser || !providerUser.calendarId) {
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid calendarId" });
      }

      const start = new Date(`${day}T00:00:00Z`).toISOString();
      const end = new Date(`${day}T23:59:59Z`).toISOString();

      const oauth2 = makeOAuth();
      oauth2.setCredentials(req.session.tokens);
      const calendar = google.calendar({ version: "v3", auth: oauth2 });

      const { data } = await calendar.events.list({
        calendarId: providerUser.calendarId,
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
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res) => {
    try {
      let { timeMin, timeMax, providerId } = req.query;
      if (!timeMin || !timeMax) {
        return res
          .status(400)
          .json({ error: "timeMin and timeMax are required" });
      }

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      const providerUser = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!providerUser || !providerUser.calendarId) {
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid calendarId" });
      }

      const oauth2 = makeOAuth();
      oauth2.setCredentials(req.session.tokens);
      const calendar = google.calendar({ version: "v3", auth: oauth2 });

      const { data } = await calendar.events.list({
        calendarId: providerUser.calendarId,
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
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res) => {
    try {
      const { eventId } = req.params;
      let { providerId } = req.query;

      if (req.user.role === "provider") providerId = req.user._id;
      else if (!providerId)
        return res.status(400).json({ error: "providerId is required" });

      const providerUser = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!providerUser || !providerUser.calendarId) {
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid calendarId" });
      }

      const oauth2 = makeOAuth();
      oauth2.setCredentials(req.session.tokens);
      const calendar = google.calendar({ version: "v3", auth: oauth2 });

      await calendar.events.delete({
        calendarId: providerUser.calendarId,
        eventId,
      });

      res.json({
        ok: true,
        providerId: String(providerUser._id),
        deletedEventId: eventId,
      });
    } catch (err) {
      return googleErr(res, err);
    }
  }
);

// Patch (partial update)
router.patch(
  "/api/gcal/events/:eventId",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
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
        return res
          .status(400)
          .json({
            error: "Provide both startISO and endISO when changing times",
          });
      }
      if (startISO && endISO && new Date(startISO) >= new Date(endISO)) {
        return res.status(400).json({ error: "endISO must be after startISO" });
      }

      const providerUser = await User.findOne({
        _id: providerId,
        role: "provider",
        active: true,
      });
      if (!providerUser || !providerUser.calendarId) {
        return res
          .status(404)
          .json({ error: "Provider user not found/invalid calendarId" });
      }

      const oauth2 = makeOAuth();
      oauth2.setCredentials(req.session.tokens);

      if (startISO && endISO) {
        const { free, busy } = await getFreeBusy(oauth2, {
          calendarId: providerUser.calendarId,
          startISO,
          endISO,
        });
        if (!free) {
          const first = busy[0] || null;
          return res.status(409).json({
            ok: false,
            error: "Time range is already booked for this provider.",
            providerName: providerUser.username,
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

      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const { data } = await calendar.events.patch({
        calendarId: providerUser.calendarId,
        eventId,
        requestBody,
      });

      res.json({
        ok: true,
        providerId: String(providerUser._id),
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
