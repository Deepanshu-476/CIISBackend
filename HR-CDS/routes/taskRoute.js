const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const auth = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 

// ==================== TASK ROUTES ====================

// 📝 Get tasks assigned to me OR created by me
router.get('/', auth, taskController.getTasks);

// 📄 Get only tasks assigned *to me* (including group tasks)
router.get('/my', auth, taskController.getMyTasks);

// 👨‍💼 Get tasks created (assigned) by me
router.get('/assigned', auth, taskController.getAssignedTasks);
router.get('/assigned-tasks-status', auth, taskController.getAssignedTasksWithStatus);

// ✅ Create task for self (khud ke liye)
router.post(
  '/create-self',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForSelf
);

// ✅ Create task for others (dusre users ko assign kare)
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
router.post('/:taskId/remarks', auth, taskController.addRemark);

// 📋 Get task remarks
router.get('/:taskId/remarks', auth, taskController.getRemarks);

// ==================== NOTIFICATION ROUTES ====================

// 🔔 Get user notifications
router.get('/notifications/all', auth, taskController.getNotifications);

// ✅ Mark single notification as read
router.patch('/notifications/:notificationId/read', auth, taskController.markNotificationAsRead);

// ✅ Mark all notifications as read
router.patch('/notifications/read-all', auth, taskController.markAllNotificationsAsRead);

// ==================== ACTIVITY LOGS ROUTES ====================

// 📊 Get activity logs for a specific task
router.get('/:taskId/activity-logs', auth, taskController.getTaskActivityLogs);

// 📈 Get user activity timeline
router.get('/user-activity/:userId', auth, taskController.getUserActivityTimeline);

// ==================== USER MANAGEMENT ROUTES ====================

// 👤 Get assignable users AND groups
router.get('/assignable-users', auth, taskController.getAssignableUsers);

// 👥 Get all users – for admin/HR panels
router.get('/all-users', auth, taskController.getAllUsers);

// 👤 Get self-assigned tasks for a specific user (Admin view)
router.get('/user-self-assigned/:userId', auth, taskController.getUserSelfAssignedTasks);

// 📊 All user task stats
router.get('/admin/all-users-stats', auth, taskController.getAllUsersTaskStats);

// 📈 Single User ka Task Count
router.get('/user-stats/:userId', auth, taskController.getSingleUserTaskStats);


router.get('/my-stats', auth, taskController.getMyStats);
module.exports = router;