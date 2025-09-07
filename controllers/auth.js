const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/user");

const router = express.Router();
const saltRounds = 12;

// PUBLIC sign-up -> always patient
router.post("/sign-up", async (req, res) => {
  try {
    const { username, password } = req.body;

    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ err: "Username already taken." });

    const user = await User.create({
      username,
      hashedPassword: bcrypt.hashSync(password, saltRounds),
      role: "patient",
      calendarId: null,
    });

    const payload = { _id: user._id, username: user.username, role: user.role };
    const token = jwt.sign({ payload }, process.env.JWT_SECRET);
    res.status(201).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

// Sign-in (unchanged)
router.post("/sign-in", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username });
    if (!user) return res.status(401).json({ err: "Invalid credentials." });

    const ok = bcrypt.compareSync(req.body.password, user.hashedPassword);
    if (!ok) return res.status(401).json({ err: "Invalid credentials." });

    const payload = { _id: user._id, username: user.username, role: user.role };
    const token = jwt.sign({ payload }, process.env.JWT_SECRET);
    res.status(200).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

// one-time bootstrap admin (to be able to create other users and assign roles)
router.post("/bootstrap-admin", async (req, res) => {
  try {
    const existingAdmin = await User.findOne({ role: "admin" });
    if (existingAdmin)
      return res.status(409).json({ err: "Admin already exists." });

    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ err: "username and password required." });

    const user = await User.create({
      username,
      hashedPassword: bcrypt.hashSync(password, saltRounds),
      role: "admin",
      calendarId: null,
      active: true,
    });

    const payload = { _id: user._id, username: user.username, role: user.role };
    const token = jwt.sign({ payload }, process.env.JWT_SECRET);
    res.status(201).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

module.exports = router;
