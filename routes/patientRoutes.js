const express = require("express");
const patient = require("../controllers/patientController");

const router = express.Router();

router.get("/", patient.getPatients);
router.get("/:id", patient.getPatient);
router.post("/", patient.createPatient);
router.put("/:id", patient.updatePatient);
router.delete("/:id", patient.deletePatient);

model.exports = router;
