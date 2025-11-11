const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const upload = require("../middlewares/uploadMiddleware");

router.get("/", projectController.listProjects);
router.get("/:id", projectController.getProjectById);

router.post("/", upload.single("pdfFile"), projectController.createProject); // ✅ fixed
router.put("/:id", upload.single("pdfFile"), projectController.updateProject);

router.delete("/:id", projectController.deleteProject);

// ✅ Task routes
router.post("/:id/tasks", upload.single("pdfFile"), projectController.addTask);
router.patch("/:id/tasks/:taskId", upload.single("pdfFile"), projectController.updateTask);
router.delete("/:id/tasks/:taskId", projectController.deleteTask);

module.exports = router;
