const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const upload = require("../middlewares/uploadMiddleware");
const auth = require("../../middleware/authMiddleware");

// ==========================================
// 📌 NOTIFICATION ROUTES (FIXED PATHS)
// ==========================================
router.get("/notifications", auth, projectController.getUserNotifications);
router.patch("/notifications/:notificationId/read", auth, projectController.markNotificationAsRead);
router.delete("/notifications/clear", auth, projectController.clearAllNotifications);

// ==========================================
// 📌 PROJECT CRUD ROUTES
// ==========================================
router.get("/", auth, projectController.listProjects);
router.get("/:id", auth, projectController.getProjectById);
router.post("/", auth,  projectController.createProject);
router.put("/:id", auth,  projectController.updateProject);
router.delete("/:id", auth, projectController.deleteProject);

// ==========================================
// 📌 TASK CRUD ROUTES
// ==========================================
router.post("/:id/tasks", auth, projectController.addTask);
router.patch("/:id/tasks/:taskId", auth,  projectController.updateTask);
router.delete("/:id/tasks/:taskId", auth, projectController.deleteTask);

// ==========================================
// 📌 TASK STATUS & ACTIVITY ROUTES
// ==========================================
router.patch("/:projectId/tasks/:taskId/status", auth, projectController.updateTaskStatus);
router.get("/:projectId/tasks/:taskId/activity", auth, projectController.getTaskActivityLogs);

// ==========================================
// 📌 REMARKS ROUTES
// ==========================================
router.post("/:projectId/tasks/:taskId/remarks", auth, projectController.addRemark);

module.exports = router;