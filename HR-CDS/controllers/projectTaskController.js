// controllers/projectTaskController.js
const projectController = require('./projectController');
const taskController = require('./taskController');

module.exports = {
  // Fetch project tasks assigned to current user (from taskController)
  getAssignedProjectTasks: taskController.getAssignedProjectTasks,
  
  // Project task CRUD (from projectController)
  addTask: projectController.addTask,
  updateTask: projectController.updateTask,
  deleteTask: projectController.deleteTask,
  updateTaskStatus: projectController.updateTaskStatus,
  getTaskActivityLogs: projectController.getTaskActivityLogs,
  getTaskRemarks: projectController.getTaskRemarks,
  addRemark: projectController.addRemark
};
