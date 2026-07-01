const express = require("express");
const router = express.Router();
const jobRoleController = require("../controllers/jobRoleController");
const { protect, authorize } = require("../middleware/authMiddleware");


router.use(protect);




router.get("/", jobRoleController.getAllJobRoles);


router.get("/getJobRoles/:companyid", jobRoleController.getJobRolesByDepartment);


router.post("/", jobRoleController.createJobRole);

router.get("/department/:departmentId", jobRoleController.getJobRolesByDepartmentId);

router.put("/:id", jobRoleController.updateJobRole);


router.delete("/:id", jobRoleController.deleteJobRole);


router.get("/test", (req, res) => {
  void 0;
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;