const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const cookieSession = require("cookie-session");
const PORT = process.env.PORT || 3000;

const authRouter = require("./controllers/auth");
const testJwtRouter = require("./controllers/test-jwt");
const usersRouter = require("./controllers/users");
const gcalRoutes = require("./routes/gcal.routes");
const googleRoutes = require("./routes/google.routes");

mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on("connected", () => {
  console.log(`Connected to MongoDB ${mongoose.connection.name}.`);
});

const app = express();

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
app.use(morgan("tiny"));

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/test-jwt", testJwtRouter);
app.use("/users", usersRouter);
app.use(gcalRoutes);
app.use(googleRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ err: String(err.message || err) });
});

app.listen(PORT, () => {
  console.log("Backend running on http://localhost:" + PORT);
});
