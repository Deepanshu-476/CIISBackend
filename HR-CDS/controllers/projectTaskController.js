
const projectController = require('./projectController');
const taskController = require('./taskController');

module.exports = {
  
  getAssignedProjectTasks: taskController.getAssignedProjectTasks,
  
  
  addTask: projectController.addTask,
  updateTask: projectController.updateTask,
  deleteTask: projectController.deleteTask,
  updateTaskStatus: projectController.updateTaskStatus,
  getTaskActivityLogs: projectController.getTaskActivityLogs,
  getTaskRemarks: projectController.getTaskRemarks,
  addRemark: projectController.addRemark
};
