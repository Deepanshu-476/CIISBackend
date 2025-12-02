const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const auth = require("../../middleware/authMiddleware");
const { check, validationResult } = require("express-validator");

// ==========================================
// 📌 NOTIFICATION ROUTES
// ==========================================
router.get("/notifications", auth, projectController.getUserNotifications);
router.patch("/notifications/:notificationId/read", auth, projectController.markNotificationAsRead);
router.delete("/notifications/clear", auth, projectController.clearAllNotifications);

// ==========================================
// 📌 PROJECT CRUD ROUTES
// ==========================================
router.get("/", auth, projectController.listProjects);
router.get("/:id", auth, projectController.getProjectById);

router.post("/", auth, [
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

router.put("/:id", auth, [
  check("projectName").notEmpty().withMessage("Project name is required"),
  check("description").notEmpty().withMessage("Description is required")
], projectController.updateProject);

router.delete("/:id", auth, projectController.deleteProject);

// ==========================================
// 📌 TASK CRUD ROUTES
// ==========================================
router.post("/:id/tasks", auth, [
  check("title").notEmpty().withMessage("Task title is required"),
  check("assignedTo").notEmpty().withMessage("Assigned user is required")
], projectController.addTask);

router.patch("/:id/tasks/:taskId", auth, projectController.updateTask);
router.delete("/:id/tasks/:taskId", auth, projectController.deleteTask);

// ==========================================
// 📌 TASK STATUS & ACTIVITY ROUTES
// ==========================================
router.patch("/:projectId/tasks/:taskId/status", auth, [
  check("status").notEmpty().withMessage("Status is required")
], projectController.updateTaskStatus);

router.get("/:projectId/tasks/:taskId/activity", auth, projectController.getTaskActivityLogs);

// ==========================================
// 📌 REMARKS ROUTES
// ==========================================
router.post("/:projectId/tasks/:taskId/remarks", auth, [
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