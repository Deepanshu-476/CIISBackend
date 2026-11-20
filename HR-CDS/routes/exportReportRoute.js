const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const exportReportController = require('../controllers/exportReportController');

// Support token in query string for direct file download links
const allowQueryToken = (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};

router.use(allowQueryToken);
router.use(protect);

// 1. Attendance Reports
router.get('/attendance', exportReportController.exportAttendanceReport);

// 2. Tasks Reports (All tasks, Single User tasks, Today's tasks)
router.get('/tasks', exportReportController.exportTasksReport);

// 3. Project Tasks Report (All tasks of a project with team details)
router.get('/project/:projectId/tasks', exportReportController.exportProjectTasksReport);

// 4. Clients Master Report (With subscriptions, expiry dates, task completion rate, and services)
router.get('/clients-master', exportReportController.exportClientsMasterReport);

// 5. Specific Client Tasks Report
router.get('/client/:clientId/tasks', exportReportController.exportClientTasksReport);

module.exports = router;
