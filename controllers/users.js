const express = require("express");
const User = require("../models/user");
const verifyToken = require("../middleware/verify-token");
const requireRole = require("../middleware/require-role");

const router = express.Router();

router.post("/", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const {
      username,
      password,
      role,
      calendarId = null,
      active = true,
      displayName = "",
    } = req.body;

    const validRoles = ["patient", "admin", "provider", "reception"];
    if (!validRoles.includes(role))
      return res.status(400).json({ err: "Invalid role." });

    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ err: "Username already taken." });

    const bcrypt = require("bcrypt");
    const saltRounds = 12;

    const effectiveCalendarId = calendarId || null;

    const user = await User.create({
      username,
      displayName,
      hashedPassword: bcrypt.hashSync(password, saltRounds),
      role,
      calendarId: effectiveCalendarId,
      active,
    });

    res.status(201).json(user.toJSON());
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

router.patch(
  "/:userId",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { role, calendarId, active, password, displayName } = req.body;

      const update = {};
      if (role !== undefined) {
        const validRoles = ["patient", "admin", "provider", "reception"];
        if (!validRoles.includes(role))
          return res.status(400).json({ err: "Invalid role." });
        update.role = role;
      }
      if (displayName !== undefined) update.displayName = displayName;
      if (calendarId !== undefined) update.calendarId = calendarId;
      if (active !== undefined) update.active = !!active;
      if (password) {
        const bcrypt = require("bcrypt");
        const saltRounds = 12;
        update.hashedPassword = bcrypt.hashSync(password, saltRounds);
      }

      const user = await User.findByIdAndUpdate(userId, update, { new: true });
      if (!user) return res.status(404).json({ err: "User not found." });

      res.json(user.toJSON());
    } catch (err) {
      res.status(500).json({ err: err.message });
    }
  }
);

router.get(
  "/",
  verifyToken,
  requireRole("admin", "reception"),
  async (req, res) => {
    try {
      const users = await User.find({}, "username displayName role active");
      res.json(users);
    } catch (err) {
      res.status(500).json({ err: err.message });
    }
  }
);

router.get(
  "/providers",
  verifyToken,
  requireRole("admin", "reception"),
  async (req, res) => {
    try {
      const providers = await User.find(
        { role: "provider" },
        "username displayName role calendarId active"
      ).sort({ username: 1 });
      res.json(providers);
    } catch (err) {
      res.status(500).json({ err: err.message });
    }
  }
);

router.get("/:userId", verifyToken, async (req, res) => {
  try {
    if (req.user._id !== req.params.userId) {
      return res.status(403).json({ err: "Unauthorized" });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ err: "User not found." });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

module.exports = router;
