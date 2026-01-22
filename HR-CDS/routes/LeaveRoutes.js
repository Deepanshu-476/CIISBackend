const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/LeaveController');
const { protect, authorize } = require('../../middleware/authMiddleware');

// ✅ USER ROUTES
router.post('/apply', protect, leaveController.applyLeave);
router.get('/status', protect, leaveController.getMyLeaves);

// ✅ ADMIN/HR/MANAGER ROUTES
router.get('/all', protect, authorize('admin', 'hr', 'superadmin', 'manager'), leaveController.getAllLeaves);
router.patch('/status/:id', protect, authorize('admin', 'hr', 'superadmin', 'manager'), leaveController.updateLeaveStatus);
router.delete('/:id', protect, authorize('admin', 'hr', 'superadmin', 'manager'), leaveController.deleteLeave);

// ✅ DEPARTMENT SPECIFIC ROUTES (for managers)
router.get('/department/:department', protect, authorize('admin', 'hr', 'superadmin', 'manager'), leaveController.getLeavesByDepartment);

module.exports = router;