const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { protect } = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');



router.get('/', protect, taskController.getTasks);
router.get('/my', protect, taskController.getMyTasks);
router.get('/personal', protect, taskController.getPersonalTasks);
router.get('/personal/stats', protect, taskController.getPersonalTaskStats);
router.get('/assigned-to-me', protect, taskController.getAssignedToMeTasks);
router.get('/assigned-to-me/stats', protect, taskController.getAssignedToMeTaskStats);
router.get('/project-assigned', protect, taskController.getAssignedProjectTasks);
router.get('/assigned', protect, taskController.getAssignedTasks);
router.get('/all', protect, taskController.getAllMyTaskViews);
router.get('/all/stats', protect, taskController.getAllMyTaskStats);



const uploadFields = upload.fields([
  { name: 'files', maxCount: 10 },
  { name: 'voiceNote', maxCount: 1 }
]);


router.post('/create', protect, uploadFields, taskController.createTask);
router.post('/create-self', protect, uploadFields, taskController.createTaskForSelf);
router.post('/create-for-others', protect, uploadFields, taskController.createTaskForOthers);

router.put('/:taskId', protect, uploadFields, taskController.updateTask);
router.delete('/:taskId', protect, taskController.deleteTask);
router.patch('/:taskId/status', protect, taskController.updateStatus);
router.patch('/:taskId/quick-status', protect, taskController.quickStatusUpdate);



router.post('/:taskId/remarks', protect, uploadRemarkImage, taskController.addRemark);
router.get('/:taskId/remarks', protect, taskController.getRemarks);



router.get('/notifications/all', protect, taskController.getNotifications);
router.patch('/notifications/:notificationId/read', protect, taskController.markNotificationAsRead);
router.patch('/notifications/read-all', protect, taskController.markAllNotificationsAsRead);



router.get('/:taskId/activity-logs', protect, taskController.getTaskActivityLogs);
router.get('/user-activity/:userId', protect, taskController.getUserActivityTimeline);



router.get('/assignable-users', protect, taskController.getAssignableUsers);



router.get('/status-counts', protect, taskController.getTaskStatusCounts);
router.get('/statistics', protect, taskController.getTaskStatistics);
router.get('/admin/dashboard/user/:userId/analytics', protect, taskController.getUserDetailedAnalytics);
router.get('/user/:userId/stats', protect, taskController.getUserTaskStats);
router.get('/users-with-counts', protect, taskController.getUsersWithTaskCounts);
router.get('/department-users-with-counts', protect, taskController.getDepartmentUsersWithTaskCounts);
router.get('/user/:userId/all-tasks', protect, taskController.getUserAllTasksPaginated);
router.get('/user/:userId/tasks', protect, taskController.getUserTasks);



router.get('/overdue', protect, taskController.getOverdueTasks);
router.get('/user/:userId/overdue', protect, taskController.getUserOverdueTasks);
router.patch('/:taskId/overdue', protect, taskController.markTaskAsOverdue);
router.post('/update-overdue-tasks', protect, taskController.updateAllOverdueTasks);
router.get('/check-overdue', protect, taskController.updateAllOverdueTasks);
router.get('/overdue/summary', protect, taskController.getOverdueSummary);
router.get('/overdue/summary/:userId', protect, taskController.getOverdueSummary);



router.patch('/:taskId/snooze', protect, taskController.snoozeTask);


router.get('/test', (req, res) => {
  return res.json({ success: true, message: 'Task management API is running', timestamp: new Date(), version: '1.0.0' });
});

router.get('/test1', protect, (req, res) => {
  return res.json({
    success: true,
    user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role },
    endpoints: {
      getTasks: 'GET /',
      getMyTasks: 'GET /my',
      getAssignedTasks: 'GET /assigned',
      createSelfTask: 'POST /create-self',
      createTaskForOthers: 'POST /create-for-others',
      updateTask: 'PUT /:taskId',
      deleteTask: 'DELETE /:taskId',
      updateStatus: 'PATCH /:taskId/status',
      getAssignableUsers: 'GET /assignable-users',
      getUserTasks: 'GET /user/:userId/tasks',
      getUserStats: 'GET /user/:userId/stats',
      getUsersWithTaskCounts: 'GET /users-with-counts'
    }
  });
});

module.exports = router;
