"use strict";

const express = require("express");
const {
  getPatients,
  getPatient,
  createPatient,
  updatePatient,
  deletePatient,
  checkIn,
  listPatientAppointments,
  schedulePatientAppointment,
} = require("../controllers/patientController");

const verifyToken = require("../middleware/verify-token");
const requireRole = require("../middleware/require-role");
const { requireGoogle } = require("../controllers/google.controller.js");

const Patient = require("../models/patient");

const router = express.Router();

router.get("/", getPatients);
router.get("/:id", getPatient);
router.post("/", verifyToken, requireRole("admin", "reception"), createPatient);
router.put(
  "/:id",
  verifyToken,
  requireRole("admin", "reception"),
  updatePatient
);
router.delete("/:id", verifyToken, requireRole("admin"), deletePatient);

router.post("/checkin", checkIn);

router.get("/:id/appointments", verifyToken, listPatientAppointments);
router.post(
  "/:id/appointments",
  verifyToken,
  requireRole("admin", "reception"),
  requireGoogle,
  schedulePatientAppointment
);

router.patch(
  "/:id/active",
  verifyToken,
  requireRole("admin", "reception"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { active } = req.body;
      if (typeof active !== "boolean") {
        return res.status(400).json({ err: "active must be boolean" });
      }
      const doc = await Patient.findByIdAndUpdate(
        id,
        { $set: { active } },
        { new: true }
      );
      if (!doc) return res.status(404).json({ err: "Patient not found" });
      res.json(doc);
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
