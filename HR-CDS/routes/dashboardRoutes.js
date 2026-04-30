const express = require('express');
const router = express.Router();
const { getDashboardActivity } = require('../controllers/dashboardController');
const { protect } = require('../../middleware/authMiddleware');

// All dashboard routes are protected
router.use(protect);

// Get dashboard recent activity
router.get('/recent-activity', getDashboardActivity);

module.exports = router;