const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const upload = require("../middlewares/uploadMiddleware");
const auth = require("../../middleware/authMiddleware");

// PROJECT CRUD
router.get("/", auth, projectController.listProjects);
router.get("/:id", auth, projectController.getProjectById);
router.post("/", auth, upload.single("pdfFile"), projectController.createProject);
router.put("/:id", auth, upload.single("pdfFile"), projectController.updateProject);
router.delete("/:id", auth, projectController.deleteProject);

// TASK CRUD
router.post("/:id/tasks", auth, upload.single("pdfFile"), projectController.addTask);
router.patch("/:id/tasks/:taskId", auth, upload.single("pdfFile"), projectController.updateTask);
router.delete("/:id/tasks/:taskId", auth, projectController.deleteTask);

// ⭐ REMARKS ROUTE (FIXED) ⭐
router.post(
  "/:projectId/tasks/:taskId/remarks",
  auth,
  projectController.addRemark
);

module.exports = router;
