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

const ASSET_PERMISSION_PATHS = [
  '/ciisUser/company-assets',
  'company-assets',
  '/Ciis-network/company-assets',
  'Ciis-network/company-assets',
  'asset-management',
  '/ciisUser/asset-management',
  '/Ciis-network/asset-management'
];

const checkAssetPermission = async (user, action = 'view') => {
  if (!user) return { allowed: false, branchScope: null };
  if (isSuperAdminUser(user)) return { allowed: true, branchScope: null };

  const roles = [user.companyRole, user.jobRole, user.role]
    .filter(Boolean)
    .map(r => String(r).trim().toLowerCase().replace(/[\s_-]+/g, '_'));

  const isOwner = roles.some(r => ['owner', 'company_owner', 'companyowner', 'super_admin', 'superadmin'].includes(r));
  if (isOwner) return { allowed: true, branchScope: null };

  const isFallbackAdmin = roles.some(r => ['admin', 'company_admin', 'hr'].includes(r));

  const companyId = user.company?._id || user.company || user.companyId;
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return { allowed: false, branchScope: null };

  const page = await PagePermission.findOne({
    company: companyId,
    $or: [
      { path: { $in: ASSET_PERMISSION_PATHS } },
      { pageKey: { $in: ['company-assets', 'asset-management'] } }
    ]
  }).lean();

  const extractIds = (arr) => (arr || []).map(item => String(item?.user?._id || item?.user || '')).filter(Boolean);
  const extractScopedIds = (scopes, type) => (scopes || [])
    .filter(s => String(s?.accessType || '').trim().toLowerCase() === type)
    .map(s => String(s?.user?._id || s?.user || '')).filter(Boolean);

  if (!page) {
    return { allowed: isFallbackAdmin, branchScope: null };
  }

  const configuredUserIds = [
    ...extractIds(page.viewUsers),
    ...extractIds(page.editUsers),
    ...extractIds(page.deleteUsers),
    ...extractIds(page.approvers),
    ...(page.userAccessScopes || []).map(s => String(s?.user?._id || s?.user || '')).filter(Boolean)
  ];

  if (configuredUserIds.length === 0) {
    return { allowed: isFallbackAdmin, branchScope: null };
  }

  const userScopes = (page.userAccessScopes || []).filter(s => String(s?.user?._id || s?.user || '') === userId);
  let branchScope = null;
  if (userScopes.length > 0) {
    const matchingScope = userScopes.find(s => s.accessType === action) || userScopes.find(s => s.accessType === 'view') || userScopes[0];
    const bIds = (Array.isArray(matchingScope?.branchIds) ? matchingScope.branchIds : []).map(b => String(b).trim());
    if (bIds.length > 0 && !bIds.includes('all')) {
      branchScope = bIds;
    }
  }

  if (action === 'delete') {
    const deleteIds = new Set([
      ...extractIds(page.deleteUsers),
      ...extractScopedIds(page.userAccessScopes, 'delete')
    ]);
    return { allowed: deleteIds.has(userId), branchScope };
  }

  if (action === 'edit') {
    const editIds = new Set([
      ...extractIds(page.editUsers),
      ...extractScopedIds(page.userAccessScopes, 'edit')
    ]);
    return { allowed: editIds.has(userId), branchScope };
  }

  const viewIds = new Set([
    ...extractIds(page.viewUsers),
    ...extractIds(page.editUsers),
    ...extractIds(page.deleteUsers),
    ...extractIds(page.approvers),
    ...(page.userAccessScopes || []).map(s => String(s?.user?._id || s?.user || '')).filter(Boolean)
  ]);
  return { allowed: viewIds.has(userId), branchScope };
};

const requireAssetManager = (action = 'view') => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { allowed, branchScope } = await checkAssetPermission(req.user, action);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have permission to ${action === 'delete' ? 'delete' : action === 'edit' ? 'create or edit' : 'view'} company assets. Configure access in Page Management.`
      });
    }

    req.userBranchScope = branchScope;
    next();
  } catch (error) {
    console.error('requireAssetManager error:', error);
    return res.status(500).json({ success: false, message: 'Server error in asset authorization' });
  }
};

router.route('/')
  .get(requireAssetManager('view'), getCompanyAssets)
  .post(requireAssetManager('edit'), createCompanyAsset);

router.route('/:id')
  .delete(requireAssetManager('delete'), deleteCompanyAsset);

router.put('/:id/status', requireAssetManager('edit'), updateCompanyAssetStatus);

module.exports = router;
