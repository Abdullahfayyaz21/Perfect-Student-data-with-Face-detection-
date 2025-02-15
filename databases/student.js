const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const StudentSchema = new Schema({
  studentId: { type: String, required: true, unique: true }, 
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  age: { type: Number, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "student", enum: ["student"] },
  faceDescriptors: {
    type: [[Number]],
    validate: {
      validator: function (arr) {
        return arr.length === 3; 
      },
      message: "Face descriptors for exactly 3 pictures are required.",
    },
  },
  enrolledClasses: [{ type: Schema.Types.ObjectId, ref: "Class" }],
  attendanceRecords: [{ type: Schema.Types.ObjectId, ref: "Attendance" }],
  absents: { type: Number, default: 0 },
  results: [{ type: Schema.Types.ObjectId, ref: "Result" }],
  gpa: { type: Number, default: 0 },
  phone: { type: Number, default: null },
  address: { type: String, default: null },
  batch: { type: Number, required: true, min: 2000, max: 3000 }, 
  department: { type: String, required: true }, 
  semester: { type: Number, required: true, min: 1, max: 8 }, 
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
StudentSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Student", StudentSchema);