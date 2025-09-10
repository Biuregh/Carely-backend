"use strict";

const mongoose = require("mongoose");
const Patient = require("../models/patient");
const User = require("../models/user"); 
const Appointment = require("../models/appointment");
const { google } = require("googleapis");

const pad = (n) => String(n).padStart(2, "0");
const TZ = process.env.GCAL_DEFAULT_TZ || "America/New_York";

function toLocalRFC3339NoZ(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:00`;
}
function mapAppt(doc, provider, patient) {
  const startISO = new Date(`${doc.date}T${doc.startTime}:00`).toISOString();
  const endISO = new Date(`${doc.date}T${doc.endTime}:00`).toISOString();
  return {
    id: String(doc._id),
    code: doc.code || "",
    status: doc.status,
    reason: doc.reason || "",
    providerId: doc.providerId ? String(doc.providerId) : "",
    provider: { name: provider?.displayName || provider?.username || "" },
    patientId: doc.patientId ? String(doc.patientId) : "",
    patient: {
      name: patient?.name || patient?.displayName || patient?.username || "",
    },
    googleEventId: doc.googleEventId || "",
    startISO,
    endISO,
  };
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

// ---------- Patients ----------
async function getPatients(req, res) {
  try {
    const { name, phone, dob, email, withAppointments } = req.query;
    const filter = {};
    if (name) filter.name = new RegExp(name, "i");
    if (phone) filter.phone = new RegExp(phone, "i");
    if (email) filter.email = new RegExp(email, "i");
    if (dob) {
      const d = new Date(dob);
      if (!isNaN(d.getTime())) {
        // match same calendar day
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        filter.dob = { $gte: start, $lte: end };
      }
    }
    const patients = await Patient.find(filter).lean();

    if (String(withAppointments || "").toLowerCase() === "true") {
      const ids = patients.map((p) => String(p._id));
      const appts = await Appointment.find({
        patientId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .sort({ date: 1, startTime: 1 })
        .lean();

      const byPatient = new Map();
      for (const a of appts) {
        const pid = String(a.patientId || "");
        if (!byPatient.has(pid)) byPatient.set(pid, []);
        byPatient.get(pid).push(a);
      }

      const userIds = new Set(appts.map((a) => String(a.providerId || "")));
      const providers = await User.find(
        { _id: { $in: Array.from(userIds).filter(Boolean) } },
        { displayName: 1, username: 1 }
      ).lean();
      const provById = new Map(providers.map((u) => [String(u._id), u]));

      for (const p of patients) {
        const list = (byPatient.get(String(p._id)) || []).slice(0, 3);
        p.appointments = list.map((a) =>
          mapAppt(a, provById.get(String(a.providerId)), { name: p.name })
        );
      }
    }

    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPatient(req, res) {
  try {
    const patient = await Patient.findById(req.params.id).lean();
    if (!patient) return res.status(404).json({ error: "Patient not found" });

    const appts = await Appointment.find({ patientId: patient._id })
      .sort({ date: 1, startTime: 1 })
      .lean();

    const provIds = Array.from(
      new Set(appts.map((a) => String(a.providerId || "")))
    ).filter(Boolean);
    const providers = provIds.length
      ? await User.find(
          { _id: { $in: provIds } },
          { displayName: 1, username: 1 }
        ).lean()
      : [];
    const provById = new Map(providers.map((u) => [String(u._id), u]));

    const appointments = appts.map((a) =>
      mapAppt(a, provById.get(String(a.providerId)), patient)
    );

    res.json({ ...patient, appointments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createPatient(req, res) {
  try {
    const body = { ...req.body };
    if (body.dob) body.dob = new Date(body.dob);
    const patient = await Patient.create(body);
    res.status(201).json(patient);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function updatePatient(req, res) {
  try {
    const body = { ...req.body };
    if (body.dob) body.dob = new Date(body.dob);
    const patient = await Patient.findByIdAndUpdate(req.params.id, body, {
      new: true,
    });
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    res.json(patient);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function deletePatient(req, res) {
  try {
    const patient = await Patient.findByIdAndDelete(req.params.id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function checkIn(req, res) {
  try {
    const { fullName, dob, email, phone } = req.body || {};
    if (!fullName || !dob || !email || !phone) {
      return res
        .status(400)
        .json({ error: "fullName, dob, email, phone required" });
    }
    const normalizedDob = new Date(dob);

    let patient = await Patient.findOne({ email });
    if (!patient) {
      patient = await Patient.create({
        name: fullName,
        email,
        dob: normalizedDob,
        phone,
      });
    } else {
      patient.name = fullName;
      patient.dob = normalizedDob;
      patient.phone = phone;
      await patient.save();
    }

    res.json({
      patientId: String(patient._id),
      message: "You are checked in!",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------- Patient appointments ----------
async function listPatientAppointments(req, res) {
  try {
    const { id } = req.params;
    const appts = await Appointment.find({ patientId: id })
      .sort({ date: 1, startTime: 1 })
      .lean();

    const provIds = Array.from(
      new Set(appts.map((a) => String(a.providerId || "")))
    ).filter(Boolean);
    const providers = provIds.length
      ? await User.find(
          { _id: { $in: provIds } },
          { displayName: 1, username: 1 }
        ).lean()
      : [];
    const provById = new Map(providers.map((u) => [String(u._id), u]));
    const patient = await Patient.findById(id).lean();

    res.json(
      appts.map((a) => mapAppt(a, provById.get(String(a.providerId)), patient))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function schedulePatientAppointment(req, res) {
  try {
    const patientId = req.params.id;
    const { providerId, date, start, end, reason = "" } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(patientId))
      return res.status(400).json({ error: "Invalid patient id" });
    if (!mongoose.Types.ObjectId.isValid(providerId))
      return res.status(400).json({ error: "Invalid providerId" });
    if (!date || !start || !end)
      return res.status(400).json({ error: "date, start, end required" });

    const provider = await User.findById(providerId).lean();
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (!provider.calendarId)
      return res.status(400).json({ error: "Provider missing calendarId" });

    const patient = await Patient.findById(patientId).lean();
    if (!patient) return res.status(404).json({ error: "Patient not found" });

    // prevent overlap using string compare on HH:mm
    const clash = await Appointment.findOne({
      providerId,
      date,
      $expr: {
        $and: [{ $lt: ["$startTime", end] }, { $gt: ["$endTime", start] }],
      },
    }).lean();
    if (clash) {
      return res
        .status(409)
        .json({ error: "Provider already has an overlapping appointment" });
    }

    // create mongo doc
    const appt = await Appointment.create({
      code: "",
      date,
      startTime: start,
      endTime: end,
      providerId,
      patientId,
      reason,
      createdById: req.user?._id || null,
      status: "Scheduled",
    });

    // create google event with clinic tokens
    const auth = getOAuthClient(req);
    const calendar = google.calendar({ version: "v3", auth });

    const summary = patient.name || "Appointment";
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
        extendedProperties: { private: { appointmentId: String(appt._id) } },
      },
    });

    appt.googleEventId = gEvent.id;
    appt.code = appt.code || gEvent.id;
    await appt.save();

    res.status(201).json(
      mapAppt(appt.toObject ? appt.toObject() : appt, provider, {
        name: patient.name,
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error" });
  }
}

module.exports = {
  getPatients,
  getPatient,
  createPatient,
  updatePatient,
  deletePatient,
  checkIn,
  listPatientAppointments,
  schedulePatientAppointment,
};
