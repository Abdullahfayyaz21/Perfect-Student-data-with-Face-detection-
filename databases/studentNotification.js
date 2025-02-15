const mongoose = require("mongoose");

const studentNotificationSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
});
const StudentNotification = mongoose.model(
  "StudentNotification",
  studentNotificationSchema
);

module.exports = StudentNotification;
