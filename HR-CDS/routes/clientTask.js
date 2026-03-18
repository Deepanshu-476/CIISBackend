const express = require('express');
const router = express.Router();
const taskController = require('../controllers/ClientTask');
const authMiddleware = require('../middlewares/auth'); // अगर आपके पास auth middleware है

// Test endpoint - सबसे ऊपर रखें
router.get('/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Task API is working',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/tasks/test',
      'GET /api/tasks/assigned-to-me',           // नया endpoint
      'GET /api/tasks/client/:clientId/service/:service',
      'POST /api/tasks/client/:clientId/service/:service',
      'GET /api/tasks/client/:clientId',
      'GET /api/tasks/client/:clientId/stats',
      'PUT /api/tasks/:taskId',
      'PATCH /api/tasks/:taskId/toggle',
      'DELETE /api/tasks/:taskId'
    ]
  });
});

// ===== नया ENDPOINT - Assigned to Me =====
// GET /api/tasks/assigned-to-me - मुझे असाइन किए गए सभी टास्क
router.get('/assigned-to-me', authMiddleware, taskController.getAssignedToMeTasks);

// PATCH /api/tasks/assigned/:taskId/status - असाइन किए गए टास्क की स्टेटस अपडेट करें
router.patch('/assigned/:taskId/status', authMiddleware, taskController.updateAssignedTaskStatus);

// ===== Existing Routes =====
// Client service tasks
router.get('/client/:clientId/service/:service', taskController.getTasksByClientService);
router.post('/client/:clientId/service/:service', taskController.addTask);

// All client tasks
router.get('/client/:clientId', taskController.getClientTasks);
router.get('/client/:clientId/stats', taskController.getTaskStats);

// Individual task operations
router.put('/:taskId', taskController.updateTask);
router.patch('/:taskId/toggle', taskController.toggleTaskCompletion);
router.delete('/:taskId', taskController.deleteTask);

module.exports = router;