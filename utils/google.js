const { google } = require("googleapis");

// OAuth2 client from env
function makeOAuth() {
  return new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI
  );
}

// Require Google cookie-session tokens
function requireGoogle(req, res, next) {
  if (!req.session || !req.session.tokens) {
    return res.status(401).json({ error: "Not connected to Google" });
  }
  next();
}

// Free/busy helper
async function getFreeBusy(oauth2, { calendarId, startISO, endISO }) {
  const calendar = google.calendar({ version: "v3", auth: oauth2 });
  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      items: [{ id: calendarId }],
    },
  });
  const busy =
    (data.calendars &&
      data.calendars[calendarId] &&
      data.calendars[calendarId].busy) ||
    [];
  return { busy, free: busy.length === 0 };
}

module.exports = { makeOAuth, requireGoogle, getFreeBusy };
