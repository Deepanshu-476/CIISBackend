const express = require('express');
const router = express.Router();
const overtimeController = require('../controllers/overtimeController');
const { protect } = require('../../middleware/authMiddleware');
const PagePermission = require('../../models/PagePermission');

// Employee routes
router.post('/request', protect, overtimeController.createOvertimeRequest);
router.get('/my-requests', protect, overtimeController.getMyOvertimeRequests);
router.delete('/request/:id', protect, overtimeController.deleteOvertimeRequest);

// Overtime Clock / Timer routes
router.get('/today-session', protect, overtimeController.getTodayOvertimeSession);
router.post('/start', protect, overtimeController.startOvertimeSession);
router.post('/stop', protect, overtimeController.stopOvertimeSession);

const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');

const privilegedOtRoles = [
  'super_admin', 'superadmin',
  'owner', 'company_owner', 'companyowner',
  'admin', 'company_admin', 'companyadmin',
  'hr', 'hr_manager', 'manager'
];

const checkOtAdminAccess = (requiredPermission = 'view') => async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  // 1. Super Admin or Company Owner check
  if (req.user.isSuperAdmin || req.user.isCompanyOwner) {
    return next();
  }

  // 2. Direct role match
  const userRoles = [
    req.user.jobRole,
    req.user.jobRoleName,
    req.user.companyRole,
    req.user.role,
    req.user.userType
  ].filter(Boolean).map(normalizeRole);

  if (userRoles.some(r => privilegedOtRoles.includes(r))) {
    return next();
  }

  // 3. Dynamic PagePermission check for /ciisUser/emp-attendance
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const userId = String(req.user?._id || req.user?.id || '');
    if (company && userId) {
      const page = await PagePermission.findOne({
        company,
        path: '/ciisUser/emp-attendance'
      }).lean();

      if (page) {
        const viewIds = new Set([
          ...(page.viewUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.editUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.deleteUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.approvers || []).map(u => String(u?.user?._id || u?.user || ''))
        ]);
        const editIds = new Set([
          ...(page.editUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.approvers || []).map(u => String(u?.user?._id || u?.user || ''))
        ]);

        if (requiredPermission === 'view' && viewIds.has(userId)) return next();
        if (requiredPermission === 'edit' && editIds.has(userId)) return next();
      }
    }
  } catch (err) {
    console.error('Error checking overtime admin page permission:', err);
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. Only authorized Admin or HR can manage company overtime requests.'
  });
};

// Admin / HR routes
router.get('/admin-requests', protect, checkOtAdminAccess('view'), overtimeController.getAdminOvertimeRequests);
router.put('/admin-action/:id', protect, checkOtAdminAccess('edit'), overtimeController.reviewOvertimeRequest);

module.exports = router;

