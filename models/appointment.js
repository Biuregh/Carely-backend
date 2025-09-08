"use strict";

const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true },

    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },

    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    googleEventId: { type: String, trim: true },

    status: {
      type: String,
      enum: ["Scheduled", "Confirmed", "CheckIn", "Completed", "Cancelled"],
      default: "Scheduled",
      required: true,
    },
  },
  { timestamps: true }
);

AppointmentSchema.index({ date: 1, startTime: 1 });
AppointmentSchema.index({ providerId: 1, date: 1, startTime: 1 });

module.exports =
  mongoose.models.Appointment ||
  mongoose.model("Appointment", AppointmentSchema);
