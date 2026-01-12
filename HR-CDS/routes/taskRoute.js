const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const auth = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');

// ==================== TASK ROUTES ====================

// 📝 सभी Tasks देखें - मेरे लिए assigned + मेरे द्वारा बनाए गए
router.get('/', auth, taskController.getTasks);

// 📄 सिर्फ मेरे Tasks देखें - मेरे लिए assigned tasks (direct + group)
router.get('/my', auth, taskController.getMyTasks);

// 👨‍💼 मेरे द्वारा Assign किए गए Tasks देखें - (Admin/Manager/HR के लिए)
router.get('/assigned', auth, taskController.getAssignedTasks);

// ✅ खुद के लिए Task बनाएं - Self task creation
router.post(
  '/create-self',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForSelf
);

// ✅ दूसरों के लिए Task बनाएं - Others ko assign kare (Admin/Manager/HR के लिए)
router.post(
  '/create-for-others',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForOthers
);

// ✏️ Task Update करें - Edit task details (Admin/Manager/HR के लिए)
router.put(
  '/:taskId',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.updateTask
);

// 🗑️ Task Delete करें - Soft delete task (Admin/Manager/HR के लिए)
router.delete('/:taskId', auth, taskController.deleteTask);

// 🔁 Task Status Update करें - Status change (pending → in-progress → completed)
router.patch('/:taskId/status', auth, taskController.updateStatus);

// ==================== REMARKS/COMMENTS ROUTES ====================

// 💬 Task पर Remark/Comment डालें - Add comments to task
router.post('/:taskId/remarks', auth, uploadRemarkImage, taskController.addRemark);

// 📋 Task के सभी Remarks देखें - Get all task comments
router.get('/:taskId/remarks', auth, taskController.getRemarks);

// ==================== NOTIFICATION ROUTES ====================

// 🔔 User की सभी Notifications देखें - Get user notifications
router.get('/notifications/all', auth, taskController.getNotifications);

// ✅ Single Notification Read Mark करें - Mark one notification as read
router.patch('/notifications/:notificationId/read', auth, taskController.markNotificationAsRead);

// ✅ सभी Notifications Read Mark करें - Mark all notifications as read
router.patch('/notifications/read-all', auth, taskController.markAllNotificationsAsRead);

// ==================== ACTIVITY LOGS ROUTES ====================

// 📊 Specific Task की Activity Logs देखें - Get task activity history
router.get('/:taskId/activity-logs', auth, taskController.getTaskActivityLogs);

// 📈 User की Activity Timeline देखें - Get user activity timeline
router.get('/user-activity/:userId', auth, taskController.getUserActivityTimeline);

// ==================== USER MANAGEMENT ROUTES ====================

// 👤 Assignable Users और Groups देखें - Get users/groups for task assignment
router.get('/assignable-users', auth, taskController.getAssignableUsers);

// ==================== TASK STATUS COUNTS ROUTES ====================
// 📊 Get user all tasks status counts (complete breakdown)
router.get('/status-counts', auth, taskController.getTaskStatusCounts);

// ==================== SPECIFIC USER ANALYTICS ====================

// 👤 Get specific user's complete task analytics
router.get('/admin/dashboard/user/:userId/analytics', auth, taskController.getUserDetailedAnalytics);

// ==================== NEW ADMIN DASHBOARD ROUTES ====================

// 📊 Get user specific task statistics
router.get('/user/:userId/stats', auth, taskController.getUserTaskStats);

// 👥 Get all users with their task counts
router.get('/admin/users-with-tasks', auth, taskController.getUsersWithTaskCounts);

// 📈 Get user tasks with filters
router.get('/user/:userId/tasks', auth, taskController.getUserTasks);

// ==================== OVERDUE TASK ROUTES ==================== ✅ ADDED

// ⚠️ Get overdue tasks for logged-in user
router.get('/overdue', auth, taskController.getOverdueTasks);

// ⚠️ Get overdue tasks for specific user (Admin/Manager/HR)
router.get('/user/:userId/overdue', auth, taskController.getUserOverdueTasks);

// ⚠️ Manually mark a task as overdue
router.patch('/:taskId/overdue', auth, taskController.markTaskOverdue);

// ⚠️ Update all overdue tasks (Admin/Manager/HR - for cron job)
router.post('/update-overdue-tasks', auth, taskController.updateAllOverdueTasks);

// ⚠️ Get overdue tasks summary (counts and details)
router.get('/overdue/summary', auth, taskController.getOverdueSummary);

module.exports = router;