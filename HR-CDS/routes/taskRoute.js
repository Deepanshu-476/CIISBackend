const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const auth = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 

// 📝 Get tasks assigned to me OR created by me
router.get('/', auth, taskController.getTasks);

// 📄 Get only tasks assigned *to me* (including group tasks)
router.get('/my', auth, taskController.getMyTasks);

// 👨‍💼 Get tasks created (assigned) by me
router.get('/assigned', auth, taskController.getAssignedTasks);
router.get('/assigned-tasks-status', auth, taskController.getAssignedTasksWithStatus);

// ➕ Create a task (with groups support and repeat functionality)
router.post(
  '/create',
  auth,
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'voiceNote', maxCount: 1 }
  ]),
  taskController.createTask
);

// 🔁 Update task status
router.patch('/:taskId/status', auth, taskController.updateStatus);

// 👤 Get assignable users AND groups
router.get('/assignable-users', auth, taskController.getAssignableUsers);

// 👥 Get all users – for admin/HR panels
router.get('/all-users', auth, taskController.getAllUsers);

// 🔄 Get recurring tasks
router.get('/recurring', auth, taskController.getRecurringTasks);

router.get('/user-self-assigned/:userId', auth, taskController.getUserSelfAssignedTasks);
// 🔄 Trigger recurring tasks manually (admin only)
router.post('/trigger-recurring', auth, taskController.triggerRecurringTasks);
module.exports = router;