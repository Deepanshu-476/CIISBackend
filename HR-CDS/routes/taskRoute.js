const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const auth = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');

// ==================== TASK ROUTES ====================
// ==================== NOTIFICATION ROUTES ====================

// 🔔 Get user notifications
router.get('/notifications/all', auth, taskController.getNotifications);

// Mark as read
router.patch('/notifications/:notificationId/read', auth, taskController.markNotificationAsRead);
router.patch('/notifications/read-all', auth, taskController.markAllNotificationsAsRead);

// ==================== TASK ROUTES ====================
router.get('/', auth, taskController.getTasks || taskController.getMyTasks);
router.get('/my', auth, taskController.getMyTasks);
router.get('/assigned', auth, taskController.getAssignedTasks);

// ✅ Create task for self
router.post(
  '/create-self',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForSelf
);

// ✅ Create task for others
router.post(
  '/create-for-others',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForOthers
);

// ✏️ Update task (Admin/Manager/HR only)
router.put(
  '/:taskId',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.updateTask
);

// 🗑️ Delete task (Admin/Manager/HR only)
router.delete('/:taskId', auth, taskController.deleteTask);

// 🔁 Update task status
router.patch('/:taskId/status', auth, taskController.updateStatus);

// ==================== REMARKS/COMMENTS ROUTES ====================

// 💬 Add remark to task
router.post('/:taskId/remarks', auth, uploadRemarkImage, taskController.addRemark);

// 📋 Get all task remarks
router.get('/:taskId/remarks', auth, taskController.getRemarks);

// ==================== NOTIFICATION ROUTES ====================


// ==================== ACTIVITY LOGS ROUTES ====================

// 📊 Get task activity logs
router.get('/:taskId/activity-logs', auth, taskController.getTaskActivityLogs);

// 📈 Get user activity timeline
router.get('/user-activity/:userId', auth, taskController.getUserActivityTimeline);

// ==================== USER MANAGEMENT ROUTES ====================

// 👤 Get assignable users and groups
router.get('/assignable-users', auth, taskController.getAssignableUsers);

// ==================== TASK STATISTICS ROUTES ====================

// 📊 Get task status counts
router.get('/status-counts', auth, taskController.getTaskStatusCounts);

// ==================== SPECIFIC USER ANALYTICS ====================

// 👤 Get user detailed analytics
router.get('/admin/dashboard/user/:userId/analytics', auth, taskController.getUserDetailedAnalytics);

// ==================== NEW ADMIN DASHBOARD ROUTES ====================

// 📊 Get user task statistics
router.get('/user/:userId/stats', auth, taskController.getUserTaskStats);

// 👥 Get all users with task counts
router.get('/admin/users-with-tasks', auth, taskController.getUsersWithTaskCounts);

// 📈 Get user tasks with filters
router.get('/user/:userId/tasks', auth, taskController.getUserTasks);

// ==================== OVERDUE TASK ROUTES ====================

// ⚠️ Get overdue tasks for logged-in user
router.get('/overdue', auth, taskController.getOverdueTasks);

// ⚠️ Get overdue tasks for specific user
router.get('/user/:userId/overdue', auth, taskController.getUserOverdueTasks);

// ⚠️ Manually mark task as overdue
router.patch('/:taskId/overdue', auth, taskController.markTaskAsOverdue);

// ⚠️ Update all overdue tasks
router.post('/update-overdue-tasks', auth, taskController.updateAllOverdueTasks);

// ⚠️ Get overdue summary
router.get('/overdue/summary', auth, taskController.getOverdueSummary);

// ⚠️ Manual trigger for overdue check
router.get('/check-overdue', auth, taskController.updateAllOverdueTasks);




// PATCH /task/:taskId/quick-status
router.patch('/:taskId/quick-status', auth, taskController.quickStatusUpdate);

module.exports = router;