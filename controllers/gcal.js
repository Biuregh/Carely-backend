"use strict";

const express = require("express");
const { google } = require("googleapis");
const mongoose = require("mongoose");

const router = express.Router();

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function hasOffsetOrZ(dt) {
  return /(?:Z|[+\-]\d{2}:\d{2})$/.test(dt);
}
function buildDateField(part, fallbackTZ = "America/New_York") {
  if (!part || typeof part !== "object") return null;
  if (isNonEmptyString(part.date)) {
    return { date: String(part.date).trim() };
  }
  const dt = String(part.dateTime || "").trim();
  if (!isNonEmptyString(dt)) return null;
  if (hasOffsetOrZ(dt)) return { dateTime: dt };
  const tz = isNonEmptyString(part.timeZone)
    ? String(part.timeZone).trim()
    : fallbackTZ;
  return { dateTime: dt, timeZone: tz };
}

function getOAuthClient(req) {
  const {
    GCAL_CLIENT_ID = "",
    GCAL_CLIENT_SECRET = "",
    GCAL_REDIRECT_URI = "",
  } = process.env;
  const oAuth2Client = new google.auth.OAuth2(
    GCAL_CLIENT_ID,
    GCAL_CLIENT_SECRET,
    GCAL_REDIRECT_URI
  );
  const tokens = req?.session?.tokens;
  if (tokens) oAuth2Client.setCredentials(tokens);
  return oAuth2Client;
}
function requireGoogle(req, res, next) {
  if (!req?.session || !req.session.tokens) {
    return res.status(401).json({ err: "Not connected to Google." });
  }
  next();
}

router.get("/api/gcal/health", (_req, res) => res.json({ ok: true }));

router.post("/api/gcal/events", requireGoogle, async (req, res) => {
  try {
    const body = req?.body ?? {};
    const {
      providerId,
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
    if (!startField || !endField) {
      return res.status(400).json({ err: "Invalid start/end" });
    }

    let targetCalendarId = "primary";
    if (isNonEmptyString(providerId)) {
      let User;
      try {
        User = mongoose.model("User");
      } catch {
        User = require("../models/user");
      }
      const provider = await User.findById(providerId).lean();
      if (!provider) return res.status(404).json({ err: "Provider not found" });
      if (!provider.calendarId)
        return res.status(400).json({ err: "Provider is missing calendarId" });
      targetCalendarId = String(provider.calendarId).trim();
    } else if (isNonEmptyString(calendarId)) {
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
});

router.get("/api/gcal/agenda", requireGoogle, async (req, res) => {
  try {
    const { providerId } = req.query;
    if (!isNonEmptyString(providerId))
      return res.status(400).json({ err: "providerId required" });

    let User;
    try {
      User = mongoose.model("User");
    } catch {
      User = require("../models/user");
    }
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
});

router.get("/api/gcal/events-range", requireGoogle, async (req, res) => {
  try {
    const { providerId, timeMin, timeMax, maxResults = 250 } = req.query;
    if (!isNonEmptyString(providerId))
      return res.status(400).json({ err: "providerId required" });
    if (!isNonEmptyString(timeMin) || !isNonEmptyString(timeMax))
      return res.status(400).json({ err: "timeMin and timeMax are required" });

    let User;
    try {
      User = mongoose.model("User");
    } catch {
      User = require("../models/user");
    }
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
});

router.patch("/api/gcal/events/:eventId", requireGoogle, async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!isNonEmptyString(eventId))
      return res.status(400).json({ err: "eventId required" });

    const providerId = req.query.providerId || req.body?.providerId;
    if (!isNonEmptyString(providerId))
      return res.status(400).json({ err: "providerId required" });

    let User;
    try {
      User = mongoose.model("User");
    } catch {
      User = require("../models/user");
    }
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
});

router.delete("/api/gcal/events/:eventId", requireGoogle, async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!isNonEmptyString(eventId))
      return res.status(400).json({ err: "eventId required" });

    const { providerId } = req.query;
    if (!isNonEmptyString(providerId))
      return res.status(400).json({ err: "providerId required" });

    let User;
    try {
      User = mongoose.model("User");
    } catch {
      User = require("../models/user");
    }
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
});

module.exports = router;
