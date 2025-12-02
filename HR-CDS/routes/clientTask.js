const express = require('express');
const router = express.Router();
const taskController = require('../controllers/ClientTask');

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