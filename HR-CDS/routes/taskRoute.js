const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { protect, authorize }= require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');

// ==================== TASK ROUTES ====================
// ==================== NOTIFICATION ROUTES ====================

// 🔔 Get user notifications
router.get('/notifications/all', protect, taskController.getNotifications);

// Mark as read
router.patch('/notifications/:notificationId/read', protect, taskController.markNotificationAsRead);
router.patch('/notifications/read-all', protect, taskController.markAllNotificationsAsRead);
// ==================== TASK ROUTES ====================
router.get('/', protect, taskController.getTasks || taskController.getMyTasks);
router.get('/my', protect, taskController.getMyTasks);
router.get('/assigned', protect, taskController.getAssignedTasks);
// ✅ Create task for self
router.post(
  '/create-self',
  protect,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForSelf
);

// ✅ Create task for others
router.post(
  '/create-for-others',
  protect,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForOthers
);

// ✏️ Update task (Admin/Manager/HR only)
router.put(
  '/:taskId',
  protect,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.updateTask
);

// 🗑️ Delete task (Admin/Manager/HR only)
router.delete('/:taskId', protect, taskController.deleteTask);

// 🔁 Update task status
router.patch('/:taskId/status', protect, taskController.updateStatus);

// ==================== REMARKS/COMMENTS ROUTES ====================

// 💬 Add remark to task
router.post('/:taskId/remarks', protect, uploadRemarkImage, taskController.addRemark);

// 📋 Get all task remarks
router.get('/:taskId/remarks', protect, taskController.getRemarks);

// ==================== NOTIFICATION ROUTES ====================


// ==================== ACTIVITY LOGS ROUTES ====================

// 📊 Get task activity logs
router.get('/:taskId/activity-logs', protect, taskController.getTaskActivityLogs);

// 📈 Get user activity timeline
router.get('/user-activity/:userId', protect, taskController.getUserActivityTimeline);

// ==================== USER MANAGEMENT ROUTES ====================

// 👤 Get assignable users and groups
router.get('/assignable-users', protect, taskController.getAssignableUsers);

// ==================== TASK STATISTICS ROUTES ====================

// 📊 Get task status counts
router.get('/status-counts', protect, taskController.getTaskStatusCounts);

// ==================== SPECIFIC USER ANALYTICS ====================

// 👤 Get user detailed analytics
router.get('/admin/dashboard/user/:userId/analytics', protect, taskController.getUserDetailedAnalytics);

// ==================== NEW ADMIN DASHBOARD ROUTES ====================

// 📊 Get user task statistics
router.get('/user/:userId/stats', protect, taskController.getUserTaskStats);

// 👥 Get all users with task counts
router.get('/admin/users-with-tasks', protect, taskController.getUsersWithTaskCounts);

// 📈 Get user tasks with filters
router.get('/user/:userId/tasks', protect, taskController.getUserTasks);

// ==================== OVERDUE TASK ROUTES ====================

// ⚠️ Get overdue tasks for logged-in user
router.get('/overdue', protect, taskController.getOverdueTasks);

// ⚠️ Get overdue tasks for specific user
router.get('/user/:userId/overdue', protect, taskController.getUserOverdueTasks);

// ⚠️ Manually mark task as overdue
router.patch('/:taskId/overdue', protect, taskController.markTaskAsOverdue);

// ⚠️ Update all overdue tasks
router.post('/update-overdue-tasks', protect, taskController.updateAllOverdueTasks);

// ⚠️ Get overdue summary
router.get('/overdue/summary', protect , taskController.getOverdueSummary);

// ⚠️ Manual trigger for overdue check
router.get('/check-overdue', protect, taskController.updateAllOverdueTasks);


// PATCH /task/:taskId/quick-status
router.patch('/:taskId/quick-status', protect, taskController.quickStatusUpdate);
module.exports = router;