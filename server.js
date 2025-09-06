const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieSession = require("cookie-session");
const PORT = process.env.PORT || 3000;


// Routers
const authRouter = require("./controllers/auth");
const testJwtRouter = require("./controllers/test-jwt");
const usersRouter = require("./controllers/users");
const gcalRouter = require("./controllers/gcal"); // <-- NEW
const patientsRouter = require("./routes/patientRoutes")

// --- DB ---
mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on("connected", () => {
  console.log(`Connected to MongoDB ${mongoose.connection.name}.`);
});

const app = express();

// --- Middlewares ---
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(
  cookieSession({
    name: "sess",
    keys: [process.env.SESSION_SECRET],
    httpOnly: true,
    sameSite: "lax",
  })
);
app.use(morgan("dev"));
app.use("/patients", patientsRouter);

// --- Health check ---
app.get("/healthz", (req, res) => res.json({ ok: true }));

// --- App routers ---
app.use("/auth", authRouter);
app.use("/test-jwt", testJwtRouter); 
app.use("/users", usersRouter);
app.use(gcalRouter); // <-- mounts /oauth/google and /api/gcal/*

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(PORT, () => {
  console.log("Backend running on http://localhost:" + PORT);
});
