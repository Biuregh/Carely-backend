const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

// GET /test-jwt/sign-token  (quick demo token)
router.get("/sign-token", (req, res) => {
  const payload = { _id: "1", username: "test" };
  const token = jwt.sign({ payload }, process.env.JWT_SECRET);
  res.json({ token });
});

// POST /test-jwt/verify-token (verify Authorization: Bearer <token>)
router.post("/verify-token", (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    const token = parts.length === 2 && parts[0] === "Bearer" ? parts[1] : null;
    if (!token) return res.status(401).json({ err: "No token." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ decoded });
  } catch (err) {
    res.status(401).json({ err: "Invalid token." });
  }
});

module.exports = router;
