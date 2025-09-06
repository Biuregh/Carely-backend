const express = require("express");
const User = require("../models/user");
const verifyToken = require("../middleware/verify-token");
const requireRole = require("../middleware/require-role");

const router = express.Router();

// GET /users/providers  (list providers, admin/reception only)
router.get(
  "/providers",
  verifyToken,
  requireRole("admin", "reception"),
  async (req, res) => {
    try {
      const providers = await User.find(
        { role: "provider" },
        "username role calendarId active"
      ).sort({ username: 1 });
      res.json(providers);
    } catch (err) {
      res.status(500).json({ err: err.message });
    }
  }
);

// GET /users  (list basic info)
router.get("/", verifyToken, async (req, res) => {
  try {
    const users = await User.find({}, "username");
    res.json(users);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

// GET /users/:userId  (only allow your own record)
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
