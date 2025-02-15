const express = require('express');
const Attendance = require('./attendance.js');

const router = express.Router();

// GET all attendance records
router.get('/attendance', async (req, res) => {
  const records = await Attendance.find().populate('student class');
  res.json(records);
});

// POST a new attendance record
router.post('/attendance', async (req, res) => {
  try {
    const newAttendance = new Attendance(req.body);
    await newAttendance.save();
    res.status(201).json(newAttendance);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
