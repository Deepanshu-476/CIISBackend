const express = require("express");
const router = express.Router();
const departmentController = require("../controllers/departmentController");
const { protect, authorize } = require("../middleware/authMiddleware");

// ✅ Apply authentication to all routes
router.use(protect);

// ✅ All authenticated users can view departments
router.get("/", departmentController.getAllDepartments);

// ✅ Admin-only routes
router.post("/", authorize('admin', 'hr', 'manager'), departmentController.createDepartment);
router.put("/:id", authorize('admin', 'hr', 'manager'), departmentController.updateDepartment);
router.delete("/:id", authorize('admin'), departmentController.deleteDepartment);

module.exports = router;