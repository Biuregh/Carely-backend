# Carely 🏥

![Carely Logo](https://i.imgur.com/ko0MNnd.jpeg)  
_A Modern Appointment Scheduling & Patient Check-In Platform_

---

## Overview

Carely is a full-stack solution designed to simplify appointment scheduling and patient check-ins for clinics, hospitals, dentists, and service providers. The platform offers tailored tools for patients, receptionists, providers, and administrators in one integrated system.  
Built with a modern MERN stack, Carely supports patient management, appointment scheduling, secure authentication, and real-time check-in tracking. With **Google Calendar synchronization**, providers can manage their agendas seamlessly across platforms.

---

## Why Carely?

Managing patient check-ins and appointments is one of the biggest challenges for healthcare and service providers. Carely addresses this by offering:

- **Beginner-Friendly Development Scope** – CRUD functionality (Create, Read, Update, Delete) built step by step.
- **Team Collaboration Ready** – Divided into clear modules for efficient teamwork.
- **Realistic and Useful** – Solves real-world scheduling and check-in problems.
- **Achievable** – Well-scoped project ideal for both learning and practical deployment.

---

## MVP Features

### Patient

- Check in using phone number + DOB.
- Update personal information during check-in.
- View appointment status (scheduled, checked-in, completed).
- Receive confirmation after check-in.

### Receptionist

- Add new patients (name, DOB, phone, email).
- Schedule, reschedule, or cancel appointments.
- View daily appointment calendar.

### Provider

- View daily or weekly appointment calendar.

### Admin

- Create, manage, or remove staff and provider accounts.
- Assign roles (receptionist, provider, admin).
- View reports (check-ins, no-shows, appointment volume).
- Access activity logs for system security.

---

## Main Features

- **Authentication & Role-Based Access**
- **Patient Management (CRUD)**
- **Patient Check-In Flow**
- **Appointment Scheduling & Status Tracking**
- **Provider Dashboard**
- **Admin Tools**
- **Google Calendar Synchronization**
- **Testing & Review**

---

## Stretch Goals

- SMS/email reminders for patients.
- Manage multiple clinic locations.
- Insurance filters for patient bookings.

---

## Entity Relationship

```
USER  {
    _id: ObjectId,
    username: String(required)
    displayName: String (required),
    hashedPassword: String (required),
    role: { type: String, enum: ["admin","provider","reception"], required: true },
    active: Boolean
}
PATIENT {
    _id: ObjectId,
    name: String (required),
    dob: Date (required),
    email: String (required),
    phone: String (required),
    notes: String,
    allergies: [String],
    medicatons: [String]
}
APPOINTMENT {
    _id: ObjectId,
    code: String,
    date: Date (required),
    startTime: Time (required),
    endTime: Time (required),
    providerId: ObjectId (ref: "USER", required),
    patientId: ObjectId (ref: "PATIENT", required),
    createdById: ObjectId (ref: "USER", required),
    status: { type: String, enum: ["scheduled","checkIn","completed", "canceled", "noShow"], required: true },
    reason: String,
    googleEventId: String
}
```

---

## Auth & Users\*\*

| Action  | Route                | HTTP Verb |
| ------- | -------------------- | --------- |
| Sign-up | auth/sign-up,        | POST      |
| Sign-in | auth/sign-in,        | POST      |
|         | auth/bootstrap-admin | POST      |

### Appointment Routes

| Action | Route                                           | HTTP Verb |
| ------ | ----------------------------------------------- | --------- |
| Index  | /users/:userId/appointments                     | GET       |
| New    | /users/:userId/appointments/new                 | GET       |
| Create | /users/:userId/appointments                     | POST      |
| Show   | /users/:userId/appointments/:appointmentId      | GET       |
| Edit   | /users/:userId/appointments/:appointmentId/edit | GET       |
| Update | /users/:userId/appointments/:appointmentId      | PUT       |
| Delete | /users/:userId/appointments/:appointmentId      | DELETE    |

### Patient Routes

| Action | Route                | HTTP Verb |
| ------ | -------------------- | --------- |
| Index  | /patients            | GET       |
| New    | /patients/new        | GET       |
| Create | /patients            | POST      |
| Show   | /patients/:Id        | GET       |
| Edit   | /patients/:Id/edit   | GET       |
| Update | /patients/:patientId | PUT       |
| Delete | /patients/:patientId | DELETE    |

---

## Tech Stack

- **Frontend**: React + CSS
- **Backend**: Express.js + Node.js
- **Database**: MongoDB
- **Authentication**: JWT + bcrypt
- **Calendar Integration**: Google Calendar API
- **Version Control**: Git + GitHub

---

## Visuals

![Patient Check-in](patient-checkin.png)
Patient Kiosk — simple check-in by name + DOB/phone.
![Create New Patient](create-new-patient.png)
Create New Patient — simple creating new patient by receptionist.
![Create an Appointment](make-an-appointment.png)
Create New Appointmentt — Create new appointment by choosing a customer, provider, date and time.
![Calendar](calendare.png)
Calendar-look
![Appointment Manager](appointment-manager.png)
Manage the Appointments- Simple cancel and Reschedule appointments
