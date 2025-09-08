
import User from '../models/user.js';
import { Router } from 'express';
const router = Router();
import verifyToken from '../middleware/verify-token.js';
//import requireRole from '../middleware/require-role.js';

// CREATE POST- create new users /users = (receptionist or doctors)
router.post('/', verifyToken,async (req, res) => {
    try {

        const createNewUser = await User.create(req.body)

        res.status(200).json(createNewUser)
    } catch (err) {
        res.status(500).json({ err: err.message })
    }
})

// READ - GET Find all users:  /users = receptionist or doctors
router.get('/', verifyToken,async (req, res) => {
    try {
        const listOfUsers = await User.find()

        res.status(200).json(listOfUsers)
    } catch (err) {
        res.status(500).json({ err: err.message })
    }
})

//  GET specific user  /users/:userId
router.get('/:userId', verifyToken,async (req, res) => {
    try {
        if (req.user._id !== req.params.userId) {
            return res.status(403).json({ err: "Unauthorized" });
        }
        const findUser = await User.findById(req.params.userId)

        if (!findUser) {
            res.status(404)
            throw new Error("User not found")
        }
        res.status(200).json(findUser)
    } catch (err) {

        res.status(500).json({ err: err.message })

    }
})

// DELETE - DELETE userInfo from /user/:userID
router.delete('/:userId', verifyToken, async (req, res) => {
    try {
        const deleteUser = await User.findByIdAndDelete(req.params.userId)
        if (!deleteUser) {
            res.status(404)
            throw new Error("No user found to delete")
        }
        res.status(200).json(deleteUser)
    } catch (err) {

        res.status(500).json({ err: err.message })

    }
})

// UPDATE userInfo from /users/:userId
router.put('/:userId', verifyToken,async (req, res) => {
    try {
        const userToBeUpdated = await User.findByIdAndUpdate(req.params.userId, req.body, { new: true })
        if (!userToBeUpdated) {
            res.status(404)
            throw new Error("No user found to be updated")
        }

        res.status(200).json(userToBeUpdated)
    } catch (err) {

        res.status(500).json({ err: err.message })
    }

})


export default router;