const Patient = require("../models/patient");

const getPatients = async (req, res) => {
    try {
        const { name, phone, dob, email } = req.query;
        const filter = {};

        if (name) filter.name = new RegExp(name, "i");
        if (phone) filter.phone = new RegExp(phone,"i");
        if (email) filter.email = new RegExp(email,"i");
        if(dob) filter.dob = dob;

        const patients = await Patient.find(filter);
        res.json(patients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

const getPatient = async (req, res) => {
    try {
        const patient = await Patient.findById(req.params.id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });
        res.json(patient);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const createPatient = async (req, res) => {
    try {
        if(req.body.dob){
            req.body.dob = new Date(req.body.dob)
        }
        const patient = await Patient.create(req.body)
        res.status(201).json(patient);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }

}

const updatePatient = async (req, res) => {
    try {
        if(req.body.dob){
            req.body.dob = new Date(req.body.dob)
        }
        const patient = await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!patient) return res.status(404).json({ error: "Patient not found" })
        res.json(patient)
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}

const deletePatient = async (req, res) => {
    try {
        const patient = await Patient.findByIdAndDelete(req.params.id);
        if (!patient) return res.status(404).json({ error: "Patient not found" })
        res.json({ message: "Deleted" })
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getPatient,
    getPatients,
    createPatient,
    updatePatient,
    deletePatient
}