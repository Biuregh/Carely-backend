import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { google } from 'googleapis';

const app = express();

// allow your React dev origin to send cookies
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieSession({
  name: 'sess',
  keys: [process.env.SESSION_SECRET],
  httpOnly: true,
  sameSite: 'lax'
}));

function makeOAuth() {
  return new google.auth.OAuth2(
    process.env.GCAL_CLIENT_ID,
    process.env.GCAL_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI
  );
}

// === Auth: start OAuth
app.get('/auth/google', (req, res) => {
  const oauth2 = makeOAuth();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',        // so we get a refresh_token
    prompt: 'consent',             // force consent during dev
    scope: ['https://www.googleapis.com/auth/calendar.events']
  });
  res.redirect(url);
});

// === Auth: callback
app.get('/auth/google/callback', async (req, res, next) => {
  try {
    const oauth2 = makeOAuth();
    const { tokens } = await oauth2.getToken(req.query.code);
    req.session.tokens = tokens;   // demo storage; use DB per user in prod
    res.redirect('http://localhost:5173/connected');
  } catch (err) { next(err); }
});

function requireGoogle(req, res, next) {
  if (!req.session?.tokens) return res.status(401).json({ error: 'Not connected to Google' });
  next();
}

// === Create an event
app.post('/api/gcal/events', requireGoogle, async (req, res, next) => {
  try {
    const { summary, description, startISO, endISO, attendeeEmails = [] } = req.body;

    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description,
        start: { dateTime: startISO },   
        end:   { dateTime: endISO },
        attendees: attendeeEmails.map(email => ({ email })),
        reminders: { useDefault: true }
      }
    });

    res.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
  } catch (err) { next(err); }
});

// === List agenda for a day
app.get('/api/gcal/agenda', requireGoogle, async (req, res, next) => {
  try {
    const day = req.query.day; // "2025-09-02"
    const start = new Date(`${day}T00:00:00Z`).toISOString();
    const end   = new Date(`${day}T23:59:59Z`).toISOString();

    const oauth2 = makeOAuth();
    oauth2.setCredentials(req.session.tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2 });
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: start,
      timeMax: end
    });

    res.json({ events: data.items || [] });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(process.env.PORT, () => {
  console.log('Backend running on http://localhost:' + process.env.PORT);
});
