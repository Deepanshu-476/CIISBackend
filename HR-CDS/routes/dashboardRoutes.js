const express = require('express');
const router = express.Router();
const { getDashboardActivity, getEmployeeDashboardSummary, getEmployeeProductivity } = require('../controllers/dashboardController');
const { protect } = require('../../middleware/authMiddleware');
const { getDashboardOverview } = require('../controllers/dashboardOverviewController');


router.use(protect);


router.get('/recent-activity', getDashboardActivity);
router.get('/employee-summary', getEmployeeDashboardSummary);
router.get('/productivity', getEmployeeProductivity);
router.get('/overview', getDashboardOverview);

module.exports = router;
