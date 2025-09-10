"use strict";

const mongoose = require("mongoose");
const { google } = require("googleapis");
const { getOAuthClient } = require("./google.controller.js");

function AModel() {
  try {
    return mongoose.model("Appointment");
  } catch {
    return require("../models/appointment.js");
  }
}
function UModel() {
  try {
    return mongoose.model("User");
  } catch {
    return require("../models/user.js");
  }
}
function PModel() {
  try {
    return mongoose.model("Patient");
  } catch {
    return require("../models/patient.js");
  }
}

const TZ = process.env.GCAL_DEFAULT_TZ || "America/New_York";
const pad = (n) => String(n).padStart(2, "0");
const isValidId = (v) =>
  typeof v === "string" && mongoose.Types.ObjectId.isValid(v);

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
const toMins = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};

function map(doc, provUser, pat) {
  const startISO = buildISO(doc.date, doc.startTime);
  const endISO = buildISO(doc.date, doc.endTime);
  return {
    id: String(doc._id),
    code: doc.code || "",
    status: doc.status,
    reason: doc.reason || "",
    providerId: doc.providerId ? String(doc.providerId) : "",
    googleEventId: doc.googleEventId || "",
    patient: {
      name: pat?.name || pat?.displayName || pat?.username || "",
      email: pat?.email || "",
    },
    provider: {
      name: (provUser?.displayName || provUser?.username || "").trim(),
    },
    startISO,
    endISO,
  };
}

function normalizeStatus(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  const mapTable = {
    scheduled: "Scheduled",
    confirm: "Confirmed",
    confirmed: "Confirmed",
    "check in": "CheckIn",
    checkin: "CheckIn",
    "check-in": "CheckIn",
    completed: "Completed",
    done: "Completed",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    cancel: "Cancelled",
  };
  return mapTable[t] || null;
}

/* --------------------------------- List -------------------------------- */
async function list(req, res) {
  try {
    const A = AModel();
    const { by, term, providerId, timeMin, timeMax, limit = 200 } = req.query;

    const q = {};
    // only filter by provider if it's a valid ObjectId
    if (isValidId(providerId)) q.providerId = providerId;

    if (timeMin || timeMax) {
      const minD = timeMin ? new Date(timeMin) : null;
      const maxD = timeMax ? new Date(timeMax) : null;
      const range = {};
      if (minD)
        range.$gte = `${minD.getFullYear()}-${pad(minD.getMonth() + 1)}-${pad(
          minD.getDate()
        )}`;
      if (maxD)
        range.$lte = `${maxD.getFullYear()}-${pad(maxD.getMonth() + 1)}-${pad(
          maxD.getDate()
        )}`;
      if (Object.keys(range).length) q.date = range;
    }

    const docs = await A.find(q)
      .sort({ date: 1, startTime: 1 })
      .limit(Number(limit))
      .lean();

    const providerIds = new Set();
    const patientIds = new Set();
    docs.forEach((d) => {
      if (d.providerId) providerIds.add(String(d.providerId));
      if (d.patientId) patientIds.add(String(d.patientId));
    });

    const Users = UModel();
    const Patients = PModel();

    const [providers, patients] = await Promise.all([
      providerIds.size
        ? Users.find(
            { _id: { $in: Array.from(providerIds) } },
            { displayName: 1, username: 1 }
          ).lean()
        : [],
      patientIds.size
        ? Patients.find(
            { _id: { $in: Array.from(patientIds) } },
            { name: 1, email: 1, phone: 1 }
          ).lean()
        : [],
    ]);

    const providerById = new Map(providers.map((u) => [String(u._id), u]));
    const patientById = new Map(patients.map((p) => [String(p._id), p]));

    let items = docs.map((d) =>
      map(
        d,
        providerById.get(String(d.providerId)),
        patientById.get(String(d.patientId))
      )
    );

    if (by && term) {
      const t = String(term).trim().toLowerCase();
      if (by === "patient") {
        items = items.filter((i) =>
          (i.patient?.name || "").toLowerCase().includes(t)
        );
      } else if (by === "provider") {
        items = items.filter((i) =>
          (i.provider?.name || "").toLowerCase().includes(t)
        );
      } else if (by === "id") {
        items = items.filter((i) => (i.code || "").toLowerCase().includes(t));
      }
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
    const { providerId, patientId, date, start, end, code, reason } = body;

    if (!isValidId(providerId)) {
      return res.status(400).json({ err: "Invalid providerId" });
    }
    if (!date || !start || !end) {
      return res.status(400).json({ err: "date/start/end required" });
    }

    const Users = UModel();
    const provider = await Users.findById(providerId).lean();
    if (!provider) return res.status(404).json({ err: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ err: "Provider missing calendarId" });

    const A = AModel();
    const sNew = toMins(start);
    const eNew = toMins(end);
    const clash = await A.findOne({
      providerId,
      date,
      $expr: {
        $and: [
          { $lt: [{ $toInt: { $substr: ["$startTime", 0, 2] } }, eNew / 60] },
          { $gt: [{ $toInt: { $substr: ["$endTime", 0, 2] } }, sNew / 60] },
        ],
      },
    }).lean();
    if (clash) {
      return res.status(409).json({
        err: "This provider already has an appointment that overlaps that time.",
      });
    }

    const pre = await A.create({
      code: code || "",
      date,
      startTime: start,
      endTime: end,
      providerId,
      patientId: isValidId(patientId) ? patientId : null,
      reason: reason || "",
      createdById: req.user?._id || null,
      status: "Scheduled",
    });

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });

    let patientName = "";
    if (isValidId(patientId)) {
      const Patients = PModel();
      const pat = await Patients.findById(patientId, {
        name: 1,
        email: 1,
      }).lean();
      patientName = pat?.name || "";
    }
    const summary = patientName || reason || "Appointment";

    const { data: gEvent } = await calendar.events.insert({
      calendarId: provider.calendarId,
      requestBody: {
        summary,
        description: reason || "",
        start: {
          dateTime: toLocalRFC3339NoZ(new Date(`${date}T${start}:00`)),
          timeZone: TZ,
        },
        end: {
          dateTime: toLocalRFC3339NoZ(new Date(`${date}T${end}:00`)),
          timeZone: TZ,
        },
        extendedProperties: { private: { appointmentId: String(pre._id) } },
      },
    });

    pre.googleEventId = gEvent.id;
    if (!pre.code) pre.code = gEvent.id;
    await pre.save();

    const provUser = provider;
    let patUser = null;
    if (isValidId(patientId)) {
      const Patients = PModel();
      patUser = await Patients.findById(patientId, {
        name: 1,
        email: 1,
      }).lean();
    }

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
    if (!provider || !provider.calendarId) {
      return res.status(400).json({ err: "Provider calendar unavailable" });
    }

    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });

    const update = {};

    if (body.startISO && body.endISO) {
      const s = fromISOtoLocalParts(body.startISO);
      const e = fromISOtoLocalParts(body.endISO);

      const sNew = toMins(s.time);
      const eNew = toMins(e.time);
      const clash = await A.findOne({
        _id: { $ne: doc._id },
        providerId: doc.providerId,
        date: s.date,
        $expr: {
          $and: [
            { $lt: [{ $toInt: { $substr: ["$startTime", 0, 2] } }, eNew / 60] },
            { $gt: [{ $toInt: { $substr: ["$endTime", 0, 2] } }, sNew / 60] },
          ],
        },
      }).lean();
      if (clash)
        return res
          .status(409)
          .json({ err: "New time overlaps another appointment." });

      await calendar.events.patch({
        calendarId: provider.calendarId,
        eventId: doc.googleEventId,
        requestBody: {
          start: {
            dateTime: toLocalRFC3339NoZ(new Date(`${s.date}T${s.time}:00`)),
            timeZone: TZ,
          },
          end: {
            dateTime: toLocalRFC3339NoZ(new Date(`${e.date}T${e.time}:00`)),
            timeZone: TZ,
          },
        },
      });
      update.date = s.date;
      update.startTime = s.time;
      update.endTime = e.time;
    } else if (body.date && body.start && body.end) {
      const sNew = toMins(body.start);
      const eNew = toMins(body.end);
      const clash = await A.findOne({
        _id: { $ne: doc._id },
        providerId: doc.providerId,
        date: body.date,
        $expr: {
          $and: [
            { $lt: [{ $toInt: { $substr: ["$startTime", 0, 2] } }, eNew / 60] },
            { $gt: [{ $toInt: { $substr: ["$endTime", 0, 2] } }, sNew / 60] },
          ],
        },
      }).lean();
      if (clash)
        return res
          .status(409)
          .json({ err: "New time overlaps another appointment." });

      await calendar.events.patch({
        calendarId: provider.calendarId,
        eventId: doc.googleEventId,
        requestBody: {
          start: {
            dateTime: toLocalRFC3339NoZ(
              new Date(`${body.date}T${body.start}:00`)
            ),
            timeZone: TZ,
          },
          end: {
            dateTime: toLocalRFC3339NoZ(
              new Date(`${body.date}T${body.end}:00`)
            ),
            timeZone: TZ,
          },
        },
      });
      update.date = body.date;
      update.startTime = body.start;
      update.endTime = body.end;
    }

    if (typeof body.status === "string") {
      const norm = normalizeStatus(body.status);
      if (!norm) return res.status(400).json({ err: "Invalid status" });
      update.status = norm;

      if (norm === "Cancelled" && doc.googleEventId) {
        try {
          await calendar.events.delete({
            calendarId: provider.calendarId,
            eventId: doc.googleEventId,
          });
        } catch (_) {
          /* ignore */
        }
        update.cancelledAt = new Date();
        update.cancelledBy = req.user?.username || "";
      }
    }

    if (typeof body.reason === "string") update.reason = body.reason;

    if (!Object.keys(update).length) {
      return res.status(400).json({ err: "No valid fields to update." });
    }

    const saved = await A.findByIdAndUpdate(id, update, { new: true }).lean();

    const provUser = await Users.findById(saved.providerId, {
      displayName: 1,
      username: 1,
    }).lean();
    let patUser = null;
    if (saved.patientId) {
      const Patients = PModel();
      patUser = await Patients.findById(saved.patientId, {
        name: 1,
        email: 1,
      }).lean();
    }

    res.json(map(saved, provUser, patUser));
  } catch (e) {
    res.status(500).json({ err: e.message || "Unknown error" });
  }
}

module.exports = { list, create, patch };
