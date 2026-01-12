// attendanceRoutes.js
const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/AttendanceController');
const auth = require('../../middleware/authMiddleware');

// User routes
router.post('/in', auth, attendanceController.clockIn);
router.post('/out', auth, attendanceController.clockOut);
router.get('/status', auth, attendanceController.getTodayStatus);
router.get('/list', auth, attendanceController.getAttendanceList);

// Admin routes
router.get('/all', auth, attendanceController.getAllUsersAttendance);
router.post('/manual', auth, attendanceController.createManualAttendance);
router.put('/:id', auth, attendanceController.updateAttendanceRecord);
router.delete('/:id', auth, attendanceController.deleteAttendanceRecord);
router.get('/user/:userId', auth,  attendanceController.getAttendanceByUser);
router.get('/stats', auth,  attendanceController.getAttendanceStats);

module.exports = router;