// server.js
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { json } from 'express';
import router from './controllers/userCRUD.js';
import appointmentsRouter from './controllers/appointmentCRUD.js';
import authRouter from './controllers/auth.js';


dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const connect = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB')
};


connect();


//app routers
app.use(json());
app.use('/auth', authRouter);
app.use('/users', router);
app.use('/appointments', appointmentsRouter);



app.listen(PORT, () => {
  console.log('The express app is ready!');
});
