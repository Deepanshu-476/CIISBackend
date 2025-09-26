const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/LeaveController');
const auth = require('../../middleware/authMiddleware');
const isAdmin = require('../../middleware/isAdmin'); // 🛡️ Admin check middleware
const isManager = require('../../middleware/isManager'); // 🛡️ Manager check middleware

// ✅ USER ROUTES

// 🟢 Apply for a leave (only for logged-in users)
router.post('/apply', auth, leaveController.applyLeave);

// 🔵 Get logged-in user's leave history
router.get('/status', auth, leaveController.getMyLeaves);


// ✅ ADMIN ROUTES

// 🔴 Get all leave requests (admin only) — supports optional ?date=YYYY-MM-DD filter
router.get('/all', auth, isAdmin, leaveController.getAllLeaves);

// 🟠 Update status (approve/reject) of a leave by ID (admin only)
router.patch('/status/:id', auth, isAdmin, leaveController.updateLeaveStatus);
router.delete('/:id', auth, isManager, leaveController.deleteLeave);
module.exports = router;
