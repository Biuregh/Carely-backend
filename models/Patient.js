import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
    {
        name: { type: String, required },
        email: { type: String, unique: true, required },
        dob: { type: Date, required },
        ohone: { type: String, required },
        notes: String,
        allergies: [String],
        medication: [String]
    },
    { timestamps: true }
);

export default mongoose.model("Patient", patientSchema);
