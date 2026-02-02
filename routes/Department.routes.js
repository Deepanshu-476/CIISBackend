// routes/departmentRoutes.js
const express = require("express");
const router = express.Router();
const departmentController = require("../controllers/departmentController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Apply authentication to ALL routes
router.use(protect);

// Now all routes below will have req.user available

// All authenticated users can view departments
router.get("/", departmentController.getAllDepartments);

// Get departments by specific company
router.get("/company/:companyId", departmentController.getDepartmentsByCompany);

// Create department - remove authorize temporarily for testing
router.post("/", departmentController.createDepartment);

// Update department
router.put("/:id", departmentController.updateDepartment);

// Delete department
router.delete("/:id", departmentController.deleteDepartment);

// Debug route to check user info
router.get("/debug", (req, res) => {
  console.log("Debug user info:", req.user);
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;