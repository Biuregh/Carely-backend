const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },

    // keep hashed password; never store raw password
    hashedPassword: { type: String, required: true },

    // roles
    role: {
      type: String,
      enum: ["patient", "admin", "provider", "reception"],
      default: "patient",
      required: true,
    },

    // for providers: the Google Calendar ID to write to
    calendarId: { type: String, default: null },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.hashedPassword;
  },
});

module.exports = mongoose.model("User", userSchema);
