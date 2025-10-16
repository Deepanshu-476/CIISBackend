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

// ➕ Create a task (with groups support)
router.post(
  '/create',
  auth,
  upload.fields([
    { name: 'files' },
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

router.get('/user-self-assigned/:userId', auth, taskController.getUserSelfAssignedTasks);

module.exports = router;