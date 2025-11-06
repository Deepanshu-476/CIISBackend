const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/projectController");
const auth = require("../../middleware/authMiddleware"); // ✅ correct import

// Protect all routes
router.use(auth);

// PROJECTS
router.get("/", ctrl.listProjects);
router.post("/", ctrl.createProject);
router.get("/:id", ctrl.getProjectById);
router.put("/:id", ctrl.updateProject);
router.delete("/:id", ctrl.deleteProject);

// TASKS
router.post("/:id/tasks", ctrl.addTask);
router.patch("/:id/tasks/:taskId", ctrl.updateTask);
router.delete("/:id/tasks/:taskId", ctrl.deleteTask);

module.exports = router;
