// server.js (CommonJS)
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieSession = require("cookie-session");
const { google } = require("googleapis");

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

// --- Google OAuth routes ---
app.get("/oauth/google", (req, res) => {
  const oauth2 = makeOAuth();
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
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
app.post("/api/gcal/events", requireGoogle, async (req, res, next) => {
  try {
    const {
      summary,
      description,
      startISO,
      endISO,
      attendeeEmails = [],
    } = req.body;

    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);

    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        attendees: attendeeEmails.map((email) => ({ email })),
        reminders: { useDefault: true },
      },
    });

    res.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
  } catch (err) {
    next(err);
  }
});

app.get("/api/gcal/agenda", requireGoogle, async (req, res, next) => {
  try {
    const day = req.query.day; // "YYYY-MM-DD"
    const start = new Date(`${day}T00:00:00Z`).toISOString();
    const end = new Date(`${day}T23:59:59Z`).toISOString();

    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);

    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const { data } = await calendar.events.list({
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
      timeMin: start,
      timeMax: end,
    });

    res.json({ events: data.items || [] });
  } catch (err) {
    next(err);
  }
});

// Optional: range endpoint for FullCalendar
app.get("/api/gcal/events-range", requireGoogle, async (req, res, next) => {
  try {
    const { timeMin, timeMax } = req.query;
    if (!timeMin || !timeMax) {
      return res
        .status(400)
        .json({ error: "timeMin and timeMax are required" });
    }

    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);

    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const { data } = await calendar.events.list({
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
      timeMin,
      timeMax,
    });

    res.json({ events: data.items || [] });
  } catch (err) {
    next(err);
  }
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(process.env.PORT, () => {
  console.log("Backend running on http://localhost:" + process.env.PORT);
});
