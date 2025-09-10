"use strict";

const { google } = require("googleapis");

function makeOAuth() {
  return new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI
  );
}

function requireGoogle(req, res, next) {
  if (req?.session?.tokens) return next();
  res.status(401).json({ err: "Not connected to Google" });
}

function getOAuthClient(req) {
  const auth = makeOAuth();
  if (req?.session?.tokens) auth.setCredentials(req.session.tokens);
  return auth;
}

async function startUrl(req, res) {
  const { GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REDIRECT_URI } = process.env;
  if (!GCAL_CLIENT_ID || !GCAL_CLIENT_SECRET || !GCAL_REDIRECT_URI) {
    return res.status(500).json({ err: "Missing Google OAuth env vars." });
  }
  const oAuth2 = makeOAuth();
  const url = oAuth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });
  res.json({ url });
}

async function callback(req, res) {
  const code = req.query.code;
  if (!code) return res.status(400).json({ err: "Missing ?code" });
  try {
    const oAuth2 = makeOAuth();
    const { tokens } = await oAuth2.getToken(code);
    req.session.tokens = tokens;

    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${FRONTEND_URL}/connected`);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
}

function disconnect(req, res) {
  req.session.tokens = null;
  res.json({ ok: true });
}

module.exports = {
  makeOAuth,
  requireGoogle,
  getOAuthClient,
  startUrl,
  callback,
  disconnect,
};
