const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const bcrypt = require("bcrypt");
const studentModel = require("./databases/student.js");
const adminModel = require("./databases/admin.js");
const attendanceModel = require("./databases/attendance.js");
const classModel = require("./databases/class.js");
const resultModel = require("./databases/result.js");
const notificationModel = require("./databases/notification.js");
const studentNotificationModel = require("./databases/studentNotification");
const SECRET_KEY = "icat";

mongoose.connect("mongodb://localhost:27017/ICAT");

app.use(express.json(), express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/*========================================================================================================================*/

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

/*========================================================================================================================*/

const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.redirect("/admin/login");

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.admin = decoded;
    next();
  } catch (err) {
    res.clearCookie("token");
    return res.redirect("/admin/login");
  }
};

const verifyStudentToken = (req, res, next) => {
  const token = req.cookies.studentToken;
  if (!token) {
    return res.redirect("/student/login");
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    if (
      !decoded.id ||
      !decoded.email ||
      !decoded.role ||
      decoded.role !== "student"
    ) {
      console.error("Invalid or malformed token:", decoded);
      return res.redirect("/student/login");
    }

    req.student = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (err) {
    console.error("Error verifying token:", err.message);
    res.clearCookie("studentToken");
    return res.redirect("/student-login");
  }
};

/*========================================================================================================================*/

app.get("/", function (req, res) {
  res.render("index");
});

app.get("/main", function (req, res) {
  res.render("main");
});

/*========================================================================================================================*/

app.get("/admin/dashboard", verifyToken, async (req, res) => {
  try {
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    const adminId = req.admin.id;
    const admin = await adminModel.findById(adminId).lean();

    if (!admin) {
      return res.status(404).send("Admin not found.");
    }

    const totalStudents = await studentModel.countDocuments();

    const totalClasses = await classModel.countDocuments();

    const pendingApprovals = await studentModel.countDocuments({
      status: "pending",
    });

    const todaysDate = new Date();
    const todaysAttendanceRecords = await attendanceModel.find({
      date: {
        $gte: new Date(todaysDate.setHours(0, 0, 0, 0)),
        $lte: new Date(todaysDate.setHours(23, 59, 59, 999)),
      },
    });
    const totalStudentsToday = await studentModel.countDocuments();
    const todaysAttendance =
      totalStudentsToday > 0
        ? (
            (todaysAttendanceRecords.filter(
              (record) => record.status === "present"
            ).length /
              totalStudentsToday) *
            100
          ).toFixed(2)
        : 0;

    const recentActivities = [
      "A student submitted an assignment.",
      "A student marked attendance for English.",
      "New student registered.",
    ];

    res.render("admin", {
      admin,
      totalStudents,
      totalClasses,
      pendingApprovals,
      todaysAttendance,
      recentActivities,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

app.get("/admin-register", verifyToken, (req, res) => {
  res.render("admin-register", { error: null });
});

app.post("/admin-register", verifyToken, async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    const existingAdmin = await adminModel.findOne({ email });
    if (existingAdmin) {
      return res.render("admin-register", { error: "Email already exists!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = new adminModel({
      adminId: new mongoose.Types.ObjectId(),
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: "admin",
    });

    await admin.save();
    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error(error);
    res.render("admin-register", { error: "Something went wrong!" });
  }
});
/*========================================================================================================================*/

app.get("/admin/login", (req, res) => {
  if (req.cookies.token) return res.redirect("/admin/dashboard");
  res.render("admin-login", { error: null });
});

app.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await adminModel.findOne({ email });
    if (!admin) {
      return res.render("admin-login", { error: "Invalid credentials!" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.render("admin-login", { error: "Invalid credentials!" });
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      SECRET_KEY,
      { expiresIn: "24h" }
    );

    res.cookie("token", token, { httpOnly: true });

    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error(error);
    res.render("admin-login", { error: "Something went wrong!" });
  }
});

/*========================================================================================================================*/

app.get("/admin/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/admin/login");
});

/*========================================================================================================================*/

app.get("/student/dashboard", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 7;
    const skip = (page - 1) * limit;

    const student = await studentModel
      .findById(studentId)
      .populate({
        path: "enrolledClasses",
        model: "Class",
      })
      .populate({
        path: "attendanceRecords",
        populate: { path: "class", model: "Class" },
        options: { sort: { date: -1 }, limit, skip },
      })
      .populate({
        path: "results",
        populate: { path: "class", model: "Class" },
        options: { sort: { examDate: -1 }, limit, skip },
      });

    if (!student) {
      console.error("Student not found with ID:", studentId);
      return res.status(404).send("Student not found.");
    }

    // Format enrolled classes to include a readable schedule
    const enrolledClasses = student.enrolledClasses.map((cls) => {
      const formattedSchedule = cls.schedule.map((slot) => {
        return `${slot.day}, ${slot.startTime} - ${slot.endTime}`;
      });
      return {
        ...cls.toObject(),
        schedule: formattedSchedule.join("; "), // Combine all slots into a single string
      };
    });

    const attendance = student.attendanceRecords;
    const results = student.results.map((result) => ({
      ...result.toObject(),
      gradePoint: getGradePoint(result.grade),
    }));
    const gpa = calculateGPA(results);

    res.render("student-dashboard", {
      attendance,
      results,
      enrolledClasses,
      student,
      gpa,
      currentPage: page,
      limit,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

function getGradePoint(grade) {
  const gradeToPoint = {
    A: 4.0,
    B: 3.0,
    C: 2.0,
    D: 1.0,
    F: 0.0,
  };
  return gradeToPoint[grade] || 0;
}

function calculateGPA(results) {
  if (!results || results.length === 0) return 0;

  const gradeToPoint = {
    A: 4.0,
    B: 3.0,
    C: 2.0,
    D: 1.0,
    F: 0.0,
  };

  let totalCredits = 0;
  let totalPoints = 0;

  results.forEach((result) => {
    const credits = 3;
    const gradePoint = gradeToPoint[result.grade] || 0;
    totalCredits += credits;
    totalPoints += gradePoint * credits;
  });

  return totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : 0;
}

/*========================================================================================================================*/

app.get("/student/login", (req, res) => {
  if (req.cookies.studentToken) return res.redirect("/student/dashboard");
  res.render("student-login", { error: null });
});

app.post("/student/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const student = await studentModel.findOne({ email });
    if (!student) {
      return res.render("student-login", { error: "Invalid credentials!" });
    }

    // Compare the password
    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.render("student-login", { error: "Invalid credentials!" });
    }

    // Generate a JWT token
    const token = jwt.sign(
      { id: student._id, email: student.email, role: "student" }, // Include `id`
      SECRET_KEY,
      { expiresIn: "24h" }
    );

    // Set the token as a cookie
    res.cookie("studentToken", token, { httpOnly: true });

    // Redirect to the student dashboard
    res.redirect("/student/dashboard");
  } catch (error) {
    console.error(error);
    res.render("student-login", { error: "Something went wrong!" });
  }
});

// Route: Student Logout
app.get("/student/logout", (req, res) => {
  res.clearCookie("studentToken");
  res.redirect("/student/login");
});

/*========================================================================================================================*/
// Route: Show Student Registration Page (Admin Only)
app.get("/admin/student-register", verifyToken, (req, res) => {
  res.render("admin-student-register", { error: null });
});

// Route: Handle Student Registration (Admin Only)
app.post("/admin/student-register", verifyToken, async (req, res) => {
  try {
    const {
      studentId,
      firstName,
      lastName,
      age,
      email,
      password,
      phone,
      address,
      batch, // New field: Batch year
      semester, // New field: Semester
      department, // New field: Department
      faceDescriptor1,
      faceDescriptor2,
      faceDescriptor3,
    } = req.body;

    // Parse face descriptors from JSON strings to arrays
    const faceDescriptors = [
      JSON.parse(faceDescriptor1),
      JSON.parse(faceDescriptor2),
      JSON.parse(faceDescriptor3),
    ];

    // Validate that exactly 3 face descriptors were provided
    if (
      faceDescriptors.length !== 3 ||
      !faceDescriptors.every((descriptor) => Array.isArray(descriptor))
    ) {
      return res.render("admin-student-register", {
        error:
          "Invalid face descriptors. Please provide valid JSON arrays for all 3 descriptors.",
      });
    }

    // Check if the email or studentId already exists
    const existingStudent = await studentModel.findOne({
      $or: [{ email }, { studentId }],
    });
    if (existingStudent) {
      return res.render("admin-student-register", {
        error: "Email or Student ID already exists!",
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the new student
    const newStudent = new studentModel({
      studentId,
      firstName,
      lastName,
      age,
      email,
      password: hashedPassword,
      faceDescriptors,
      phone,
      address,
      batch, // Include batch
      semester, // Include semester
      department, // Include department
    });

    // Save the student to the database
    await newStudent.save();

    res.redirect("/admin/dashboard"); // Redirect to admin dashboard after successful registration
  } catch (error) {
    console.error(error);
    res.render("admin-student-register", { error: "Something went wrong!" });
  }
});

/*========================================================================================================================*/

app.get("/extractDescriptors", function (req, res) {
  res.render("upload");
});

/*========================================================================================================================*/
// Route: Get All Students with Filters and Search
app.get("/admin/students", verifyToken, async (req, res) => {
  try {
    const { classId, search } = req.query;

    // Build query object
    const query = {};

    // Filter by class
    if (classId) {
      query.enrolledClasses = classId;
    }

    // Search by name, email, or student ID
    if (search) {
      const searchRegex = new RegExp(search.trim(), "i"); // Case-insensitive regex
      query.$or = [
        { email: { $regex: searchRegex } }, // Match email
        { studentId: { $regex: searchRegex } }, // Match student ID
        {
          // Match concatenated firstName + lastName
          $expr: {
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: searchRegex,
            },
          },
        },
      ];
    }

    // Fetch students
    const students = await studentModel
      .find(query)
      .populate("enrolledClasses") // Populate enrolled classes
      .lean();

    // Fetch all classes for the filter dropdown
    const classes = await classModel.find().lean();

    // Render the Students Page
    res.render("students", {
      students,
      classes,
      filters: { classId, search }, // Pass filters back to the template
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Edit Student Page
app.get("/admin/students/:id/edit", verifyToken, async (req, res) => {
  try {
    const studentId = req.params.id;
    const student = await studentModel.findById(studentId);
    if (!student) {
      return res.status(404).send("Student not found.");
    }
    res.render("admin-student-edit", { student });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Update Student Details
app.post("/admin/students/:id/update", verifyToken, async (req, res) => {
  try {
    const studentId = req.params.id;
    const {
      firstName,
      lastName,
      age,
      email,
      phone,
      address,
      batch,
      semester,
      department,
      faceDescriptors,
    } = req.body;

    // Parse faceDescriptors into an array of arrays
    const parsedFaceDescriptors = Array.isArray(faceDescriptors)
      ? faceDescriptors.map((descriptor) => JSON.parse(descriptor))
      : [];

    // Find the student by ID
    const student = await studentModel.findById(studentId);
    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Update the student's details
    student.firstName = firstName;
    student.lastName = lastName;
    student.age = age;
    student.email = email;
    student.phone = phone;
    student.address = address;
    student.batch = batch;
    student.semester = semester;
    student.department = department;
    student.faceDescriptors = parsedFaceDescriptors;

    await student.save();
    res.redirect("/admin/students?success=Student updated successfully.");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Delete Student
app.post("/admin/students/:id/delete", verifyToken, async (req, res) => {
  try {
    const studentId = req.params.id;

    // Step 1: Find and delete the student by ID
    const deletedStudent = await studentModel.findByIdAndDelete(studentId);
    if (!deletedStudent) {
      return res.status(404).send("Student not found.");
    }

    // Step 2: Remove the student from all enrolled classes
    await classModel.updateMany(
      { students: studentId },
      { $pull: { students: studentId } }
    );

    // Step 3: Delete all attendance records associated with the student
    await attendanceModel.deleteMany({ student: studentId });

    // Step 4: Delete all result records associated with the student
    await resultModel.deleteMany({ student: studentId });

    // Step 5: Redirect to the students list page with a success message
    res.redirect("/admin/students?success=Student deleted successfully.");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: GET Student Details Page
app.get("/admin/students/:id/details", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the student by ID and populate related fields
    const student = await studentModel
      .findById(id)
      .populate("enrolledClasses") // Populate enrolled classes
      .populate({
        path: "attendanceRecords",
        populate: { path: "class", model: "Class" },
      })
      .populate({
        path: "results",
        populate: { path: "class", model: "Class" },
      })
      .lean();

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Render the student details page
    res.render("student-details", { student });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

app.get("/admin/classes", verifyToken, async (req, res) => {
  try {
    const { schedule, search } = req.query;

    // Build query object
    const query = {};

    // Filter by schedule
    if (schedule) {
      query.schedule = schedule;
    }

    // Search by class name or subject
    if (search) {
      query.$or = [
        { className: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
      ];
    }

    // Fetch classes
    const classes = await classModel.find(query).lean();

    // Render the Classes Page
    res.render("classes", {
      classes,
      filters: { schedule, search }, // Pass filters back to the template
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: Get All Attendance Records with Filters and Search
app.get("/admin/attendance", verifyToken, async (req, res) => {
  try {
    const { classId, startDate, endDate, status, search } = req.query;

    // Build query object
    const query = {};

    // Filter by class
    if (classId) {
      query.class = classId;
    }

    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    } else if (startDate) {
      query.date = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.date = { $lte: new Date(endDate) };
    }

    // Filter by attendance status
    if (status) {
      query.status = status;
    }

    // Search by student name, email, or student ID
    if (search) {
      const students = await studentModel
        .find({
          $or: [
            { firstName: { $regex: search, $options: "i" } },
            { lastName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { studentId: { $regex: search, $options: "i" } },
          ],
        })
        .select("_id")
        .lean();

      if (students.length === 0) {
        query.student = null; // Ensure no results are returned
      } else {
        query.student = { $in: students.map((student) => student._id) };
      }
    }

    // Fetch attendance records
    const attendanceRecords = await attendanceModel
      .find(query)
      .populate("student") // Populate student details
      .populate("class") // Populate class details
      .lean();

    // Fetch all classes for the filter dropdown
    const classes = await classModel.find().lean();

    // Validate and handle empty or null arrays
    if (!Array.isArray(attendanceRecords)) {
      console.error("Unexpected attendanceRecords format:", attendanceRecords);
      return res.status(500).send("Internal Server Error");
    }
    if (!Array.isArray(classes)) {
      console.error("Unexpected classes format:", classes);
      return res.status(500).send("Internal Server Error");
    }

    // Render the Attendance Page
    res.render("attendance", {
      attendanceRecords: Array.isArray(attendanceRecords) ? attendanceRecords : [], // Ensure attendanceRecords is always an array
      classes: Array.isArray(classes) ? classes : [], // Ensure classes is always an array
      filters: { classId, startDate, endDate, status, search }, // Pass filters back to the template
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET All Results with Filters and Search
app.get("/admin/results", verifyToken, async (req, res) => {
  try {
    const { classId, grade, search } = req.query;

    // Build query object
    const query = {};

    // Filter by class
    if (classId) {
      query.class = classId;
    }

    // Filter by grade
    if (grade) {
      query.grade = grade;
    }

    // Search by student name, email, or student ID
    if (search) {
      const searchRegex = new RegExp(search.trim(), "i"); // Case-insensitive regex
      const students = await studentModel
        .find({
          $or: [
            { firstName: { $regex: searchRegex } },
            { lastName: { $regex: searchRegex } },
            { email: { $regex: searchRegex } },
            { studentId: { $regex: searchRegex } },
          ],
        })
        .select("_id")
        .lean();

      // If no matching students are found, return an empty results array
      if (students.length === 0) {
        query.student = null; // Ensure no results are returned
      } else {
        query.student = { $in: students.map((student) => student._id) };
      }
    }

    // Fetch results
    const results = await resultModel
      .find(query)
      .populate("student") // Populate student details
      .populate("class") // Populate class details
      .lean();

    // Fetch all classes for the filter dropdown
    const classes = await classModel.find().lean();

    // Validate and handle empty or null arrays
    if (!Array.isArray(results)) {
      console.error("Unexpected results format:", results);
      return res.status(500).send("Internal Server Error");
    }
    if (!Array.isArray(classes)) {
      console.error("Unexpected classes format:", classes);
      return res.status(500).send("Internal Server Error");
    }

    // Render the Results Page
    res.render("results", {
      results: Array.isArray(results) ? results : [], // Ensure results is always an array
      classes: Array.isArray(classes) ? classes : [], // Ensure classes is always an array
      filters: { classId, grade, search }, // Pass filters back to the template
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: Student Reports Page
app.get("/student/reports", verifyToken, async (req, res) => {
  try {
    // Ensure the user is a student
    if (req.user.role !== "student") {
      return res
        .status(403)
        .send("Forbidden: Only students can access this page.");
    }

    const studentId = req.user.id; // Extract student ID from the token

    // Fetch results for the logged-in student
    const results = await resultModel
      .find({ student: studentId })
      .populate("class") // Populate class details
      .lean();

    // Render the Student Reports Page
    res.render("student-reports", {
      results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/
app.get("/admin/reports", verifyToken, async (req, res) => {
  try {
    const { classId, grade, search } = req.query;

    // Build query object
    const query = {};

    // Filter by class
    if (classId) {
      query.class = classId;
    }

    // Filter by grade
    if (grade) {
      query.grade = grade;
    }

    // Search by student name, email, or student ID
    if (search) {
      const students = await studentModel
        .find({
          $or: [
            { firstName: { $regex: search, $options: "i" } },
            { lastName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { studentId: { $regex: search, $options: "i" } },
          ],
        })
        .select("_id");
      query.student = { $in: students.map((student) => student._id) };
    }

    // Fetch results and populate related data
    const results = await resultModel
      .find(query)
      .populate({
        path: "student",
        select: "studentId firstName lastName",
      })
      .populate("class")
      .lean();

    // Filter out results where class is null
    const filteredResults = results.filter(result => result.class !== null);

    const classes = await classModel.find().lean();

    res.render("admin-reports", {
      results: filteredResults,
      classes,
      filters: { classId, grade, search },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

app.get("/admin/settings", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Fetch the admin's details
    const adminId = req.admin.id;
    const admin = await adminModel.findById(adminId).lean();

    if (!admin) {
      return res.status(404).send("Admin not found.");
    }

    // Pass the query parameters to the template
    res.render("admin-settings", {
      admin,
      success: req.query.success, // Pass the 'success' query parameter
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/admin/settings/update", verifyToken, async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { email, password, fullName } = req.body;

    // Hash the password
    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : undefined;

    // Update the admin's details
    const updatedAdmin = await adminModel.findByIdAndUpdate(
      adminId,
      { email, password: hashedPassword, fullName },
      { new: true }
    );

    if (!updatedAdmin) {
      return res.status(404).send("Admin not found.");
    }

    // Redirect back to the settings page with a success message
    res.redirect("/admin/settings?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

app.get("/admin/profile", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Fetch the admin's details
    const adminId = req.admin.id;
    const admin = await adminModel.findById(adminId).lean();

    if (!admin) {
      return res.status(404).send("Admin not found.");
    }

    // Pass the query parameters to the template
    res.render("admin-profile", {
      admin,
      success: req.query.success, // Pass the 'success' query parameter
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Update Admin Profile
app.post("/admin/profile/update", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    const adminId = req.admin.id;
    const { email, password, fullName } = req.body;

    // Update the admin's details
    const updatedAdmin = await adminModel.findByIdAndUpdate(
      adminId,
      { email, password, fullName },
      { new: true }
    );

    if (!updatedAdmin) {
      return res.status(404).send("Admin not found.");
    }

    // Redirect back to the profile page with a success message
    res.redirect("/admin/profile?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/
// Route: GET Notifications Page
app.get("/admin/notifications", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Fetch all notifications
    const notifications = await notificationModel
      .find()
      .sort({ createdAt: -1 })
      .lean();

    // Render the Notifications Page
    res.render("notifications", { notifications });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Mark Notification as Read
app.post(
  "/admin/notifications/:id/mark-read",
  verifyToken,
  async (req, res) => {
    try {
      // Ensure the user is an admin
      if (req.admin.role !== "admin") {
        return res
          .status(403)
          .send("Forbidden: Only admins can access this page.");
      }

      const notificationId = req.params.id;

      // Mark the notification as read
      const updatedNotification = await notificationModel.findByIdAndUpdate(
        notificationId,
        { isRead: true },
        { new: true }
      );

      if (!updatedNotification) {
        return res.status(404).send("Notification not found.");
      }

      // Redirect back to the notifications page
      res.redirect("/admin/notifications");
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  }
);

// Route: POST Delete Notification
app.post("/admin/notifications/:id/delete", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    const notificationId = req.params.id;

    // Delete the notification
    const deletedNotification = await notificationModel.findByIdAndDelete(
      notificationId
    );

    if (!deletedNotification) {
      return res.status(404).send("Notification not found.");
    }

    // Redirect back to the notifications page
    res.redirect("/admin/notifications");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Create New Class Page
app.get("/admin/classes/new", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Render the Create New Class Page
    res.render("create-class", { error: null });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Create New Class
app.post("/admin/classes/new", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res.status(403).send("Forbidden: Only admins can access this page.");
    }

    const { className, subject, teacher, schedule } = req.body;

    // Validate input fields
    if (!className || !subject || !teacher || !schedule) {
      return res.render("create-class", { error: "All fields are required." });
    }

    // Parse schedule into an array of objects
    const parsedSchedule = Array.isArray(schedule)
      ? schedule.map((slot) => ({
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
        }))
      : [];

    // Validate schedule
    if (parsedSchedule.length === 0) {
      return res.render("create-class", { error: "At least one schedule slot is required." });
    }

    // Create a new class
    const newClass = new classModel({
      className,
      subject,
      teacher,
      schedule: parsedSchedule,
    });

    await newClass.save();

    // Redirect to the classes list page or show success message
    res.redirect("/admin/classes?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Mark Attendance Page
app.get("/admin/attendance/mark", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Fetch all classes and students
    const classes = await classModel.find().lean();
    const students = await studentModel.find().lean();

    // Render the Mark Attendance Page with both classes and students
    res.render("mark-attendance", {
      classes,
      students,
      error: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Route: POST Save Attendance
app.post("/admin/attendance/mark", verifyToken, async (req, res) => {
  try {
    const { classId, studentId, date, status } = req.body;

    // Validate input fields
    if (!mongoose.Types.ObjectId.isValid(classId) || !mongoose.Types.ObjectId.isValid(studentId)) {
      return res.render("mark-attendance", {
        classes: await classModel.find().lean(),
        students: await studentModel.find().lean(),
        error: "Invalid Class ID or Student ID.",
      });
    }
    if (!date || isNaN(Date.parse(date))) {
      return res.render("mark-attendance", {
        classes: await classModel.find().lean(),
        students: await studentModel.find().lean(),
        error: "Invalid Date Format. Please use YYYY-MM-DD.",
      });
    }
    if (!["present", "absent", "onLeave"].includes(status)) {
      return res.render("mark-attendance", {
        classes: await classModel.find().lean(),
        students: await studentModel.find().lean(),
        error: "Invalid Attendance Status.",
      });
    }

    // Check if attendance has already been marked for this student, class, and date
    const existingAttendance = await attendanceModel.findOne({
      student: studentId,
      class: classId,
      date: new Date(date), // Convert input date to Date object
    });

    if (existingAttendance) {
      return res.render("mark-attendance", {
        classes: await classModel.find().lean(),
        students: await studentModel.find().lean(),
        error: "Attendance has already been marked for this student on the selected date.",
      });
    }

    // Create a new attendance record
    const newAttendance = new attendanceModel({
      student: studentId,
      class: classId,
      date: new Date(date),
      status: status,
    });

    await newAttendance.save();

    // Update linked data
    await studentModel.findByIdAndUpdate(studentId, {
      $push: { attendanceRecords: newAttendance._id },
    });
    await classModel.findByIdAndUpdate(classId, {
      $push: { attendanceRecords: newAttendance._id },
    });

    // Create a notification for the student
    const notificationMessage =
      status === "present"
        ? "Your attendance has been marked as Present."
        : status === "absent"
        ? "Your attendance has been marked as Absent."
        : "Your attendance has been marked as On Leave.";

    const newNotification = new studentNotificationModel({
      student: studentId,
      message: notificationMessage,
      timestamp: new Date(),
      isRead: false,
    });

    await newNotification.save();

    // Redirect to the attendance list page or show success message
    res.redirect("/admin/attendance?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Check Attendance
app.post("/api/attendance/check", verifyToken, async (req, res) => {
  try {
    const { classId, studentId, date } = req.body;

    // Validate input fields
    if (!classId || !studentId || !date) {
      return res.status(400).json({
        exists: false,
        error: "All fields (classId, studentId, date) are required.",
      });
    }

    // Validate date format (YYYY-MM-DD)
    if (!isValidDate(date)) {
      return res.status(400).json({
        exists: false,
        error: "Invalid Date Format. Please use YYYY-MM-DD.",
      });
    }

    // Convert the date string to a Date object
    const formattedDate = new Date(date);

    // Check if attendance already exists
    const existingAttendance = await attendanceModel.findOne({
      student: studentId,
      class: classId,
      date: formattedDate,
    });

    if (existingAttendance) {
      return res.json({ exists: true });
    }

    return res.json({ exists: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      exists: false,
      error: "Internal Server Error",
    });
  }
});

// Helper function to validate date format (YYYY-MM-DD)
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/; // Matches YYYY-MM-DD format
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date); // Ensure it's a valid date
}

/*========================================================================================================================*/
// Route: GET Enroll Students Page
app.get("/admin/classes/enroll", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Fetch all classes and students
    const classes = await classModel.find().lean();
    const students = await studentModel.find().lean();

    // Pass the success query parameter to the template, defaulting to null if not present
    res.render("enroll-students", {
      classes,
      students,
      error: null,
      success: req.query.success || null, // Default to null if no query parameter exists
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Enroll Student in Class
app.post("/admin/classes/enroll", verifyToken, async (req, res) => {
  try {
    const { classId, studentId } = req.body;

    // Validate input fields
    if (!classId || !studentId) {
      return renderEnrollPage(res, "All fields are required.");
    }

    // Find the class and student
    const [cls, student] = await Promise.all([
      classModel.findById(classId),
      studentModel.findById(studentId),
    ]);

    if (!cls || !student) {
      return renderEnrollPage(res, "Class or student not found.");
    }

    // Check if the student is already enrolled in the class
    if (cls.students.includes(student._id)) {
      return renderEnrollPage(res, "Student is already enrolled in this class.");
    }

    // Enroll the student in the class
    cls.students.push(student._id);
    student.enrolledClasses.push(cls._id);

    // Create a default attendance record for the student in the class
    const newAttendance = new attendanceModel({
      student: student._id,
      class: cls._id,
      date: new Date(), // Default to today's date
      status: "absent", // Default status
    });

    // Create a default result record for the student in the class
    const newResult = new resultModel({
      student: student._id,
      class: cls._id,
      marks: 0, // Default marks
      grade: "N/A", // Default grade
      examDate: new Date(), // Default to today's date
    });

    // Save all changes in parallel
    await Promise.all([
      cls.save(),
      student.save(),
      newAttendance.save(),
      newResult.save(),
    ]);

    // Link the attendance and result records to the class and student
    cls.attendanceRecords.push(newAttendance._id);
    cls.results.push(newResult._id);
    student.attendanceRecords.push(newAttendance._id);
    student.results.push(newResult._id);

    // Save the updated class and student documents
    await Promise.all([cls.save(), student.save()]);

    // Redirect back to the enroll students page with success message
    res.redirect("/admin/classes/enroll?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Helper function to render the enroll page with error/success messages
function renderEnrollPage(res, errorMessage) {
  return Promise.all([classModel.find().lean(), studentModel.find().lean()]).then(
    ([classes, students]) => {
      res.render("enroll-students", {
        classes,
        students,
        error: errorMessage,
        success: null,
      });
    }
  );
}

// Route: POST Remove Student from Class
app.post("/admin/classes/remove-student", verifyToken, async (req, res) => {
  try {
    const { classId, studentId } = req.body;

    // Validate input fields
    if (!classId || !studentId) {
      return renderEnrollPage(res, "All fields are required.");
    }

    // Find the class and student
    const [cls, student] = await Promise.all([
      classModel.findById(classId),
      studentModel.findById(studentId),
    ]);

    if (!cls || !student) {
      return renderEnrollPage(res, "Class or student not found.");
    }

    // Ensure cls.students is an array
    if (!Array.isArray(cls.students)) {
      cls.students = []; // Initialize as an empty array if undefined
    }

    // Check if the student is enrolled in the class
    if (!cls.students.includes(student._id)) {
      return renderEnrollPage(res, "Student is not enrolled in this class.");
    }

    // Remove the student from the class
    cls.students = cls.students.filter((id) => id.toString() !== studentId);
    student.enrolledClasses = student.enrolledClasses.filter(
      (id) => id.toString() !== classId
    );

    // Delete attendance records for the student in the class
    const attendanceRecords = await attendanceModel.find({
      student: studentId,
      class: classId,
    });
    const attendanceRecordIds = attendanceRecords.map((record) => record._id);
    await attendanceModel.deleteMany({ student: studentId, class: classId });

    // Delete result records for the student in the class
    const resultRecords = await resultModel.find({
      student: studentId,
      class: classId,
    });
    const resultRecordIds = resultRecords.map((record) => record._id);
    await resultModel.deleteMany({ student: studentId, class: classId });

    // Remove attendance and result record IDs from the class and student
    cls.attendanceRecords = cls.attendanceRecords.filter(
      (id) => !attendanceRecordIds.includes(id.toString())
    );
    student.attendanceRecords = student.attendanceRecords.filter(
      (id) => !attendanceRecordIds.includes(id.toString())
    );
    cls.results = cls.results.filter(
      (id) => !resultRecordIds.includes(id.toString())
    );
    student.results = student.results.filter(
      (id) => !resultRecordIds.includes(id.toString())
    );

    // Save all changes in parallel
    await Promise.all([cls.save(), student.save()]);

    // Redirect back to the enroll students page with success message
    res.redirect("/admin/classes/enroll?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Create New Result Page
app.get("/admin/results/new", verifyToken, async (req, res) => {
  try {
    // Ensure the user is an admin
    if (req.admin.role !== "admin") {
      return res
        .status(403)
        .send("Forbidden: Only admins can access this page.");
    }

    // Fetch all students and classes for dropdowns
    const students = await studentModel.find().lean();
    const classes = await classModel.find().lean();

    // Render the create result page
    res.render("create-result", {
      students,
      classes,
      error: null,
      success: req.query.success || null, // Default to null if no query parameter exists
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Create New Result
app.post("/admin/results/new", verifyToken, async (req, res) => {
  try {
    const { studentId, classId, marks, grade } = req.body;

    // Validate input fields
    if (!studentId || !classId || !marks || !grade) {
      const students = await studentModel.find().lean();
      const classes = await classModel.find().lean();
      return res.render("create-result", {
        students,
        classes,
        error: "All fields are required.",
        success: null,
      });
    }

    // Find the student and class
    const student = await studentModel.findById(studentId);
    const cls = await classModel.findById(classId);

    if (!student || !cls) {
      const students = await studentModel.find().lean();
      const classes = await classModel.find().lean();
      return res.render("create-result", {
        students,
        classes,
        error: "Student or class not found.",
        success: null,
      });
    }

    // Check if the student is enrolled in the class
    if (!cls.students.includes(student._id)) {
      const students = await studentModel.find().lean();
      const classes = await classModel.find().lean();
      return res.render("create-result", {
        students,
        classes,
        error: "Student is not enrolled in this class.",
        success: null,
      });
    }

    // Create a new result record
    const newResult = new resultModel({
      student: student._id,
      class: cls._id,
      marks: marks, // Marks out of 100
      grade: grade,
      examDate: new Date(), // Default to today's date
    });
    await newResult.save();

    // Link the result record to the class and student
    cls.results.push(newResult._id);
    await cls.save();

    student.results.push(newResult._id);
    await student.save();

    // Redirect back to the results page with success message
    res.redirect("/admin/results?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Edit Attendance Record
app.get("/admin/attendance/:id/edit", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the attendance record by ID
    const record = await attendanceModel
      .findById(id)
      .populate("student")
      .populate("class")
      .lean();

    if (!record) {
      return res.status(404).send("Attendance record not found.");
    }

    // Fetch all classes and students for dropdowns
    const classes = await classModel.find().lean();
    const students = await studentModel.find().lean();

    // Render the edit attendance page
    res.render("edit-attendance", {
      record,
      classes,
      students,
      error: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Update Attendance Record
app.post("/admin/attendance/:id/edit", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { classId, studentId, date, status } = req.body;

    // Validate input fields
    if (!classId || !studentId || !date || !status) {
      const record = await attendanceModel
        .findById(id)
        .populate("student")
        .populate("class")
        .lean();
      const classes = await classModel.find().lean();
      const students = await studentModel.find().lean();
      return res.render("edit-attendance", {
        record,
        classes,
        students,
        error: "All fields are required.",
      });
    }

    // Update the attendance record
    await attendanceModel.findByIdAndUpdate(id, {
      student: studentId,
      class: classId,
      date: new Date(date),
      status: status,
    });

    // Redirect back to the attendance list page
    res.redirect("/admin/attendance?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: DELETE Attendance Record
app.post("/admin/attendance/:id/delete", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Delete the attendance record
    const deletedRecord = await attendanceModel.findByIdAndDelete(id);

    if (!deletedRecord) {
      return res.status(404).send("Attendance record not found.");
    }

    // Redirect back to the attendance list page
    res.redirect("/admin/attendance?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Edit Class
app.get("/admin/classes/:id/edit", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    // Find the class by ID
    const cls = await classModel.findById(id).lean();
    if (!cls) {
      return res.status(404).send("Class not found.");
    }
    // Ensure the schedule field is an array (default to empty array if undefined)
    cls.schedule = Array.isArray(cls.schedule) ? cls.schedule : [];
    // Render the edit class page
    res.render("edit-class", {
      cls,
      error: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Update Class
app.post("/admin/classes/:id/edit", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { className, subject, teacher, schedule } = req.body;

    // Validate input fields
    if (!className || !subject) {
      const cls = await classModel.findById(id).lean();
      return res.render("edit-class", {
        cls,
        error: "Class name and subject are required.",
      });
    }

    // Parse schedule into an array of objects
    const parsedSchedule = Array.isArray(schedule)
      ? schedule.map((slot) => ({
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
        }))
      : [];

    // Validate schedule
    if (parsedSchedule.length === 0) {
      const cls = await classModel.findById(id).lean();
      return res.render("edit-class", {
        cls,
        error: "At least one schedule slot is required.",
      });
    }

    // Update the class
    await classModel.findByIdAndUpdate(id, {
      className,
      subject,
      teacher,
      schedule: parsedSchedule,
    });

    // Redirect back to the classes list page
    res.redirect("/admin/classes?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: DELETE Class
app.post("/admin/classes/:id/delete", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Delete the class
    const deletedClass = await classModel.findByIdAndDelete(id);

    if (!deletedClass) {
      return res.status(404).send("Class not found.");
    }

    // Redirect back to the classes list page
    res.redirect("/admin/classes?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Edit Result
app.get("/admin/results/:id/edit", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the result by ID
    const result = await resultModel
      .findById(id)
      .populate("student")
      .populate("class")
      .lean();

    if (!result) {
      return res.status(404).send("Result not found.");
    }

    // Fetch all students and classes for dropdowns
    const students = await studentModel.find().lean();
    const classes = await classModel.find().lean();

    // Render the edit result page
    res.render("edit-result", {
      result,
      students,
      classes,
      error: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Update Result
app.post("/admin/results/:id/edit", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, classId, marks, grade } = req.body;

    // Validate input fields
    if (!studentId || !classId || !marks || !grade) {
      const result = await resultModel
        .findById(id)
        .populate("student")
        .populate("class")
        .lean();
      const students = await studentModel.find().lean();
      const classes = await classModel.find().lean();
      return res.render("edit-result", {
        result,
        students,
        classes,
        error: "All fields are required.",
      });
    }

    // Update the result
    await resultModel.findByIdAndUpdate(id, {
      student: studentId,
      class: classId,
      marks,
      grade,
    });

    // Redirect back to the results list page
    res.redirect("/admin/results?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: DELETE Result
app.post("/admin/results/:id/delete", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Delete the result
    const deletedResult = await resultModel.findByIdAndDelete(id);

    if (!deletedResult) {
      return res.status(404).send("Result not found.");
    }

    // Redirect back to the results list page
    res.redirect("/admin/results?success=true");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Attendance Page
app.get("/student/attendance", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;
    const { search, classId } = req.query; // Query parameters for filtering

    // Fetch the full student document
    const student = await studentModel.findById(studentId).populate({
      path: "attendanceRecords",
      populate: { path: "class", model: "Class" }, // Populate the 'class' field in attendance records
    });

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Extract attendance records
    let attendance = student.attendanceRecords;

    // Apply filters based on search query
    if (search) {
      attendance = attendance.filter((record) => {
        const classNameMatch = record.class?.className
          ?.toLowerCase()
          .includes(search.toLowerCase());
        const statusMatch = record.status
          ?.toLowerCase()
          .includes(search.toLowerCase());
        return classNameMatch || statusMatch;
      });
    }

    // Apply filters based on selected class
    if (classId) {
      attendance = attendance.filter(
        (record) => record.class?._id.toString() === classId
      );
    }

    // Fetch all classes for the dropdown menu
    const classes = await classModel.find().lean();

    // Pass filters to the template
    const filters = { search, classId };

    // Render the Attendance Page with Data
    res.render("student-attendance", {
      attendance,
      classes,
      filters,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});



/*========================================================================================================================*/

// Route: GET Scheduled Classes Page
app.get("/student/classes", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;
    const { search } = req.query; // Query parameter for filtering

    // Fetch the full student document
    const student = await studentModel
      .findById(studentId)
      .populate({
        path: "enrolledClasses",
        model: "Class",
      });

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Extract enrolled classes
    let enrolledClasses = student.enrolledClasses;

    // Format the schedule field for each class
    enrolledClasses = enrolledClasses.map((cls) => {
      const formattedSchedule = cls.schedule
        ? cls.schedule.map((slot) => `${slot.day}, ${slot.startTime} - ${slot.endTime}`).join("; ")
        : "Not available";
      return {
        ...cls.toObject(),
        schedule: formattedSchedule,
      };
    });

    // Apply filters based on search query
    if (search) {
      enrolledClasses = enrolledClasses.filter((cls) => {
        const classNameMatch = cls.className?.toLowerCase().includes(search.toLowerCase());
        const teacherMatch = cls.teacher?.toLowerCase().includes(search.toLowerCase());
        return classNameMatch || teacherMatch;
      });
    }

    // Pass filters to the template
    const filters = { search };

    // Render the Scheduled Classes Page with Data
    res.render("scheduled-classes", {
      enrolledClasses,
      filters,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Exam Results Page
app.get("/student/results", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;
    const { search } = req.query; // Query parameter for filtering

    // Fetch the full student document
    const student = await studentModel
      .findById(studentId)
      .populate({
        path: "results",
        populate: { path: "class", model: "Class" }, // Populate the 'class' field in results
      });

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Extract results
    let results = student.results;

    // Apply filters based on search query
    if (search) {
      results = results.filter(result => {
        const classNameMatch = result.class?.className?.toLowerCase().includes(search.toLowerCase());
        const gradeMatch = result.grade?.toLowerCase().includes(search.toLowerCase());
        return classNameMatch || gradeMatch;
      });
    }

    // Pass filters to the template
    const filters = { search };

    // Render the Exam Results Page with Data
    res.render("exam-results", {
      results,
      filters,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Profile Update Page
app.get("/student/profile/update", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;

    // Fetch the full student document
    const student = await studentModel.findById(studentId);

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Render the Profile Update Page with Student Data
    res.render("profile-update", {
      student,
      successMessage: null, // No success message initially
      errorMessage: null,   // No error message initially
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Update Profile
app.post("/student/profile/update", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;
    const { firstName, lastName, email, phone, address } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email) {
      return res.render("profile-update", {
        student: req.body, // Pass back the submitted data to pre-fill the form
        successMessage: null,
        errorMessage: "All fields are required.",
      });
    }

    // Update the student document
    await studentModel.findByIdAndUpdate(studentId, {
      firstName,
      lastName,
      email,
      phone: phone || null, // Allow phone to be optional
      address: address || null, // Allow address to be optional
    });

    // Fetch the updated student document
    const updatedStudent = await studentModel.findById(studentId);

    // Render the Profile Update Page with a Success Message
    res.render("profile-update", {
      student: updatedStudent,
      successMessage: "Profile updated successfully!",
      errorMessage: null,
    });
  } catch (error) {
    console.error(error);
    res.render("profile-update", {
      student: req.body, // Pass back the submitted data to pre-fill the form
      successMessage: null,
      errorMessage: "An error occurred while updating your profile.",
    });
  }
});

/*========================================================================================================================*/

// Route: GET Change Password Page
app.get("/student/changePass", verifyStudentToken, async (req, res) => {
  try {
    res.render("change-password", {
      successMessage: null,
      errorMessage: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: POST Change Password
app.post("/student/changePass", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validate required fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render("change-password", {
        successMessage: null,
        errorMessage: "All fields are required.",
      });
    }

    // Fetch the student document
    const student = await studentModel.findById(studentId);

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    // Verify the current password
    const isMatch = await bcrypt.compare(currentPassword, student.password);
    if (!isMatch) {
      return res.render("change-password", {
        successMessage: null,
        errorMessage: "Current password is incorrect.",
      });
    }

    // Check if new password matches confirm password
    if (newPassword !== confirmPassword) {
      return res.render("change-password", {
        successMessage: null,
        errorMessage: "New password and confirm password do not match.",
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the student's password
    await studentModel.findByIdAndUpdate(studentId, { password: hashedPassword });

    // Render the Change Password Page with a Success Message
    res.render("change-password", {
      successMessage: "Password updated successfully!",
      errorMessage: null,
    });
  } catch (error) {
    console.error(error);
    res.render("change-password", {
      successMessage: null,
      errorMessage: "An error occurred while updating your password.",
    });
  }
});

/*========================================================================================================================*/

// Route: GET Student Notifications Page
app.get("/student/notification", verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.student.id;

    // Fetch all notifications for the student
    const notifications = await studentNotificationModel.find({ student: studentId })
      .sort({ timestamp: -1 }) // Sort by latest first
      .lean();

    // Mark all notifications as read
    await studentNotificationModel.updateMany(
      { student: studentId, isRead: false },
      { $set: { isRead: true } }
    );

    // Render the Student Notifications Page
    res.render("student-notifications", {
      notifications,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET Recognized Student Page
app.get("/recognized", async (req, res) => {
  const { studentId } = req.query; // Get the recognized student ID from query parameters

  if (!studentId) {
    return res.status(400).send("No recognized student data found.");
  }

  try {
    const student = await studentModel.findOne(
      { studentId },
      "studentId firstName lastName age email phone address batch department semester"
    );

    if (!student) {
      return res.status(404).send("Student not found.");
    }

    res.render("recognized", { student });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

// Route: GET All Students with Face Descriptors
app.get("/api/students/descriptors", async (req, res) => {
  try {
    const students = await studentModel.find(
      {},
      "studentId firstName lastName email faceDescriptors batch department semester"
    );
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route: GET Student by Student ID
app.get("/api/students/:studentId", async (req, res) => {
  try {
    const student = await studentModel.findOne(
      { studentId: req.params.studentId },
      "studentId firstName lastName age email phone address enrolledClasses absents gpa batch department semester"
    );
    if (!student) {
      return res.status(404).send("Student not found.");
    }
    res.json(student);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/

app.get("/student/attendance/mark", async (req, res) => {
  const { studentId } = req.query; // Get the recognized student ID from query parameters

  if (!studentId) {
    return res.status(400).send("No recognized student data found.");
  }

  try {
    // Fetch the student details and populate their enrolled classes
    const student = await studentModel.findById(studentId)
      .populate("enrolledClasses")
      .lean();

    if (!student || !student.enrolledClasses.length) {
      return res.render("mark-attendance-by-face", {
        error: "No classes are currently enrolled.",
      });
    }

    // Get the current date and time
    const currentDate = new Date();
    const currentDay = currentDate.toLocaleDateString("en-US", { weekday: "long" });
    const currentTime = currentDate.toTimeString().split(" ")[0]; // HH:MM:SS

    // Filter classes scheduled for today and within the current time
    const scheduledClasses = student.enrolledClasses.filter((cls) => {
      return cls.schedule.some(
        (slot) =>
          slot.day === currentDay &&
          slot.startTime <= currentTime &&
          slot.endTime >= currentTime
      );
    });

    res.render("mark-attendance-by-face", {
      scheduledClasses,
      error: scheduledClasses.length
        ? null
        : "No classes are scheduled for the current time.",
      studentId, // Pass the studentId to the template
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/student/attendance/mark/:classId", async (req, res) => {
  const { studentId } = req.query; // Get the recognized student ID from query parameters
  const classId = req.params.classId;

  if (!studentId) {
    return res.status(400).send("No recognized student data found.");
  }

  try {
    // Fetch the student details from the database
    const student = await studentModel.findById(studentId);
    if (!student) {
      return res.status(404).send("Student not found.");
    }

    const cls = await classModel.findById(classId);
    if (!cls) {
      return res.status(404).send("Class not found.");
    }

    // Get the current date
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString().split("T")[0]; // Extract YYYY-MM-DD

    // Check if attendance has already been marked for this class on the current date
    const existingAttendance = await attendanceModel.findOne({
      student: studentId,
      class: classId,
      date: { 
        $gte: new Date(formattedDate), 
        $lt: new Date(new Date(formattedDate).setDate(new Date(formattedDate).getDate() + 1)) 
      },
    });

    if (existingAttendance) {
      // Render the "already marked" page
      return res.render("attendance-already-marked", {
        student: student,
        classId: classId,
        currentDate: formattedDate,
      });
    }

    // Mark attendance as present
    const newAttendance = new attendanceModel({
      student: studentId,
      class: classId,
      date: currentDate, // Store the full date object
      status: "present",
    });

    try {
      await newAttendance.save();

      // Update linked data
      await studentModel.findByIdAndUpdate(studentId, {
        $push: { attendanceRecords: newAttendance._id },
      });
      await classModel.findByIdAndUpdate(classId, {
        $push: { attendanceRecords: newAttendance._id },
      });

      // Create a notification for the student
      const notificationMessage = "Your attendance has been marked as Present.";
      const newNotification = new studentNotificationModel({
        student: studentId,
        message: notificationMessage,
        timestamp: new Date(),
        isRead: false,
      });

      await newNotification.save();

      // Render the success page
      res.render("attendance-success", {
        student: student,
        classId: classId,
        currentDate: formattedDate,
      });
    } catch (mongoError) {
      // Handle duplicate key error (E11000)
      if (mongoError.code === 11000) {
        // Attendance already exists for this student, class, and date
        return res.render("attendance-already-marked", {
          student: student,
          classId: classId,
          currentDate: formattedDate,
        });
      }
      throw mongoError; // Re-throw other errors
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

/*========================================================================================================================*/



/*========================================================================================================================*/

app.listen(8001, function () {
  console.log("Server is running on port 8001");
});

/*========================================================================================================================*/
