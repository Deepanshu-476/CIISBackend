const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");

const { protect, authorize } = require('../../middleware/authMiddleware');

const { check, validationResult } = require("express-validator");

// ==========================================
// 📌 NOTIFICATION ROUTES
// ==========================================
router.get("/notifications", protect, projectController.getUserNotifications);
router.patch("/notifications/:notificationId/read", protect, projectController.markNotificationAsRead);
router.delete("/notifications/clear", protect, projectController.clearAllNotifications);

// ==========================================
// 📌 PROJECT CRUD ROUTES
// ==========================================
router.get("/", protect, projectController.listProjects);
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

// ==========================================
// 📌 TASK CRUD ROUTES
// ==========================================
router.post("/:id/tasks", protect, [
  check("title").notEmpty().withMessage("Task title is required"),
  check("assignedTo").notEmpty().withMessage("Assigned user is required")
], projectController.addTask);

router.patch("/:id/tasks/:taskId", protect, projectController.updateTask);
router.delete("/:id/tasks/:taskId", protect, projectController.deleteTask);

// ==========================================
// 📌 TASK STATUS & ACTIVITY ROUTES
// ==========================================
router.patch("/:projectId/tasks/:taskId/status", protect, [
  check("status").notEmpty().withMessage("Status is required")
], projectController.updateTaskStatus);

router.get("/:projectId/tasks/:taskId/activity", protect, projectController.getTaskActivityLogs);
// ==========================================
// 📌 REMARKS ROUTES
// ==========================================
router.post("/:projectId/tasks/:taskId/remarks", protect, [
  check("text").notEmpty().withMessage("Remark text is required")
], projectController.addRemark);

// Error handling middleware
router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;