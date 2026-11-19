const express = require('express');
const router = express.Router({ mergeParams: true });
const { protect } = require('../middleware/authMiddleware');
const companyAiController = require('../controllers/companyAiSettingsController');

// Access middleware: Platform SuperAdmin or Company Owner/Admin
const isOwnerOrAdmin = (user, targetCompanyId) => {
  if (!user) return false;
  const userCompanyId = String(user.company?._id || user.company || user.companyId || '');
  const roles = [user.companyRole, user.jobRole, user.role]
    .filter(Boolean)
    .map((r) => String(r).trim().toLowerCase().replace(/[\s_-]+/g, ''));

  // Platform SuperAdmin bypass
  if (roles.includes('superadmin') && user.email === 'ashutoshrai130@gmail.com') return true;
  if (roles.includes('superadmin') && !userCompanyId) return true;

  // Company owner / admin check
  const isMatch = targetCompanyId ? userCompanyId === String(targetCompanyId) : true;
  return isMatch && roles.some((r) => ['owner', 'admin', 'companyowner', 'companyadmin', 'superadmin'].includes(r));
};

const requireCompanyAdmin = (req, res, next) => {
  const targetCompanyId = req.params.companyId || req.params.id;
  if (isOwnerOrAdmin(req.user, targetCompanyId)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied. Only Platform SuperAdmin or Company Owner/Admin can manage company AI settings.',
  });
};

// Employee Self-Access Check (Available to any authenticated company employee)
router.get('/my-access', protect, companyAiController.getMyAiAccess);

router.use(protect, requireCompanyAdmin);

// Settings and Key Management
router.get('/', companyAiController.getCompanyAiSettings);
router.get('/history', companyAiController.getCompanyAiUsageHistory);
router.put('/key', companyAiController.updateCompanyAiKey);
router.post('/test-key', companyAiController.testCompanyGroqKey);

// Employee Token Quota Allocations
router.get('/employees', companyAiController.getEmployeeTokenAllocations);
router.put('/employees/bulk', companyAiController.bulkUpdateEmployeeTokenAllocations);
router.put('/employees/:userId', companyAiController.updateEmployeeTokenAllocation);

module.exports = router;
