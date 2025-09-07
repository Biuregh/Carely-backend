const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    displayName: { type: String, default: "" },
    hashedPassword: { type: String, required: true },
    role: {
      type: String,
      enum: ["patient", "admin", "provider", "reception"],
      default: "patient",
      required: true,
    },
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
