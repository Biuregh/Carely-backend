"use strict";

const express = require("express");
const verifyToken = require("../middleware/verify-token.js");
const requireRole = require("../middleware/require-role.js");
const { requireGoogle } = require("../controllers/google.controller.js");
const {
  list,
  create,
  patch,
} = require("../controllers/appointments.controller.js");

const router = express.Router();

router.get(
  "/api/appointments",
  verifyToken,
  requireRole("admin", "reception"),
  list
);

router.post(
  "/api/appointments",
  verifyToken,
  requireRole("admin", "reception"),
  requireGoogle,
  create
);

router.patch(
  "/api/appointments/:id",
  verifyToken,
  requireRole("admin", "reception"),
  requireGoogle,
  patch
);

module.exports = router;
