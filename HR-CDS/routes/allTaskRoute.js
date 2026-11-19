
const express = require('express');
const router = express.Router();
const allTaskController = require('../controllers/allTaskController');
const { protect } = require('../../middleware/authMiddleware'); 

const assigned = require('../controllers/taskController');
const personal = require('../controllers/selfTaskController');
const client = require('../controllers/ClientTask');
const project = require('../controllers/projectController');
const { authorizeCompanyTaskWrite } = require('../utils/companyTaskStatus');

router.patch('/company/assigned/:taskId/status', protect, authorizeCompanyTaskWrite, assigned.updateStatus);
router.patch('/company/self/:taskId/status', protect, authorizeCompanyTaskWrite, personal.updateStatus);
router.patch('/company/project/:projectId/tasks/:taskId/status', protect, authorizeCompanyTaskWrite, project.updateTaskStatus);
router.put('/company/client/:taskId', protect, authorizeCompanyTaskWrite, client.updateTask);
router.put('/company/assigned/:taskId', protect, authorizeCompanyTaskWrite, assigned.updateTask);
router.put('/company/self/:taskId', protect, authorizeCompanyTaskWrite, personal.updateTask);
router.put('/company/project/:id/tasks/:taskId', protect, authorizeCompanyTaskWrite, project.updateTask);

router.get('/', protect, allTaskController.getAllMyTaskViews);
router.get('/stats', protect, allTaskController.getAllMyTaskStats);
router.get('/company-overview', protect, allTaskController.getCompanyAllTaskOverview);
router.post('/users/stats', protect, allTaskController.getUsersTaskStatsBatch);
router.get('/user/:userId', protect, allTaskController.getUserAllTasksPaginated);
router.get('/user/:userId/stats', protect, allTaskController.getUserTaskStats);

module.exports = router;
