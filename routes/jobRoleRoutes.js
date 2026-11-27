const express = require("express");
const router = express.Router();
const jobRoleController = require("../controllers/jobRoleController");
const { protect } = require("../middleware/authMiddleware");
const { requirePageAccess } = require("../middleware/pageAccess");

router.use(protect);

const JOB_ROLE_PERMISSION_PATHS = [
  '/ciisUser/JobRoleManagement',
  '/ciisUser/jobrolemanagement',
  '/Ciis-network/JobRoleManagement',
  '/Ciis-network/jobrolemanagement',
  'JobRoleManagement',
  'jobrolemanagement'
];

const requireJobRolePermission = action => requirePageAccess({
  paths: JOB_ROLE_PERMISSION_PATHS, action, label: 'Job Role Management',
});

router.get("/", jobRoleController.getAllJobRoles);
router.get("/getJobRoles/:companyid", jobRoleController.getJobRolesByCompany);
router.get("/company/:companyId", jobRoleController.getJobRolesByCompany);
router.get("/by-company/:companyId", jobRoleController.getJobRolesByCompany);
router.get("/company/:companyId/department/:departmentId", jobRoleController.getJobRolesByCompany);

router.get("/department/:departmentId", jobRoleController.getJobRolesByDepartmentId);
router.get("/by-department/:departmentId", jobRoleController.getJobRolesByDepartmentId);
router.get("/department-id/:departmentId", jobRoleController.getJobRolesByDepartmentId);

router.post("/", requireJobRolePermission('edit'), jobRoleController.createJobRole);
router.put("/:id", requireJobRolePermission('edit'), jobRoleController.updateJobRole);
router.delete("/:id", requireJobRolePermission('delete'), jobRoleController.deleteJobRole);


module.exports = router;