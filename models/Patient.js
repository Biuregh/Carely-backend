const mongoose =require("mongoose");

const patientSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, unique: true, required: true, lowercase: true },
        dob: { type: Date, required: true },
        phone: { type: String, required: true },
        notes: String,
        allergies: [String],
        medication: [String]
    },
    { timestamps: true }
);

module.exports = mongoose.model("Patient", patientSchema)
