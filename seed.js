const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const studentModel = require("./databases/student.js");
const adminModel = require("./databases/admin.js");
const attendanceModel = require("./databases/attendance.js");
const classModel = require("./databases/class.js");
const resultModel = require("./databases/result.js");
const notificationModel = require("./databases/notification.js");
const studentNotificationModel = require("./databases/studentNotification");
mongoose.connect("mongodb://localhost:27017/ICAT");

app.get("/seed", function (req, res) {
  async function clearDatabase() {
    await adminModel.deleteMany({});
    await notificationModel.deleteMany({});
    await attendanceModel.deleteMany({});
    await classModel.deleteMany({});
    await studentModel.deleteMany({});
    await resultModel.deleteMany({});
    await studentNotificationModel.deleteMany({});
  }

  // Seed the database with sample data
  async function seedDatabase() {
    const hash = await bcrypt.hash("a", 10);
    try {
      // Clear the database first
      await clearDatabase();

      // Create an admin
      const admin = new adminModel({
        adminId: "admin001",
        firstName: "John",
        lastName: "Doe",
        email: "a@a.a",
        password: hash,
        role: "admin",
      });
      await admin.save();

      // Create students
      const student1 = new studentModel({
        studentId: "student001",
        firstName: "Alice",
        lastName: "Smith",
        age: 20,
        email: "s@s.s",
        password: hash,
        faceDescriptors: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ],
        batch: 2020,
        department: "Computer Science",
        semester: 5,
      });

      const student2 = new studentModel({
        studentId: "student002",
        firstName: "Bob",
        lastName: "Johnson",
        age: 21,
        email: "bob@example.com",
        password: hash,
        faceDescriptors: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ],
        batch: 2020,
        department: "Mathematics",
        semester: 5,
      });

      await student1.save();
      await student2.save();

      // Create classes
      const class1 = new classModel({
        className: "CS101",
        subject: "Introduction to Computer Science",
        teacher: "Dr. Smith",
        schedule: [
          { day: "Monday", startTime: "09:00", endTime: "11:00" },
          { day: "Wednesday", startTime: "09:00", endTime: "11:00" },
        ],
      });

      const class2 = new classModel({
        className: "MATH101",
        subject: "Calculus I",
        teacher: "Dr. Johnson",
        schedule: [
          { day: "Tuesday", startTime: "10:00", endTime: "12:00" },
          { day: "Thursday", startTime: "10:00", endTime: "12:00" },
        ],
      });

      await class1.save();
      await class2.save();

      // Enroll students in classes
      student1.enrolledClasses.push(class1._id);
      student2.enrolledClasses.push(class2._id);

      await student1.save();
      await student2.save();

      // Create attendance records
      const attendance1 = new attendanceModel({
        student: student1._id,
        class: class1._id,
        date: new Date(),
        status: "present",
      });

      const attendance2 = new attendanceModel({
        student: student2._id,
        class: class2._id,
        date: new Date(),
        status: "absent",
      });

      await attendance1.save();
      await attendance2.save();

      // Add attendance records to classes
      class1.attendanceRecords.push(attendance1._id);
      class2.attendanceRecords.push(attendance2._id);

      await class1.save();
      await class2.save();

      // Create results
      const result1 = new resultModel({
        student: student1._id,
        class: class1._id,
        marks: 85,
        grade: "A",
        examDate: new Date(),
      });

      const result2 = new resultModel({
        student: student2._id,
        class: class2._id,
        marks: 75,
        grade: "B",
        examDate: new Date(),
      });

      await result1.save();
      await result2.save();

      // Add results to students
      student1.results.push(result1._id);
      student2.results.push(result2._id);

      await student1.save();
      await student2.save();

      // Create notifications
      const notification1 = new notificationModel({
        message: "New class CS101 has been added.",
      });

      const notification2 = new notificationModel({
        message: "Your attendance for MATH101 is marked as absent.",
      });

      await notification1.save();
      await notification2.save();

      // Create student notifications
      const studentNotification1 = new studentNotificationModel({
        student: student1._id,
        message: "You have scored 85 in CS101.",
      });

      const studentNotification2 = new studentNotificationModel({
        student: student2._id,
        message: "You have scored 75 in MATH101.",
      });

      await studentNotification1.save();
      await studentNotification2.save();

      console.log("Database seeded successfully!");
    } catch (error) {
      console.error("Error seeding database:", error);
    } finally {
      mongoose.connection.close();
    }
  }

  // Run the seed function
  seedDatabase();
  res.send("Database seeded successfully.");
});

app.listen(5000, function () {
  console.log("Server is running on port 5000");
});
