const express = require('express');
const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');
const PageDataVisibility = require('../models/PageDataVisibility');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Department = require('../models/Department');
const { protect, isCompanyOwner } = require('../middleware/authMiddleware');
const { notifyDirectUsers } = require('../HR-CDS/utils/systemNotificationService');
const { getCacheKey, getOrSetCached, invalidateCache } = require('../utils/inMemoryCache');

const router = express.Router();

const APP_PAGES = [
  { pageKey: 'emp-details', name: 'Employee Details', path: '/ciisUser/emp-details', permissionPattern: 'viewEdit' },
  { pageKey: 'emp-leaves', name: 'Employee Leaves', path: '/ciisUser/emp-leaves', permissionPattern: 'approveReject' },
  { pageKey: 'leave-policy', name: 'Leave Policy', path: '/ciisUser/leave-policy', permissionPattern: 'viewEdit' },
  { pageKey: 'emp-assets', name: 'Employee Assets', path: '/ciisUser/emp-assets', permissionPattern: 'approveReject' },
  { pageKey: 'emp-attendance', name: 'Employee Attendance', path: '/ciisUser/emp-attendance', permissionPattern: 'viewEdit' },
  { pageKey: 'department', name: 'Department Management', path: '/ciisUser/department', permissionPattern: 'viewEdit' },
  { pageKey: 'JobRoleManagement', name: 'Job Role Management', path: '/ciisUser/JobRoleManagement', permissionPattern: 'viewEdit' },
  { pageKey: 'manage-groups', name: 'Manage Groups', path: '/ciisUser/manage-groups', permissionPattern: 'viewEdit' },
  { pageKey: 'company-all-task', name: 'Company All Task', path: '/ciisUser/company-all-task', permissionPattern: 'viewEdit' }
];

const PAGE_PERMISSION_CACHE_PREFIX = 'pagePermissions';
const PAGE_PERMISSION_TTL_MS = Number(process.env.PAGE_PERMISSION_CACHE_TTL_MS || 5 * 60 * 1000);

const normalizePath = (path = '') => {
  const clean = String(path || '').trim();
  if (!clean) return '';
  return clean.startsWith('/') ? clean : `/ciisUser/${clean.replace(/^ciisUser\//, '')}`;
};

const getCompanyId = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;

const normalizeSubjectKey = (value) => String(value || '').trim().toLowerCase();

const normalizeRuleIds = (items = []) => {
  const ids = [...new Set(items.map(item => String(item)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
  return ids;
};

const normalizePageUsers = (items = []) => {
  const uniqueIds = [...new Set(items.map(item => String(item)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
  return uniqueIds.map(id => ({ user: id }));
};

const normalizeUserAccessScopes = (items = []) => {
  if (!Array.isArray(items)) return [];

  return items
    .map(item => {
      const userId = String(item?.user || item?.userId || '').trim();
      const accessType = String(item?.accessType || '').trim().toLowerCase();
      const branchIds = Array.isArray(item?.branchIds)
        ? [...new Set(item.branchIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))]
        : [];
      const departmentIds = Array.isArray(item?.departmentIds)
        ? [...new Set(item.departmentIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))]
        : [];

      if (!mongoose.Types.ObjectId.isValid(userId)) return null;
      if (!['view', 'edit', 'delete', 'approve'].includes(accessType)) return null;

      return {
        user: userId,
        accessType,
        branchIds,
        departmentIds
      };
    })
    .filter(Boolean);
};

const getPageUsers = (config, key) => (config?.[key] || []).map(item => item.user).filter(Boolean);

const getPageUserAccessScopes = (config) => (config?.userAccessScopes || []).map(item => ({
  user: item.user,
  accessType: item.accessType,
  branchIds: item.branchIds || [],
  departmentIds: item.departmentIds || [],
  addedAt: item.addedAt || null
}));

const uniqueUsers = (users = []) => {
  const seen = new Set();
  return users.filter(user => {
    const id = String(user?._id || user?.id || user || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const getEffectiveViewUsers = (config) => uniqueUsers([
  ...getPageUsers(config, 'viewUsers'),
  ...getPageUsers(config, 'editUsers'),
  ...getPageUsers(config, 'approvers'),
  ...getPageUsers(config, 'deleteUsers')
]);

const decoratePages = async (companyId) => {
  const configs = await PagePermission.find({ company: companyId })
    .select('company companyCode pageKey name path approvers viewUsers editUsers deleteUsers userAccessScopes updatedAt')
    .populate('approvers.user', 'name email jobRole companyRole department')
    .populate('viewUsers.user', 'name email jobRole companyRole department')
    .populate('editUsers.user', 'name email jobRole companyRole department')
    .populate('deleteUsers.user', 'name email jobRole companyRole department')
    .populate('userAccessScopes.user', 'name email jobRole companyRole department')
    .lean();
  const configMap = new Map(configs.map(config => [config.path, config]));

  return APP_PAGES.map(page => {
    const config = configMap.get(page.path);
    return {
      ...page,
      permissionPattern: page.permissionPattern || null,
      approvers: getPageUsers(config, 'approvers'),
      viewUsers: getPageUsers(config, 'viewUsers'),
      editUsers: getPageUsers(config, 'editUsers'),
      deleteUsers: getPageUsers(config, 'deleteUsers'),
      userAccessScopes: getPageUserAccessScopes(config),
      updatedAt: config?.updatedAt || null
    };
  });
};

const getDecoratedPagesCached = (companyId) => getOrSetCached(
  getCacheKey(PAGE_PERMISSION_CACHE_PREFIX, { scope: 'pages', companyId }),
  () => decoratePages(companyId),
  PAGE_PERMISSION_TTL_MS
);

const getVisibilityContextCached = (companyId) => getOrSetCached(
  getCacheKey(PAGE_PERMISSION_CACHE_PREFIX, { scope: 'visibility-context', companyId }),
  () => loadVisibilityContext(companyId),
  PAGE_PERMISSION_TTL_MS
);

const getEffectiveVisibilityCached = (companyId, userId) => getOrSetCached(
  getCacheKey(PAGE_PERMISSION_CACHE_PREFIX, { scope: 'effective', companyId, userId }),
  () => resolveVisibilityForUser(companyId, userId),
  PAGE_PERMISSION_TTL_MS
);

const getPageByPathCached = (companyId, path) => getOrSetCached(
  getCacheKey(PAGE_PERMISSION_CACHE_PREFIX, { scope: 'by-path', companyId, path }),
  async () => {
    const config = await PagePermission.findOne({ company: companyId, path })
      .populate('approvers.user', 'name email jobRole companyRole department')
      .populate('viewUsers.user', 'name email jobRole companyRole department')
      .populate('editUsers.user', 'name email jobRole companyRole department')
      .populate('deleteUsers.user', 'name email jobRole companyRole department')
      .populate('userAccessScopes.user', 'name email jobRole companyRole department')
      .lean();

    return config ? {
      pageKey: config.pageKey,
      name: config.name,
      path: config.path,
      permissionPattern: APP_PAGES.find(item => item.path === config.path)?.permissionPattern || null,
      approvers: getPageUsers(config, 'approvers'),
      viewUsers: getEffectiveViewUsers(config),
      editUsers: getPageUsers(config, 'editUsers'),
      deleteUsers: getPageUsers(config, 'deleteUsers'),
      userAccessScopes: getPageUserAccessScopes(config)
    } : {
      path,
      permissionPattern: APP_PAGES.find(item => item.path === path)?.permissionPattern || null,
      approvers: [],
      viewUsers: [],
      editUsers: [],
      deleteUsers: [],
      userAccessScopes: []
    };
  },
  PAGE_PERMISSION_TTL_MS
);

const normalizeVisibilityRule = (rule = {}) => {
  const subjectType = String(rule.subjectType || '').trim().toLowerCase();
  const subjectKey = normalizeSubjectKey(rule.subjectKey);
  const subjectLabel = String(rule.subjectLabel || rule.label || rule.subjectKey || '').trim();
  const scope = ['all', 'branches', 'departments', 'custom'].includes(String(rule.scope || '').trim().toLowerCase())
    ? String(rule.scope || '').trim().toLowerCase()
    : 'custom';

  return {
    subjectType,
    subjectKey,
    subjectLabel,
    scope,
    branchIds: normalizeRuleIds(rule.branchIds || []),
    departmentIds: normalizeRuleIds(rule.departmentIds || [])
  };
};

const buildVisibilityRuleResponse = (rule, branchMap, departmentMap) => {
  if (!rule) return null;
  const branchIds = (rule.branchIds || []).map(item => String(item)).filter(Boolean);
  const departmentIds = (rule.departmentIds || []).map(item => String(item)).filter(Boolean);

  return {
    id: String(rule._id),
    subjectType: rule.subjectType,
    subjectKey: rule.subjectKey,
    subjectLabel: rule.subjectLabel,
    scope: rule.scope,
    branchIds,
    departmentIds,
    branches: branchIds.map(id => branchMap.get(id)).filter(Boolean),
    departments: departmentIds.map(id => departmentMap.get(id)).filter(Boolean),
    updatedAt: rule.updatedAt || null,
    updatedBy: rule.updatedBy || null
  };
};

const loadVisibilityContext = async (companyId) => {
  const [users, branches, departments, rules] = await Promise.all([
    User.find({ company: companyId })
      .select('_id name email jobRole companyRole branch department assignedBranches isActive')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .sort({ name: 1 })
      .lean(),
    Branch.find({ company: companyId })
      .select('_id name branchCode isDefault isActive')
      .sort({ isDefault: -1, name: 1 })
      .lean(),
    Department.find({ company: companyId })
      .select('_id name branch branchCode isActive')
      .populate('branch', 'name branchCode')
      .sort({ name: 1 })
      .lean(),
    PageDataVisibility.find({ company: companyId })
      .select('_id company companyCode subjectType subjectKey subjectLabel scope branchIds departmentIds updatedBy updatedAt')
      .populate('updatedBy', 'name email')
      .lean()
  ]);

  const roleMap = new Map();
  users.forEach(user => {
    [user.jobRole, user.companyRole].filter(Boolean).forEach(role => {
      const key = normalizeSubjectKey(role);
      if (!key) return;
      if (!roleMap.has(key)) {
        roleMap.set(key, { key, label: String(role).trim() });
      }
    });
  });

  const branchMap = new Map(branches.map(branch => [String(branch._id), branch]));
  const departmentMap = new Map(departments.map(department => [String(department._id), department]));
  const roleRules = rules.filter(rule => rule.subjectType === 'role');
  const userRules = rules.filter(rule => rule.subjectType === 'user');

  return {
    users,
    branches,
    departments,
    roleOptions: [...roleMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    roleRules: roleRules.map(rule => buildVisibilityRuleResponse(rule, branchMap, departmentMap)),
    userRules: userRules.map(rule => buildVisibilityRuleResponse(rule, branchMap, departmentMap))
  };
};

const resolveVisibilityForUser = async (companyId, userId) => {
  const user = await User.findOne({ _id: userId, company: companyId })
    .select('_id name email jobRole companyRole')
    .lean();

  if (!user) {
    return null;
  }

  const context = await loadVisibilityContext(companyId);
  const userKey = normalizeSubjectKey(user._id);
  const roleKey = normalizeSubjectKey(user.jobRole || user.companyRole || '');

  const overrideRule = context.userRules.find(rule => normalizeSubjectKey(rule.subjectKey) === userKey) || null;
  const roleRule = context.roleRules.find(rule => normalizeSubjectKey(rule.subjectKey) === roleKey) || null;
  const effectiveRule = overrideRule || roleRule || null;

  return {
    user,
    effectiveRule,
    source: overrideRule ? 'user-override' : roleRule ? 'role-default' : 'none'
  };
};

router.use(protect);

router.get('/pages', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Company not found for current user' });
    }

    const pages = await getDecoratedPagesCached(companyId);
    res.json({ success: true, pages });
  } catch (error) {
    console.error('Page permissions list error:', error);
    res.status(500).json({ success: false, error: 'Failed to load page permissions' });
  }
});

router.get('/data-visibility/context', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Company not found for current user' });
    }

    const context = await getVisibilityContextCached(companyId);
    res.json({ success: true, context });
  } catch (error) {
    console.error('Data visibility context error:', error);
    res.status(500).json({ success: false, error: 'Failed to load data visibility context' });
  }
});

router.get('/data-visibility', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Company not found for current user' });
    }

    const context = await getVisibilityContextCached(companyId);
    res.json({ success: true, ...context });
  } catch (error) {
    console.error('Data visibility list error:', error);
    res.status(500).json({ success: false, error: 'Failed to load data visibility rules' });
  }
});

router.get('/data-visibility/effective', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Company not found for current user' });
    }

    const userId = req.query.userId || req.user?._id;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const result = await getEffectiveVisibilityCached(companyId, userId);
    if (!result) {
      return res.status(404).json({ success: false, error: 'User not found for this company' });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Data visibility effective resolve error:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve data visibility' });
  }
});

router.get('/by-path', async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const path = normalizePath(req.query.path);
    if (!companyId || !path) {
      return res.status(400).json({ success: false, error: 'Company and path are required' });
    }

    const page = await getPageByPathCached(companyId, path);
    res.json({ success: true, page });
  } catch (error) {
    console.error('Page permission by path error:', error);
    res.status(500).json({ success: false, error: 'Failed to load page permission' });
  }
});

router.put('/data-visibility', isCompanyOwner, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Company not found for current user' });
    }

    const rawRoleRules = Array.isArray(req.body.roleRules) ? req.body.roleRules : [];
    const rawUserRules = Array.isArray(req.body.userRules) ? req.body.userRules : [];

    const normalizedRoleRules = rawRoleRules
      .map(normalizeVisibilityRule)
      .filter(rule => rule.subjectType === 'role' && rule.subjectKey);
    const normalizedUserRules = rawUserRules
      .map(normalizeVisibilityRule)
      .filter(rule => rule.subjectType === 'user' && rule.subjectKey);

    const userIds = normalizedUserRules.map(rule => rule.subjectKey);
    const validUsers = userIds.length
      ? await User.find({
          _id: { $in: userIds },
          company: companyId
        }).select('_id')
      : [];

    const validUserIdSet = new Set(validUsers.map(user => String(user._id)));
    const validRoleRules = normalizedRoleRules.filter(rule => rule.subjectKey);
    const validUserRules = normalizedUserRules.filter(rule => validUserIdSet.has(rule.subjectKey));

    const upsertRule = async (rule) => PageDataVisibility.findOneAndUpdate(
      {
        company: companyId,
        subjectType: rule.subjectType,
        subjectKey: rule.subjectKey
      },
      {
        company: companyId,
        companyCode: req.user.companyCode || '',
        subjectType: rule.subjectType,
        subjectKey: rule.subjectKey,
        subjectLabel: rule.subjectLabel,
        scope: rule.scope,
        branchIds: rule.scope === 'all' ? [] : rule.branchIds,
        departmentIds: rule.scope === 'all' ? [] : rule.departmentIds,
        updatedBy: req.user._id
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const savedRules = await Promise.all([
      ...validRoleRules.map(upsertRule),
      ...validUserRules.map(upsertRule)
    ]);

    const desiredRoleKeys = validRoleRules.map(rule => rule.subjectKey);
    const desiredUserKeys = validUserRules.map(rule => rule.subjectKey);

    await Promise.all([
      PageDataVisibility.deleteMany({
        company: companyId,
        subjectType: 'role',
        subjectKey: { $nin: desiredRoleKeys }
      }),
      PageDataVisibility.deleteMany({
        company: companyId,
        subjectType: 'user',
        subjectKey: { $nin: desiredUserKeys }
      })
    ]);

    const context = await loadVisibilityContext(companyId);

    res.json({
      success: true,
      message: 'Data visibility rules saved successfully',
      savedRules: savedRules.length,
      ...context
    });
    invalidateCache(PAGE_PERMISSION_CACHE_PREFIX);
  } catch (error) {
    console.error('Data visibility save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save data visibility rules' });
  }
});

router.put('/:pageKey', isCompanyOwner, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const page = APP_PAGES.find(item => item.pageKey === req.params.pageKey);
    if (!companyId || !page) {
      return res.status(404).json({ success: false, error: 'Page not found' });
    }

    const approverIds = Array.isArray(req.body.approverIds) ? req.body.approverIds : [];
    const viewUserIds = Array.isArray(req.body.viewUserIds) ? req.body.viewUserIds : [];
    const editUserIds = Array.isArray(req.body.editUserIds) ? req.body.editUserIds : [];
    const deleteUserIds = Array.isArray(req.body.deleteUserIds) ? req.body.deleteUserIds : [];
    const userAccessScopes = normalizeUserAccessScopes(req.body.userAccessScopes);
    const uniqueApproverIds = [...new Set(approverIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueViewUserIds = [...new Set(viewUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueEditUserIds = [...new Set(editUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const uniqueDeleteUserIds = [...new Set(deleteUserIds.map(id => String(id)).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const allUserIds = [...new Set([...uniqueApproverIds, ...uniqueViewUserIds, ...uniqueEditUserIds, ...uniqueDeleteUserIds])];

    const validUsers = await User.find({
      _id: { $in: allUserIds },
      $or: [
        { company: companyId },
        { companyId }
      ]
    }).select('_id');

    const validIdSet = new Set(validUsers.map(user => user._id.toString()));
    const approvers = normalizePageUsers(uniqueApproverIds.filter(id => validIdSet.has(id)));
    const viewUsers = normalizePageUsers(uniqueViewUserIds.filter(id => validIdSet.has(id)));
    const editUsers = normalizePageUsers(uniqueEditUserIds.filter(id => validIdSet.has(id)));
    const deleteUsers = normalizePageUsers(uniqueDeleteUserIds.filter(id => validIdSet.has(id)));
    const validUserAccessScopes = userAccessScopes.filter(item => validIdSet.has(String(item.user)));

    const config = await PagePermission.findOneAndUpdate(
      { company: companyId, path: page.path },
      {
        company: companyId,
        companyCode: req.user.companyCode || '',
        pageKey: page.pageKey,
        name: page.name,
        path: page.path,
        approvers,
        viewUsers,
        editUsers,
        deleteUsers,
        userAccessScopes: validUserAccessScopes
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
      .populate('approvers.user', 'name email jobRole companyRole department')
      .populate('viewUsers.user', 'name email jobRole companyRole department')
      .populate('editUsers.user', 'name email jobRole companyRole department')
      .populate('deleteUsers.user', 'name email jobRole companyRole department')
      .populate('userAccessScopes.user', 'name email jobRole companyRole department');

    await notifyDirectUsers({
      userIds: [req.user._id],
      targetPath: page.path,
      targetScreen: page.name,
      type: 'page_updated',
      title: `${page.name} updated`,
      message: `Your update to ${page.name} has been saved successfully.`,
      actor: req.user._id,
      company: companyId,
      data: {
        pageKey: page.pageKey,
        pageName: page.name,
        path: page.path,
        notificationReason: 'page_updated',
      },
      priority: 'medium',
      push: true
    });

    res.json({
      success: true,
      message: 'Page permissions updated successfully',
      page: {
        pageKey: config.pageKey,
        name: config.name,
        path: config.path,
        permissionPattern: page.permissionPattern || null,
        approvers: getPageUsers(config, 'approvers'),
        viewUsers: getPageUsers(config, 'viewUsers'),
        editUsers: getPageUsers(config, 'editUsers'),
        deleteUsers: getPageUsers(config, 'deleteUsers'),
        userAccessScopes: getPageUserAccessScopes(config)
      }
    });
    invalidateCache(PAGE_PERMISSION_CACHE_PREFIX);
  } catch (error) {
    console.error('Page permissions save error:', error);
    res.status(500).json({ success: false, error: 'Failed to save page approvers' });
  }
});

module.exports = router;
