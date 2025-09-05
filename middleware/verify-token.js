const jwt = require("jsonwebtoken");

function verifyToken(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    const token = parts.length === 2 && parts[0] === "Bearer" ? parts[1] : null;
    if (!token) return res.status(401).json({ err: "No token." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.payload;
    next();
  } catch (err) {
    res.status(401).json({ err: "Invalid token." });
  }
}

module.exports = verifyToken;
