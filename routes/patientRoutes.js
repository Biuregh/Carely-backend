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

const router = express.Router();

// Mounted at /patients
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

// Public check-in
router.post("/checkin", checkIn);

// Patient appointments (list & schedule)
router.get("/:id/appointments", verifyToken, listPatientAppointments);
router.post(
  "/:id/appointments",
  verifyToken,
  requireRole("admin", "reception"),
  requireGoogle, // needs clinic Google connection
  schedulePatientAppointment
);

module.exports = router;
