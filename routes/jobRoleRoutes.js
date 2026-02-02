const express = require("express");
const router = express.Router();
const jobRoleController = require("../controllers/jobRoleController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Apply authentication to ALL routes
router.use(protect);

// Now all routes below will have req.user available

// All authenticated users can view job roles
router.get("/", jobRoleController.getAllJobRoles);

// Get job roles by specific department
router.get("/getJobRoles/:companyid", jobRoleController.getJobRolesByDepartment);

// Create job role
router.post("/", jobRoleController.createJobRole);
// Get job roles by department ID (for dropdown)
router.get("/department/:departmentId", jobRoleController.getJobRolesByDepartmentId);
// Update job role
router.put("/:id", jobRoleController.updateJobRole);

// Delete job role
router.delete("/:id", jobRoleController.deleteJobRole);

// Debug route to check user info
router.get("/debug", (req, res) => {
  console.log("Debug user info:", req.user);
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;