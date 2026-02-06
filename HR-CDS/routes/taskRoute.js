const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { protect } = require('../../middleware/authMiddleware'); // ✅ authorize हटा दिया
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');

// ==================== TASK ROUTES ====================

// ✅ GET ALL TASKS (Public for all authenticated users)
router.get('/', protect, taskController.getTasks);

// ✅ GET MY TASKS (Logged-in user's tasks)
router.get('/my', protect, taskController.getMyTasks);

// ✅ GET ASSIGNED TASKS (Tasks created by logged-in user)
router.get('/assigned', protect, taskController.getAssignedTasks);

// ✅ CREATE TASK FOR SELF (All users can create self-tasks)
router.post(
  '/create-self',
  protect,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForSelf
);

// ✅ CREATE TASK FOR OTHERS (All users can assign to anyone)
router.post(
  '/create-for-others',
  protect,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTaskForOthers
);

// ✅ UPDATE TASK (Only task creator can update)
router.put(
  '/:taskId',
  protect,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.updateTask
);

// ✅ DELETE TASK (Only task creator can delete)
router.delete('/:taskId', protect, taskController.deleteTask);

// ✅ UPDATE TASK STATUS (Assigned users can update)
router.patch('/:taskId/status', protect, taskController.updateStatus);

// ==================== REMARKS/COMMENTS ROUTES ====================

// ✅ ADD REMARK TO TASK (Task participants only)
router.post('/:taskId/remarks', protect, uploadRemarkImage, taskController.addRemark);

// ✅ GET TASK REMARKS (Task participants only)
router.get('/:taskId/remarks', protect, taskController.getRemarks);

// ==================== NOTIFICATION ROUTES ====================

// ✅ GET USER NOTIFICATIONS (User's own notifications)
router.get('/notifications/all', protect, taskController.getNotifications);

// ✅ MARK NOTIFICATION AS READ (User's own notifications)
router.patch('/notifications/:notificationId/read', protect, taskController.markNotificationAsRead);

// ✅ MARK ALL NOTIFICATIONS AS READ (User's own notifications)
router.patch('/notifications/read-all', protect, taskController.markAllNotificationsAsRead);

// ==================== ACTIVITY LOGS ROUTES ====================

// ✅ GET TASK ACTIVITY LOGS (Task participants only)
router.get('/:taskId/activity-logs', protect, taskController.getTaskActivityLogs);

// ✅ GET USER ACTIVITY TIMELINE (Open for all authenticated users)
router.get('/user-activity/:userId', protect, taskController.getUserActivityTimeline);

// ==================== USER MANAGEMENT ROUTES ====================

// ✅ GET ASSIGNABLE USERS AND GROUPS (Open for all authenticated users)
router.get('/assignable-users', protect, taskController.getAssignableUsers);

// ==================== TASK STATISTICS ROUTES ====================

// ✅ GET TASK STATUS COUNTS (Logged-in user's stats)
router.get('/status-counts', protect, taskController.getTaskStatusCounts);

// ✅ GET TASK STATISTICS (Alias for status-counts)
router.get('/statistics', protect, taskController.getTaskStatistics);

// ==================== USER ANALYTICS ROUTES ====================

// ✅ GET USER DETAILED ANALYTICS (Open for all authenticated users)
router.get('/admin/dashboard/user/:userId/analytics', protect, taskController.getUserDetailedAnalytics);

// ✅ GET USER TASK STATISTICS (Open for all authenticated users)
router.get('/user/:userId/stats', protect, taskController.getUserTaskStats);

// ✅ GET ALL USERS WITH TASK COUNTS (Open for all authenticated users)
router.get('/users-with-counts', protect, taskController.getUsersWithTaskCounts);
router.get('/department-users-with-counts', protect, taskController.getDepartmentUsersWithTaskCounts);
// ✅ GET USER TASKS WITH FILTERS (Open for all authenticated users)
router.get('/user/:userId/tasks', protect, taskController.getUserTasks);

// ==================== OVERDUE TASK ROUTES ====================

// ✅ GET OVERDUE TASKS FOR LOGGED-IN USER
router.get('/overdue', protect, taskController.getOverdueTasks);

// ✅ GET OVERDUE TASKS FOR SPECIFIC USER (Open for all authenticated users)
router.get('/user/:userId/overdue', protect, taskController.getUserOverdueTasks);

// ✅ MANUALLY MARK TASK AS OVERDUE (Task participants only)
router.patch('/:taskId/overdue', protect, taskController.markTaskAsOverdue);

// ✅ UPDATE ALL OVERDUE TASKS (For cron jobs or manual trigger)
router.post('/update-overdue-tasks', protect, taskController.updateAllOverdueTasks);

// ✅ GET OVERDUE SUMMARY (Open for all authenticated users)
router.get('/overdue/summary', protect, taskController.getOverdueSummary);
router.get('/overdue/summary/:userId', protect, taskController.getOverdueSummary);

// ✅ MANUAL TRIGGER FOR OVERDUE CHECK
router.get('/check-overdue', protect, taskController.updateAllOverdueTasks);

// ==================== QUICK ACTIONS ROUTES ====================

// ✅ QUICK STATUS UPDATE
router.patch('/:taskId/quick-status', protect, taskController.quickStatusUpdate);

// ==================== SNOOZE TASK ROUTES ====================

// ✅ SNOOZE TASK
router.patch('/:taskId/snooze', protect, taskController.snoozeTask);

// ==================== ADMIN DASHBOARD ROUTES (OPEN FOR ALL) ====================

// ✅ GET ALL TEAM MEMBERS (All users can see all users)
router.get('/team-members', protect, taskController.getUsersWithTaskCounts);

// ✅ GET MANAGER TEAM TASKS (All users can see team tasks)
router.get('/manager/team-tasks', protect, async (req, res) => {
  // Redirect to general endpoint
  return taskController.getUsersWithTaskCounts(req, res);
});

// ✅ GET ADMIN ALL USERS TASKS (All users can see all users tasks)
router.get('/admin/all-users-tasks', protect, async (req, res) => {
  // Redirect to general endpoint
  return taskController.getUsersWithTaskCounts(req, res);
});

// ==================== ADDITIONAL PUBLIC ROUTES ====================

// ✅ GET USER PROFILE WITH TASKS
router.get('/user-profile/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user details
    const User = require('../../models/User');
    const user = await User.findById(userId)
      .select('name email role employeeType joiningDate avatar')
      .lean();
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Get user task stats
    req.params.userId = userId;
    const statsResponse = await taskController.getUserTaskStats(req, res);
    
    // Return combined data
    return res.json({
      success: true,
      user,
      stats: statsResponse.data || {}
    });
    
  } catch (error) {
    console.error('❌ Error in user profile:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});

// ✅ SEARCH USERS
router.get('/search/users', protect, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.json({
        success: true,
        users: []
      });
    }
    
    const User = require('../../models/User');
    
    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { employeeId: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    })
    .select('name email role employeeType avatar')
    .limit(20)
    .lean();
    
    return res.json({
      success: true,
      users
    });
    
  } catch (error) {
    console.error('❌ Error searching users:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to search users'
    });
  }
});

// ✅ GET TASK DETAILS WITH PARTICIPANTS
router.get('/:taskId/details', protect, async (req, res) => {
  try {
    const { taskId } = req.params;
    
    const Task = require('../models/Task');
    
    const task = await Task.findById(taskId)
      .populate('assignedUsers', 'name email role avatar')
      .populate('assignedGroups', 'name description')
      .populate('createdBy', 'name email role avatar')
      .populate('remarks.user', 'name role avatar')
      .lean();
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }
    
    // Check if user has access to this task
    const isAuthorized = 
      task.assignedUsers.some(u => u._id.toString() === req.user._id.toString()) ||
      task.createdBy._id.toString() === req.user._id.toString();
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view this task'
      });
    }
    
    return res.json({
      success: true,
      task
    });
    
  } catch (error) {
    console.error('❌ Error fetching task details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch task details'
    });
  }
});

// ==================== HEALTH CHECK ROUTES ====================

// ✅ HEALTH CHECK
router.get('/health', (req, res) => {
  return res.json({
    success: true,
    message: 'Task management API is running',
    timestamp: new Date(),
    version: '1.0.0'
  });
});

// ✅ API INFO
router.get('/info', protect, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    },
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
      getUsersWithCounts: 'GET /users-with-counts'
    }
  });
});

module.exports = router;