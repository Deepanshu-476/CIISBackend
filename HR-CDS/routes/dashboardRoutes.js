const express = require('express');
const router = express.Router();
const { getDashboardActivity, getEmployeeDashboardSummary } = require('../controllers/dashboardController');
const { protect } = require('../../middleware/authMiddleware');


router.use(protect);


router.get('/recent-activity', getDashboardActivity);
router.get('/employee-summary', getEmployeeDashboardSummary);

module.exports = router;
