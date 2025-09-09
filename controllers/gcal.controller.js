"use strict";

const { google } = require("googleapis");
const mongoose = require("mongoose");

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isValidId = (v) =>
  typeof v === "string" && mongoose.Types.ObjectId.isValid(v);

function hasOffsetOrZ(dt) {
  return /(?:Z|[+\-]\d{2}:\d{2})$/.test(dt);
}
function buildDateField(part, fallbackTZ = "America/New_York") {
  if (!part || typeof part !== "object") return null;
  if (isNonEmptyString(part.date)) return { date: String(part.date).trim() };
  const dt = String(part.dateTime || "").trim();
  if (!isNonEmptyString(dt)) return null;
  if (hasOffsetOrZ(dt)) return { dateTime: dt };
  const tz = isNonEmptyString(part.timeZone)
    ? String(part.timeZone).trim()
    : fallbackTZ;
  return { dateTime: dt, timeZone: tz };
}
function getOAuthClient(req) {
  const oAuth2 = new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI
  );
  if (req?.session?.tokens) oAuth2.setCredentials(req.session.tokens);
  return oAuth2;
}
function getUserModel() {
  try {
    return mongoose.model("User");
  } catch {
    return require("../user.js");
  }
}

/* ------------------------------ Create ------------------------------ */
async function createEvent(req, res) {
  try {
    const body = req?.body ?? {};
    const {
      providerId, // may be "ALL" from UI; treat as invalid
      calendarId,
      summary = "",
      description = "",
      location = "",
      attendees = [],
      start,
      end,
    } = body;
    if (!isNonEmptyString(summary))
      return res.status(400).json({ err: "summary is required" });

    const startField = buildDateField(start);
    const endField = buildDateField(end, startField?.timeZone);
    if (!startField || !endField)
      return res.status(400).json({ err: "Invalid start/end" });

    let targetCalendarId = "primary";

    if (isValidId(providerId)) {
      const User = getUserModel();
      const provider = await User.findById(providerId).lean();
      if (!provider) return res.status(404).json({ err: "Provider not found" });
      if (!provider.calendarId)
        return res.status(400).json({ err: "Provider is missing calendarId" });
      targetCalendarId = String(provider.calendarId).trim();
    } else if (isNonEmptyString(calendarId)) {
      // if providerId is "ALL" or invalid, fall back to explicit calendarId or "primary"
      targetCalendarId = String(calendarId).trim();
    }

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const event = {
      summary,
      description,
      location,
      start: startField,
      end: endField,
      attendees: Array.isArray(attendees) ? attendees : [],
    };
    const { data } = await calendar.events.insert({
      calendarId: targetCalendarId,
      requestBody: event,
    });
    res.status(201).json({ ...data, _usedCalendarId: targetCalendarId });
  } catch (err) {
    res.status(500).json({ err: err?.message || "Unknown error" });
  }
}

/* ----------------------------- Agenda/Ranges ----------------------------- */
async function agenda(req, res) {
  try {
    const { providerId } = req.query;
    if (!isValidId(providerId))
      return res.status(400).json({ err: "Invalid providerId" });

    const User = getUserModel();
    const provider = await User.findById(providerId).lean();
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ err: "Provider is missing calendarId" });
    const calendarId = String(provider.calendarId).trim();

    let { timeMin, timeMax } = req.query;
    const { day, maxResults = 50, q } = req.query;

    if (
      isNonEmptyString(day) &&
      (!isNonEmptyString(timeMin) || !isNonEmptyString(timeMax))
    ) {
      const startLocal = new Date(`${day}T00:00:00`);
      const endLocal = new Date(startLocal);
      endLocal.setDate(endLocal.getDate() + 1);
      timeMin = new Date(
        startLocal.getTime() - startLocal.getTimezoneOffset() * 60000
      ).toISOString();
      timeMax = new Date(
        endLocal.getTime() - endLocal.getTimezoneOffset() * 60000
      ).toISOString();
    }

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const params = {
      calendarId,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: Number(maxResults) || 50,
    };
    if (isNonEmptyString(timeMin)) params.timeMin = timeMin;
    if (isNonEmptyString(timeMax)) params.timeMax = timeMax;
    if (isNonEmptyString(q)) params.q = q;

    const { data } = await calendar.events.list(params);
    res.json({ ...data, _usedCalendarId: calendarId });
  } catch (err) {
    res.status(500).json({ err: err?.message || "Unknown error" });
  }
}

async function eventsRange(req, res) {
  try {
    const { providerId, timeMin, timeMax, maxResults = 250 } = req.query;
    if (!isValidId(providerId))
      return res.status(400).json({ err: "Invalid providerId" });
    if (!isNonEmptyString(timeMin) || !isNonEmptyString(timeMax)) {
      return res.status(400).json({ err: "timeMin and timeMax are required" });
    }

    const User = getUserModel();
    const provider = await User.findById(providerId).lean();
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ err: "Provider is missing calendarId" });
    const calendarId = String(provider.calendarId).trim();

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const { data } = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: Number(maxResults) || 250,
    });
    res.json({ ...data, _usedCalendarId: calendarId });
  } catch (err) {
    res.status(500).json({ err: err?.message || "Unknown error" });
  }
}

/* --------------------------- Update / Delete --------------------------- */
async function updateEvent(req, res) {
  try {
    const { eventId } = req.params;
    if (!isNonEmptyString(eventId))
      return res.status(400).json({ err: "eventId required" });

    const providerId = req.query.providerId || req.body?.providerId;
    if (!isValidId(providerId))
      return res.status(400).json({ err: "Invalid providerId" });

    const User = getUserModel();
    const provider = await User.findById(providerId).lean();
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ err: "Provider is missing calendarId" });
    const calendarId = String(provider.calendarId).trim();

    const updates = {};
    if (typeof req.body?.summary === "string")
      updates.summary = req.body.summary;
    if (typeof req.body?.description === "string")
      updates.description = req.body.description;
    if (typeof req.body?.location === "string")
      updates.location = req.body.location;

    const startField = req.body?.start ? buildDateField(req.body.start) : null;
    const endField = req.body?.end
      ? buildDateField(req.body.end, startField?.timeZone)
      : null;
    if (startField) updates.start = startField;
    if (endField) updates.end = endField;

    if (!Object.keys(updates).length)
      return res.status(400).json({ err: "No valid fields to update." });

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const { data } = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: updates,
    });
    res.json({ ...data, _usedCalendarId: calendarId });
  } catch (err) {
    res.status(500).json({ err: err?.message || "Unknown error" });
  }
}

async function deleteEvent(req, res) {
  try {
    const { eventId } = req.params;
    if (!isNonEmptyString(eventId))
      return res.status(400).json({ err: "eventId required" });

    const { providerId } = req.query;
    if (!isValidId(providerId))
      return res.status(400).json({ err: "Invalid providerId" });

    const User = getUserModel();
    const provider = await User.findById(providerId).lean();
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ err: "Provider is missing calendarId" });
    const calendarId = String(provider.calendarId).trim();

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId, eventId });
    res.json({ ok: true, _usedCalendarId: calendarId });
  } catch (err) {
    res.status(500).json({ err: err?.message || "Unknown error" });
  }
}

async function ensureProviderCalendar(req, res) {
  try {
    const providerId = req.params.id;
    if (!isValidId(providerId))
      return res.status(400).json({ err: "Invalid providerId" });

    const User = getUserModel();
    const provider = await User.findById(providerId);
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (provider.role !== "provider")
      return res.status(400).json({ err: "User is not a provider" });
    if (provider.calendarId)
      return res.json({ calendarId: provider.calendarId });

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const summary =
      provider.displayName || provider.username || "Clinic Provider";
    const { data } = await calendar.calendars.insert({
      requestBody: {
        summary,
        timeZone: process.env.GCAL_DEFAULT_TZ || "America/New_York",
      },
    });

    provider.calendarId = data.id;
    await provider.save();

    try {
      if (provider.username && provider.username.includes("@")) {
        await calendar.acl.insert({
          calendarId: data.id,
          requestBody: {
            role: "reader",
            scope: { type: "user", value: provider.username },
          },
        });
      }
    } catch (_) {}

    res.json({ calendarId: data.id });
  } catch (e) {
    res
      .status(500)
      .json({ error: e.message || "Failed to ensure provider calendar" });
  }
}

module.exports = {
  createEvent,
  agenda,
  eventsRange,
  updateEvent,
  deleteEvent,
  ensureProviderCalendar,
};
