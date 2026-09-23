const express = require("express");
const router = express.Router();
const jobRoleController = require("../controllers/jobRoleController");
const PagePermission = require("../models/PagePermission");
const { protect, isSuperAdminUser } = require("../middleware/authMiddleware");

router.use(protect);

const JOB_ROLE_PERMISSION_PATHS = [
  '/ciisUser/JobRoleManagement',
  '/ciisUser/jobrolemanagement',
  '/Ciis-network/JobRoleManagement',
  '/Ciis-network/jobrolemanagement',
  'JobRoleManagement',
  'jobrolemanagement'
];

const checkJobRolePermission = async (user, action = 'edit') => {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;

  const roles = [user.companyRole, user.jobRole, user.role]
    .filter(Boolean)
    .map(r => String(r).trim().toLowerCase().replace(/[\s_-]+/g, '_'));

  const isOwner = roles.some(r => ['owner', 'company_owner', 'companyowner', 'super_admin', 'superadmin'].includes(r));
  if (isOwner) return true;

  const isFallbackAdmin = roles.some(r => ['admin', 'company_admin'].includes(r));

  const companyId = user.company?._id || user.company || user.companyId;
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return false;

  const page = await PagePermission.findOne({
    company: companyId,
    $or: [
      { path: { $in: JOB_ROLE_PERMISSION_PATHS } },
      { pageKey: { $in: ['JobRoleManagement', 'jobrolemanagement', 'job-role-management'] } }
    ]
  }).lean();

  const extractIds = (arr) => (arr || []).map(item => String(item?.user?._id || item?.user || '')).filter(Boolean);
  const extractScopedIds = (scopes, type) => (scopes || [])
    .filter(s => String(s?.accessType || '').trim().toLowerCase() === type)
    .map(s => String(s?.user?._id || s?.user || '')).filter(Boolean);

  if (!page) {
    return isFallbackAdmin;
  }

  const configuredUserIds = [
    ...extractIds(page.viewUsers),
    ...extractIds(page.editUsers),
    ...extractIds(page.deleteUsers),
    ...extractIds(page.approvers),
    ...(page.userAccessScopes || []).map(s => String(s?.user?._id || s?.user || '')).filter(Boolean)
  ];

  if (configuredUserIds.length === 0) {
    return isFallbackAdmin;
  }

  if (action === 'delete') {
    const deleteIds = new Set([
      ...extractIds(page.deleteUsers),
      ...extractScopedIds(page.userAccessScopes, 'delete')
    ]);
    return deleteIds.has(userId);
  }

  const editIds = new Set([
    ...extractIds(page.editUsers),
    ...extractScopedIds(page.userAccessScopes, 'edit')
  ]);
  return editIds.has(userId);
};

const requireJobRolePermission = (action = 'edit') => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const hasAccess = await checkJobRolePermission(req.user, action);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have permission to ${action === 'delete' ? 'delete' : 'create or edit'} job roles. Configure access in Page Management.`
      });
    }

    next();
  } catch (error) {
    console.error('requireJobRolePermission error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify job role permissions' });
  }
};

router.get("/", jobRoleController.getAllJobRoles);
router.get("/getJobRoles/:companyid", jobRoleController.getJobRolesByDepartment);
router.post("/", requireJobRolePermission('edit'), jobRoleController.createJobRole);
router.get("/department/:departmentId", jobRoleController.getJobRolesByDepartmentId);
router.put("/:id", requireJobRolePermission('edit'), jobRoleController.updateJobRole);
router.delete("/:id", requireJobRolePermission('delete'), jobRoleController.deleteJobRole);

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