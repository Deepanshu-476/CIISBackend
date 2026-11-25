const express = require('express');
const router = express.Router({ mergeParams: true });
const Company = require('../models/Company');
const { requirePageAccess, hasPageAccess, blockClientLogins } = require('../middleware/pageAccess');
const { protect } = require('../middleware/authMiddleware');
const companyAiController = require('../controllers/companyAiSettingsController');

const page = { paths: ['/ciisUser/company-ai-settings'], label: 'Company AI & Tokens' };
const companyIdOf = user => String(user.company?._id || user.company?.id || user.company || user.companyId || '');
const managementRoles = new Set(['owner', 'admin', 'companyowner', 'companyadmin', 'superadmin', 'platformowner']);

function requireManagementRole(req, res, next) {
  if (req.user?.isSuperAdmin) return next();
  const roles = [req.user.companyRole, req.user.role, req.user.jobRole, req.user.jobRoleName];
  if (roles.some(role => managementRoles.has(String(role?.name || role || '').toLowerCase().replace(/[\s_-]+/g, '')))) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Only company administrators can manage AI settings.' });
}

function requireSameCompany(req, res, next) {
  const userCompanyId = companyIdOf(req.user);
  const targetCompanyId = req.params.companyId || req.params.id || userCompanyId;
  if (userCompanyId && userCompanyId === String(targetCompanyId)) return next();
  return res.status(403).json({ success: false, message: 'Only your own company can be accessed.' });
}

async function requireCompanyAiPage(req, res, next) {
  try {
    const targetCompanyId = req.params.companyId || req.params.id || companyIdOf(req.user);
    const company = targetCompanyId
      ? await Company.findById(targetCompanyId).select('allowedPages').lean()
      : null;
    const enabled = company?.allowedPages?.some(value =>
      ['company-ai-settings', 'company-ai'].includes(String(value).trim().toLowerCase()
        .replace(/^\/+/, '').replace(/^ciisuser\//, '').replace(/\/+$/, '')));
    if (enabled) return next();
    return res.status(403).json({ success: false, message: 'Company AI & Tokens is not enabled for your company.' });
  } catch (error) {
    return next(error);
  }
}

// Employee Self-Access Check (Available to any authenticated company employee)
router.get('/my-access', protect, requireSameCompany, companyAiController.getMyAiAccess);

router.use(protect, blockClientLogins, requireSameCompany, requireManagementRole, requireCompanyAiPage,
  requirePageAccess({ ...page, action: 'view' }));
const edit = requirePageAccess({ ...page, action: 'edit' });

router.get('/access', async (req, res) => res.json({ success: true, canEdit: await hasPageAccess(req.user, { ...page, action: 'edit' }) }));

// Settings and Key Management
router.get('/', companyAiController.getCompanyAiSettings);
router.get('/history', companyAiController.getCompanyAiUsageHistory);
router.put('/key', edit, companyAiController.updateCompanyAiKey);
router.post('/test-key', edit, companyAiController.testCompanyGroqKey);

// Employee Token Quota Allocations
router.get('/employees', companyAiController.getEmployeeTokenAllocations);
router.put('/employees/bulk', edit, companyAiController.bulkUpdateEmployeeTokenAllocations);
router.put('/employees/:userId', edit, companyAiController.updateEmployeeTokenAllocation);

module.exports = router;
