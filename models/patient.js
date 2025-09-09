import mongoose, { Schema, model } from "mongoose";

const patientSchema = new mongoose.Schema({
    patientName: {
        type: String,
        required: true
    },
    email:{type:String, required:true},
    phone:{type: Number, required:true},
    dob:{type:String, required:true},
    gender:{type:String },
    address:{type: String},
    city:{type:String},
    state: { type: String },
    zip:{type:String},
    insuranceProvider: { type: String},
    memberId:{type:String},
    symptoms: { type: String },
    medications: { type: String, required: true },
    appointments:[{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'appointments'}]
});


export default model("patients", patientSchema);
