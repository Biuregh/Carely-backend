import appointments from '../models/appointments.js';
import verifyToken from '../middleware/verify-token.js';
import { Router } from 'express';
const appointmentsRouter = Router();


// CREATE POST- create new appointment
appointmentsRouter.post('/', verifyToken, async (req, res) => {
    try {
    
        const createNewAppointment = await appointments.create(req.body)

        res.status(200).json(createNewAppointment)
    } catch (err) {
        res.status(500).json({ err: err.message })
    }
})

// READ - GET Find all appointments
c

//  GET specific appointments by their id from appointments/appointmentId
appointmentsRouter.get('/:appointmentsId', verifyToken, async (req, res) => {
    try {
        const findAppointment = await appointments.findById(req.params.appointmentsId)

        if (!findAppointment) {
            res.status(404)
            throw new Error("Appointment not found")
        }
        res.status(200).json(findAppointment)
    } catch (err) {

        res.status(500).json({ err: err.message })

    }
})

// DELETE - DELETE appointments from /appointments/appointmentId
appointmentsRouter.delete('/:appointmentId', verifyToken, async (req, res) => {
    try {
        const deleteAppointment = await appointments.findByIdAndDelete(req.params.appointmentId)
        if (!deleteAppointment) {
            res.status(404)
            throw new Error("No appointment found to delete")
        }
        res.status(200).json(deleteAppointment)
    } catch (err) {

        res.status(500).json({ err: err.message })

    }
})

// UPDATE appointmentInfo - /appointments/appointmentId
appointmentsRouter.put('/:appointmentId', verifyToken, async (req, res) => {
    try {
        const updateAppointment = await appointments.findByIdAndUpdate(req.params.appointmentId, req.body, { new: true })
        if (!updateAppointment) {
            res.status(404)
            throw new Error("No appointmemt found to update")
        }

        res.status(200).json(updateAppointment)
    } catch (err) {

        res.status(500).json({ err: err.message })
    }

})

export default appointmentsRouter;