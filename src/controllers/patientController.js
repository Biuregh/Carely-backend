import Patient from "../models/Patient";

const getPatients = async (req, res) => {
    try {
        const {}
        const patients = await Patient.find();
        res.json(patients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

const getPatient = async (req, res) => {
    try {
        const patient = await Patient.findById(req.param.id);
        if (!patient) return res.status(404).json({ error: "Patient not found" });
        res.json(patient);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const createPatient = async (req, res) => {
    try {
        const patient = await Patient.create(req.body)
        res.json(patient);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }

}

const updatePatient = async (req, res) => {
    try {
        const patient = await Patient.findByIdAndUpdate(req.param.id, req.body, { new: true });
        if (!patient) return res.status(404).json({ error: "Patient not found" })
        res.json(patient)
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}

const deletePatient = async (req, res) => {
    try {
        const patient = Patient.findByIdAndDelete(req.params.id);
        if (!patient) return res.status(404).json({ error: "Patient not found" })
        res.jason({ message: "Deleted" })
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export default{
    getPatient,
    getPatients,
    createPatient,
    updatePatient,
    deletePatient
}