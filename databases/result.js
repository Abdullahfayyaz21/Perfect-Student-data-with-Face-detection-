const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ResultSchema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  class: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  marks: { type: Number, required: true },
  grade: { type: String },
  examDate: { type: Date, required: true }
});

module.exports = mongoose.model('Result', ResultSchema);
