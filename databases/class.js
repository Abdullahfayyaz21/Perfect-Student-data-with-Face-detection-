const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ClassSchema = new Schema({
  className: { type: String, required: true },
  subject: { type: String, required: true },
  teacher: { type: String },
  students: { type: [Schema.Types.ObjectId], ref: 'Student', default: [] },
  schedule: [
    {
      day: { type: String, required: true }, 
      startTime: { type: String, required: true }, 
      endTime: { type: String, required: true } 
    }
  ],
  createdAt: { type: Date, default: Date.now },
  attendanceRecords: [{ type: Schema.Types.ObjectId, ref: 'Attendance' }],
  results: [{ type: Schema.Types.ObjectId, ref: 'Result' }]
});

module.exports = mongoose.model('Class', ClassSchema);
