const express = require("express");
const router = express.Router();
const attendanceController = require("../controllers/AttendanceController");
const auth = require("../../middleware/authMiddleware");
const isAdmin = require("../../middleware/isAdmin"); 
const isManager = require("../../middleware/isManager");
// ✅ USER ROUTES (require login)
router.post("/in", auth, attendanceController.clockIn);           
router.post("/out", auth, attendanceController.clockOut);          
router.get("/list", auth, attendanceController.getAttendanceList); 
router.get("/status", auth, attendanceController.getTodayStatus);  
// 🔐 ADMIN ROUTES
router.get("/all", [auth, isAdmin], attendanceController.getAllUsersAttendance);      
router.put("/:id", [auth, isAdmin], attendanceController.updateAttendanceRecord);     
router.delete("/:id", [auth, isManager], attendanceController.deleteAttendanceRecord);  
module.exports = router;
