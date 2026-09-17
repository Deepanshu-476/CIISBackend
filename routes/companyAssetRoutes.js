const express = require('express');
const router = express.Router();
const { protect, isSuperAdminUser } = require('../middleware/authMiddleware');
const PagePermission = require('../models/PagePermission');
const {
  getCompanyAssets,
  createCompanyAsset,
  updateCompanyAssetStatus,
  deleteCompanyAsset
} = require('../controllers/companyAssetController');

router.use(protect);

const isCompanyAdminOrOwner = (user) => {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  const roles = [user.companyRole, user.jobRole, user.role]
    .filter(Boolean)
    .map(r => String(r).trim().toLowerCase().replace(/[\s_-]+/g, '_'));
  return roles.some(r => ['owner', 'company_owner', 'companyowner', 'admin', 'company_admin'].includes(r));
};

const checkAssetPermission = async (user, action = 'edit') => {
  if (!user) return false;
  if (isCompanyAdminOrOwner(user)) return true;

  const companyId = user.company?._id || user.company || user.companyId;
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return false;

  const assetPaths = [
    '/ciisUser/company-assets',
    'company-assets',
    '/Ciis-network/company-assets',
    'Ciis-network/company-assets'
  ];

  const page = await PagePermission.findOne({
    company: companyId,
    path: { $in: assetPaths }
  }).lean();

  if (!page) return false;

  const extractIds = (arr) => (arr || []).map(item => String(item?.user?._id || item?.user || '')).filter(Boolean);

  if (action === 'delete') {
    const deleteIds = extractIds(page.deleteUsers);
    return deleteIds.includes(userId);
  }

  const editIds = new Set([
    ...extractIds(page.editUsers),
    ...extractIds(page.deleteUsers)
  ]);
  return editIds.has(userId);
};

const requireAssetManager = (action = 'edit') => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const hasAccess = await checkAssetPermission(req.user, action);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have permission to ${action === 'delete' ? 'delete' : 'manage'} company assets.`
      });
    }

    next();
  } catch (error) {
    console.error('requireAssetManager error:', error);
    return res.status(500).json({ success: false, message: 'Server error in asset authorization' });
  }
};

router.route('/')
  .get(getCompanyAssets)
  .post(requireAssetManager('edit'), createCompanyAsset);

router.route('/:id')
  .delete(requireAssetManager('delete'), deleteCompanyAsset);

router.put('/:id/status', requireAssetManager('edit'), updateCompanyAssetStatus);

module.exports = router;
