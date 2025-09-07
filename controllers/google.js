"use strict";

const express = require("express");
const { google } = require("googleapis");

const router = express.Router();

// Start OAuth: returns { url }
router.get("/oauth/google/app/url", (req, res) => {
  const { GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REDIRECT_URI } = process.env;
  if (!GCAL_CLIENT_ID || !GCAL_CLIENT_SECRET || !GCAL_REDIRECT_URI) {
    return res.status(500).json({ err: "Missing Google OAuth env vars." });
  }
  const oAuth2Client = new google.auth.OAuth2(
    GCAL_CLIENT_ID,
    GCAL_CLIENT_SECRET,
    GCAL_REDIRECT_URI
  );
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });
  res.json({ url });
});

// OAuth callback: exchange code → tokens, store in session, redirect to FE
router.get("/oauth/google/app/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ err: "Missing ?code" });

  const { GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REDIRECT_URI } = process.env;
  const oAuth2Client = new google.auth.OAuth2(
    GCAL_CLIENT_ID,
    GCAL_CLIENT_SECRET,
    GCAL_REDIRECT_URI
  );

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    req.session.tokens = tokens;
    res.redirect("http://localhost:5173/connected");
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ err: err.message });
  }
});

// Optional disconnect
router.post("/oauth/google/app/disconnect", (req, res) => {
  req.session.tokens = null;
  res.json({ ok: true });
});

module.exports = router;
