const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const projectBulkImportController = require("../controllers/projectBulkImportController");
const { protect } = require('../../middleware/authMiddleware');
const { check } = require("express-validator");
const { uploadRemarkImage, uploadExcel } = require('../middlewares/uploadMiddleware');


router.get("/notifications", protect, projectController.getUserNotifications);
router.patch("/notifications/:notificationId/read", protect, projectController.markNotificationAsRead);
router.delete("/notifications/clear", protect, projectController.clearAllNotifications);

// Excel Bulk Import Routes (Must be before /:id)
router.get("/sample-excel", protect, projectBulkImportController.downloadSampleExcel);
router.post("/bulk-import", protect, uploadExcel.single("file"), projectBulkImportController.bulkImportProjectsAndTasks);

router.get("/", protect, projectController.listProjects);
router.get("/:id/document", protect, projectController.downloadProjectDocument);
router.get("/:id/tasks/:taskId/document", protect, projectController.downloadTaskDocument);
router.get("/:id/tasks/:taskId/files", protect, projectController.downloadTaskFile);
router.get("/:id", protect, projectController.getProjectById);

router.post("/", protect, [
  check("projectName").notEmpty().withMessage("Project name is required"),
  check("description").notEmpty().withMessage("Description is required"),
  check("users").custom(value => {
    try {
      const users = JSON.parse(value);
      return Array.isArray(users) && users.length > 0;
    } catch {
      return false;
    }
  }).withMessage("At least one member is required")
], projectController.createProject);

router.put("/:id", protect, [
  check("projectName").notEmpty().withMessage("Project name is required"),
  check("description").notEmpty().withMessage("Description is required")
], projectController.updateProject);

router.delete("/:id", protect, projectController.deleteProject);


router.post("/:id/tasks", protect, projectController.addTask);

router.patch("/:id/tasks/:taskId", protect, projectController.updateTask);
router.delete("/:id/tasks/:taskId/attachment", protect, projectController.deleteTaskAttachment);
router.delete("/:id/tasks/:taskId", protect, projectController.deleteTask);


router.patch("/:projectId/tasks/:taskId/reminder", protect, projectController.updateTaskReminder);
router.put("/:projectId/tasks/:taskId/reminder", protect, projectController.updateTaskReminder);
router.patch("/:projectId/tasks/:taskId/status", protect, [
  check("status").notEmpty().withMessage("Status is required")
], projectController.updateTaskStatus);
router.patch("/:projectId/tasks/:taskId/checkpoints/:checkpointId", protect, projectController.updateTaskCheckpoint);

router.get("/:projectId/tasks/:taskId/activity", protect, projectController.getTaskActivityLogs);
router.get("/:projectId/tasks/:taskId/remarks", protect, projectController.getTaskRemarks);
router.post("/:projectId/tasks/:taskId/remarks", protect, uploadRemarkImage, projectController.addRemark);


router.get("/:id/users", protect, projectController.getProjectUsers);
router.post("/:projectId/users", protect, projectController.addUserToProject);





router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;
