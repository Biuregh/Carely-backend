"use strict";

const mongoose = require("mongoose");
const { google } = require("googleapis");
const { getOAuthClient } = require("./google.controller.js");

function AModel() {
  try {
    return mongoose.model("Appointment");
  } catch {
    return require("../appointment.js");
  }
}
function UModel() {
  try {
    return mongoose.model("User");
  } catch {
    return require("../user.js");
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function toLocalRFC3339NoZ(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:00`;
}
function fromISOtoLocalParts(iso) {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function buildISO(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

function map(doc, provUser, patUser) {
  const startISO = buildISO(doc.date, doc.startTime);
  const endISO = buildISO(doc.date, doc.endTime);
  return {
    id: String(doc._id),
    code: doc.code || "",
    status: doc.status,
    patient: {
      name: patUser?.displayName || patUser?.username || "",
      email: "",
    },
    provider: { name: provUser?.displayName || provUser?.username || "" },
    providerId: doc.providerId ? String(doc.providerId) : "",
    googleEventId: doc.googleEventId || "",
    reason: "",
    startISO,
    endISO,
  };
}

async function list(req, res) {
  try {
    const A = AModel();
    const { by, term, providerId, timeMin, timeMax, limit = 200 } = req.query;
    const q = {};
    if (providerId) q.providerId = providerId;
    if (timeMin || timeMax) {
    }

    const docs = await A.find(q)
      .sort({ date: 1, startTime: 1 })
      .limit(Number(limit))
      .lean();

    const userIds = new Set();
    docs.forEach((d) => {
      if (d.providerId) userIds.add(String(d.providerId));
      if (d.patientId) userIds.add(String(d.patientId));
    });
    const Users = UModel();
    const users = await Users.find(
      { _id: { $in: Array.from(userIds) } },
      { displayName: 1, username: 1 }
    ).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    let items = docs.map((d) =>
      map(d, byId.get(String(d.providerId)), byId.get(String(d.patientId)))
    );

    if (by && term) {
      const t = String(term).trim().toLowerCase();
      if (by === "patient")
        items = items.filter((i) =>
          (i.patient?.name || "").toLowerCase().includes(t)
        );
      else if (by === "provider")
        items = items.filter((i) =>
          (i.provider?.name || "").toLowerCase().includes(t)
        );
      else if (by === "id")
        items = items.filter((i) => (i.code || "").toLowerCase().includes(t));
    }

    if (timeMin || timeMax) {
      const min = timeMin ? new Date(timeMin).getTime() : null;
      const max = timeMax ? new Date(timeMax).getTime() : null;
      items = items.filter((i) => {
        const s = new Date(i.startISO).getTime();
        if (min !== null && s < min) return false;
        if (max !== null && s > max) return false;
        return true;
      });
    }

    res.json({ items });
  } catch (e) {
    res.status(500).json({ err: e.message || "Unknown error" });
  }
}

async function create(req, res) {
  try {
    const body = req.body || {};
    const { providerId, patientId, date, start, end, code } = body;
    if (!providerId)
      return res.status(400).json({ err: "providerId required" });
    if (!date || !start || !end)
      return res.status(400).json({ err: "date/start/end required" });

    const Users = UModel();
    const provider = await Users.findById(providerId).lean();
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ err: "Provider missing calendarId" });

    const A = AModel();
    const pre = await A.create({
      code: code || "",
      date,
      startTime: start,
      endTime: end,
      providerId,
      patientId: patientId || null,
      createdById: req.user?._id || null,
      status: "Scheduled",
    });

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const tz = process.env.GCAL_DEFAULT_TZ || "America/New_York";

    let patientName = "";
    if (patientId) {
      const pat = await Users.findById(patientId, {
        displayName: 1,
        username: 1,
      }).lean();
      patientName = pat?.displayName || pat?.username || "";
    }

    const summary = patientName ? `${patientName}` : "Appointment";
    const { data: gEvent } = await calendar.events.insert({
      calendarId: provider.calendarId,
      requestBody: {
        summary,
        start: {
          dateTime: toLocalRFC3339NoZ(new Date(`${date}T${start}:00`)),
          timeZone: tz,
        },
        end: {
          dateTime: toLocalRFC3339NoZ(new Date(`${date}T${end}:00`)),
          timeZone: tz,
        },
        extendedProperties: { private: { appointmentId: String(pre._id) } },
      },
    });

    pre.googleEventId = gEvent.id;
    if (!pre.code) pre.code = gEvent.id;
    await pre.save();

    const provUser = provider;
    const patUser = patientId ? await Users.findById(patientId).lean() : null;
    res
      .status(201)
      .json(map(pre.toObject ? pre.toObject() : pre, provUser, patUser));
  } catch (e) {
    res.status(500).json({ err: e.message || "Unknown error" });
  }
}

async function patch(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const A = AModel();
    const doc = await A.findById(id);
    if (!doc) return res.status(404).json({ err: "Not found" });

    const Users = UModel();
    const provider = await Users.findById(doc.providerId).lean();
    if (!provider || !provider.calendarId)
      return res.status(400).json({ err: "Provider calendar unavailable" });

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });
    const tz = process.env.GCAL_DEFAULT_TZ || "America/New_York";

    const update = {};

    if (body.startISO && body.endISO) {
      const s = fromISOtoLocalParts(body.startISO);
      const e = fromISOtoLocalParts(body.endISO);
      await calendar.events.patch({
        calendarId: provider.calendarId,
        eventId: doc.googleEventId,
        requestBody: {
          start: {
            dateTime: toLocalRFC3339NoZ(new Date(`${s.date}T${s.time}:00`)),
            timeZone: tz,
          },
          end: {
            dateTime: toLocalRFC3339NoZ(new Date(`${e.date}T${e.time}:00`)),
            timeZone: tz,
          },
        },
      });
      update.date = s.date;
      update.startTime = s.time;
      update.endTime = e.time;
    } else if (body.date && body.start && body.end) {
      await calendar.events.patch({
        calendarId: provider.calendarId,
        eventId: doc.googleEventId,
        requestBody: {
          start: {
            dateTime: toLocalRFC3339NoZ(
              new Date(`${body.date}T${body.start}:00`)
            ),
            timeZone: tz,
          },
          end: {
            dateTime: toLocalRFC3339NoZ(
              new Date(`${body.date}T${body.end}:00`)
            ),
            timeZone: tz,
          },
        },
      });
      update.date = body.date;
      update.startTime = body.start;
      update.endTime = body.end;
    }

    if (typeof body.status === "string") {
      update.status = body.status;
      if (body.status === "Cancelled" && doc.googleEventId) {
        await calendar.events.delete({
          calendarId: provider.calendarId,
          eventId: doc.googleEventId,
        });
        update.cancelledAt = new Date();
        update.cancelledBy = req.user?.username || "";
      }
    }

    if (!Object.keys(update).length)
      return res.status(400).json({ err: "No valid fields to update." });

    const saved = await A.findByIdAndUpdate(id, update, { new: true }).lean();

    const provUser = await Users.findById(saved.providerId, {
      displayName: 1,
      username: 1,
    }).lean();
    const patUser = saved.patientId
      ? await Users.findById(saved.patientId, {
          displayName: 1,
          username: 1,
        }).lean()
      : null;
    res.json(map(saved, provUser, patUser));
  } catch (e) {
    res.status(500).json({ err: e.message || "Unknown error" });
  }
}

module.exports = { list, create, patch };
