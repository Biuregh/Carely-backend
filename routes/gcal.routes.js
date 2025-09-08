"use strict";

const express = require("express");
const {
  createEvent,
  agenda,
  eventsRange,
  updateEvent,
  deleteEvent,
  ensureProviderCalendar,
} = require("../controllers/gcal.controller.js");
const verifyToken = require("../middleware/verify-token.js");
const requireRole = require("../middleware/require-role.js");

const router = express.Router();

function requireGoogle(req, res, next) {
  if (req?.session?.tokens) return next();
  res.status(401).json({ err: "Not connected to Google." });
}

router.get("/api/gcal/health", (_req, res) => res.json({ ok: true }));
router.post("/api/gcal/events", requireGoogle, createEvent);
router.get("/api/gcal/agenda", requireGoogle, agenda);
router.get("/api/gcal/events-range", requireGoogle, eventsRange);
router.patch("/api/gcal/events/:eventId", requireGoogle, updateEvent);
router.delete("/api/gcal/events/:eventId", requireGoogle, deleteEvent);

router.post(
  "/api/gcal/providers/:id/ensure-calendar",
  verifyToken,
  requireRole("admin"),
  requireGoogle,
  ensureProviderCalendar
);

module.exports = router;
