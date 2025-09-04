const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/user");

const router = express.Router();
const saltRounds = 12;

// POST /auth/sign-up
router.post("/sign-up", async (req, res) => {
  try {
    const exists = await User.findOne({ username: req.body.username });
    if (exists) return res.status(409).json({ err: "Username already taken." });

    const user = await User.create({
      username: req.body.username,
      hashedPassword: bcrypt.hashSync(req.body.password, saltRounds),
    });

    const payload = { username: user.username, _id: user._id };
    const token = jwt.sign({ payload }, process.env.JWT_SECRET);
    res.status(201).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

// POST /auth/sign-in
router.post("/sign-in", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username });
    if (!user) return res.status(401).json({ err: "Invalid credentials." });

    const ok = bcrypt.compareSync(req.body.password, user.hashedPassword);
    if (!ok) return res.status(401).json({ err: "Invalid credentials." });

    const payload = { username: user.username, _id: user._id };
    const token = jwt.sign({ payload }, process.env.JWT_SECRET);
    res.status(200).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

module.exports = router;
