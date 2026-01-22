// attendanceRoutes.js
const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/AttendanceController');
const { protect, authorize } = require('../../middleware/authMiddleware');

// User routes
router.post('/in', protect, attendanceController.clockIn);
router.post('/out', protect, attendanceController.clockOut);
router.get('/status', protect  , attendanceController.getTodayStatus);
router.get('/list', protect, attendanceController.getAttendanceList);

// Admin routes
router.get('/all', protect, attendanceController.getAllUsersAttendance);
router.post('/manual', protect, attendanceController.createManualAttendance);
router.put('/:id', protect, attendanceController.updateAttendanceRecord);
router.delete('/:id', protect, attendanceController.deleteAttendanceRecord);
router.get('/user/:userId', protect,  attendanceController.getAttendanceByUser);
router.get('/stats', protect,  attendanceController.getAttendanceStats);
module.exports = router;