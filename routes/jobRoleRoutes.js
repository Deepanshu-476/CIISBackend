const express = require("express");
const router = express.Router();
const jobRoleController = require("../controllers/jobRoleController");
const { protect, isSuperAdminUser } = require("../middleware/authMiddleware");

router.use(protect);

const isCompanyAdminOrOwner = (user) => {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  const roles = [user.companyRole, user.jobRole, user.role]
    .filter(Boolean)
    .map(r => String(r).trim().toLowerCase().replace(/[\s_-]+/g, '_'));
  return roles.some(r => ['owner', 'company_owner', 'companyowner', 'admin', 'company_admin'].includes(r));
};

const requireJobRoleManager = (req, res, next) => {
  if (!isCompanyAdminOrOwner(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Company Owner, Admin, or SuperAdmin can manage job roles.'
    });
  }
  next();
};

router.get("/", jobRoleController.getAllJobRoles);
router.get("/getJobRoles/:companyid", jobRoleController.getJobRolesByDepartment);
router.post("/", requireJobRoleManager, jobRoleController.createJobRole);
router.get("/department/:departmentId", jobRoleController.getJobRolesByDepartmentId);
router.put("/:id", requireJobRoleManager, jobRoleController.updateJobRole);
router.delete("/:id", requireJobRoleManager, jobRoleController.deleteJobRole);

router.get("/test", (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;