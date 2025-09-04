const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  hashedPassword: { type: String, required: true },
});

userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.hashedPassword;
  },
});

module.exports = mongoose.model("User", userSchema);
