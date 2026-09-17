const express = require('express');
const router = express.Router();
const overtimeController = require('../controllers/overtimeController');
const { protect, restrictTo } = require('../../middleware/authMiddleware');

// Employee routes
router.post('/request', protect, overtimeController.createOvertimeRequest);
router.get('/my-requests', protect, overtimeController.getMyOvertimeRequests);
router.delete('/request/:id', protect, overtimeController.deleteOvertimeRequest);

// Overtime Clock / Timer routes
router.get('/today-session', protect, overtimeController.getTodayOvertimeSession);
router.post('/start', protect, overtimeController.startOvertimeSession);
router.post('/stop', protect, overtimeController.stopOvertimeSession);

// Admin / HR routes
router.get('/admin-requests', protect, restrictTo('super_admin', 'superadmin', 'owner', 'admin', 'hr', 'manager'), overtimeController.getAdminOvertimeRequests);
router.put('/admin-action/:id', protect, restrictTo('super_admin', 'superadmin', 'owner', 'admin', 'hr', 'manager'), overtimeController.reviewOvertimeRequest);

module.exports = router;

