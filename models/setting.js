const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Helper to get/set a single app-level doc
settingSchema.statics.get = async function (key) {
  const doc = await this.findOne({ key });
  return doc?.value ?? null;
};
settingSchema.statics.set = async function (key, value) {
  const doc = await this.findOneAndUpdate(
    { key },
    { $set: { value } },
    { upsert: true, new: true }
  );
  return doc.value;
};

module.exports = mongoose.model("Setting", settingSchema);
