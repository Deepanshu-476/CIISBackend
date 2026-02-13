const express = require('express');
const router = express.Router();
const taskController = require('../controllers/ClientTask');

// Test endpoint - सबसे ऊपर रखें ताकि दूसरे routes से conflict न हो
router.get('/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Task API is working',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/tasks/test',
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