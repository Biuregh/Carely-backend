const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieSession = require("cookie-session");
const { google } = require("googleapis");
const User = require("./models/user");
const PORT = process.env.PORT || 3000;

// Routers
const authRouter = require("./controllers/auth");
const testJwtRouter = require("./controllers/test-jwt");
const usersRouter = require("./controllers/users");

// --- DB ---
mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on("connected", () => {
  console.log(`Connected to MongoDB ${mongoose.connection.name}.`);
});

const app = express();

// --- Middlewares ---
const verifyToken = require("./middleware/verify-token");
const requireRole = require("./middleware/require-role");
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(
  cookieSession({
    name: "sess",
    keys: [process.env.SESSION_SECRET],
    httpOnly: true,
    sameSite: "lax",
  })
);
app.use(morgan("dev"));

// --- Health check (quick test) ---
app.get("/healthz", (req, res) => res.json({ ok: true }));

// --- Google OAuth helpers ---
function makeOAuth() {
  return new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI
  );
}
function requireGoogle(req, res, next) {
  if (!req.session || !req.session.tokens) {
    return res.status(401).json({ error: "Not connected to Google" });
  }
  next();
}

async function getFreeBusy(oauth2, { calendarId, startISO, endISO }) {
  const calendar = google.calendar({ version: "v3", auth: oauth2 });
  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      items: [{ id: calendarId }],
    },
  });
  const busy =
    (data.calendars &&
      data.calendars[calendarId] &&
      data.calendars[calendarId].busy) ||
    [];
  return { busy, free: busy.length === 0 };
}

// --- Google OAuth routes ---
app.get("/oauth/google", (req, res) => {
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

app.get("/oauth/google/callback", async (req, res, next) => {
  try {
    const oauth2 = makeOAuth();
    const { tokens } = await oauth2.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect("http://localhost:5173/connected");
  } catch (err) {
    next(err);
  }
});

// --- JWT routes (app auth) ---
app.use("/auth", authRouter);
app.use("/test-jwt", testJwtRouter);
app.use("/users", usersRouter);

// --- Calendar APIs ---
app.post(
  "/api/gcal/events",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res, next) => {
    try {
      const {
        providerId,
        summary,
        description,
        startISO,
        endISO,
        attendeeEmails = [],
      } = req.body;

      // Role-based scoping (simplified because requireRole already blocked patients/others)
      let effectiveProviderId = providerId;

      if (req.user.role === "provider") {
        // providers can only book themselves
        effectiveProviderId = req.user._id;
      } else {
        // admin & reception must specify a target provider
        if (!effectiveProviderId) {
          return res.status(400).json({ error: "providerId is required" });
        }
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

      // block double booking for this provider
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
      next(err);
    }
  }
);

// Optional: range endpoint for FullCalendar
app.get(
  "/api/gcal/agenda",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res, next) => {
    try {
      let { day, providerId } = req.query;
      if (!day) return res.status(400).json({ error: "day is required" });

      if (req.user.role === "provider") {
        providerId = req.user._id; // force self
      } else {
        if (!providerId)
          return res.status(400).json({ error: "providerId is required" });
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
      next(err);
    }
  }
);

app.get(
  "/api/gcal/events-range",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res, next) => {
    try {
      let { timeMin, timeMax, providerId } = req.query;
      if (!timeMin || !timeMax) {
        return res
          .status(400)
          .json({ error: "timeMin and timeMax are required" });
      }

      if (req.user.role === "provider") {
        providerId = req.user._id; // force self
      } else {
        if (!providerId)
          return res.status(400).json({ error: "providerId is required" });
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
      next(err);
    }
  }
);

app.delete(
  "/api/gcal/events/:eventId",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res, next) => {
    try {
      const { eventId } = req.params;
      let { providerId } = req.query;

      // role scoping
      if (req.user.role === "provider") {
        providerId = req.user._id; // force self
      } else {
        if (!providerId)
          return res.status(400).json({ error: "providerId is required" });
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
      next(err);
    }
  }
);

app.patch(
  "/api/gcal/events/:eventId",
  requireGoogle,
  verifyToken,
  requireRole("admin", "reception", "provider"),
  async (req, res, next) => {
    try {
      const { eventId } = req.params;
      let { providerId } = req.query;
      const { summary, description, startISO, endISO, attendeeEmails } =
        req.body;

      // role scoping
      if (req.user.role === "provider") {
        providerId = req.user._id; // force self
      } else {
        if (!providerId)
          return res.status(400).json({ error: "providerId is required" });
      }

      // if only partial fields are provided, that's fine (patch semantics)
      if ((startISO && !endISO) || (!startISO && endISO)) {
        return res.status(400).json({
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

      // Optional: if changing time, run free/busy check
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
      next(err);
    }
  }
);

//----DEBUGGER----
app.get("/api/gcal/calendars", requireGoogle, async (req, res) => {
  try {
    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const { data } = await calendar.calendarList.list({ maxResults: 250 });
    res.json(
      (data.items || []).map((c) => ({
        id: c.id,
        summary: c.summary,
        accessRole: c.accessRole,
      }))
    );
  } catch (err) {
    const status = err?.response?.status || 500;
    const msg =
      err?.response?.data?.error?.message || err.message || "Unknown error";
    res.status(status).json({ error: msg });
  }
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(PORT, () => {
  console.log("Backend running on http://localhost:" + PORT);
});
