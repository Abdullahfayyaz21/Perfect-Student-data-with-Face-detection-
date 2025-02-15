const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AttendanceSchema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  class: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  date: { type: Date, required: true },
  status: { type: String, enum: ['present', 'absent', 'onLeave'], required: true }
});

// Add a unique compound index
AttendanceSchema.index({ student: 1, class: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);