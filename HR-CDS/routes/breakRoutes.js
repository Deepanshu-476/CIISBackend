const express = require('express');
const router = express.Router();
const breakController = require('../controllers/breakController');
const { protect } = require('../../middleware/authMiddleware');
const PagePermission = require('../../models/PagePermission');

router.use(protect);

// Employee routes
router.get('/today', breakController.getToday);
router.post('/start', breakController.startBreak);
router.post('/stop', breakController.stopBreak);

const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');

// The same people who already manage employee attendance (and overtime, and weekly offs).
const privilegedRoles = [
  'super_admin', 'superadmin',
  'owner', 'company_owner', 'companyowner',
  'admin', 'company_admin', 'companyadmin',
  'hr', 'hr_manager', 'manager'
];

const checkBreakAdminAccess = (requiredPermission = 'view') => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });
  if (req.user.isSuperAdmin || req.user.isCompanyOwner) return next();

  const userRoles = [req.user.jobRole, req.user.jobRoleName, req.user.companyRole, req.user.role, req.user.userType]
    .filter(Boolean)
    .map(normalizeRole);
  if (userRoles.some(role => privilegedRoles.includes(role))) return next();

  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const userId = String(req.user?._id || req.user?.id || '');
    if (company && userId) {
      const page = await PagePermission.findOne({ company, path: '/ciisUser/emp-attendance' }).lean();
      if (page) {
        const idsOf = (list = []) => list.map(entry => String(entry?.user?._id || entry?.user || ''));
        const viewIds = new Set([...idsOf(page.viewUsers), ...idsOf(page.editUsers), ...idsOf(page.deleteUsers), ...idsOf(page.approvers)]);
        const editIds = new Set([...idsOf(page.editUsers), ...idsOf(page.approvers)]);
        if (requiredPermission === 'view' && viewIds.has(userId)) return next();
        if (requiredPermission === 'edit' && editIds.has(userId)) return next();
      }
    }
  } catch (error) {
    console.error('Error checking break admin page permission:', error.message);
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. Only authorized Admin or HR can manage breaks.'
  });
};

// Admin / HR routes
router.get('/settings', checkBreakAdminAccess('view'), breakController.getSettings);
router.put('/settings/:level/:id', checkBreakAdminAccess('edit'), breakController.updateSettings);
router.get('/live', checkBreakAdminAccess('view'), breakController.getLive);
router.get('/report', checkBreakAdminAccess('view'), breakController.getReport);

module.exports = router;
