import mongoose, { Schema, model } from "mongoose";

const appointmentSchema = new mongoose.Schema({
    patientName: {
        type: String,
        required: true
    },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime:{type:String,required:true},
    provider: { type: mongoose.Schema.Types.ObjectId, ref:'User',
        required: true },
    status: {
        type: String,
        enum: ['scheduled', 'checkedIn', 'completed'],
        required: true
    },
    reason:{type: String, required: true},
    patientInfo:[{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'patients'}],

    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref:'User',
        required: true },
    });

  


export default model('Appointments', appointmentSchema);
