import { Router } from "express";
import patient from "../controllers/patientController";

const router = Router();

router.get("/", patient.getPatients);
router.get("/:id", patient.getPatient);
router.post("/", patient.createPatient);
router.put("/:id", patient.updatePatient);
router.delete("/:id", patient.deletePatient);

export default router;
