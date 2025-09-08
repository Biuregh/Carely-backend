import appointments from '../models/appointments.js';
import verifyToken from '../middleware/verify-token.js';
import requireRole from '../middleware/require-role.js';

import { Router } from 'express';
const appointmentsRouter = Router();


// CREATE POST- create new appointment
appointmentsRouter.post('/', verifyToken, requireRole("reception"),  async (req, res) => {
    try {
    
        const createNewAppointment = await appointments.create(req.body)

        res.status(200).json(createNewAppointment)
    } catch (err) {
        res.status(500).json({ err: err.message })
    }
})

appointmentsRouter.get('/', verifyToken, async (req, res) => {
  try {
    const { date } = req.query;
    const filter = {};

    // Filter by date if provided (and not 'all')
    if (date && date !== 'all') {
      filter.date = date;
    }

    // Filter based on role
    if (req.user.role === 'provider') {
      // Doctor sees only their own appointments
      filter.doctor.id = req.user.id;
    } 
    
    const listOfAppointments = await appointments.find(filter).populate('doctor');

    res.status(200).json(listOfAppointments);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

appointmentsRouter.patch('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['scheduled', 'check in', 'in progress', 'completed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }


    const updatedAppointment = await appointments.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).populate('doctor'); 

    if (!updatedAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    res.status(200).json(updatedAppointment);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});



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
        const updateAppointment = await appointments.findByIdAndUpdate(req.params.appointmentId, req.body, { new: true }).populate('doctor'); 
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