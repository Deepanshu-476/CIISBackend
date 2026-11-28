const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');
const SidebarConfig = require('../models/SidebarConfig');

const normalizePermissionPath = value => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('/ciis-network/')) return `/ciisuser/${raw.slice('/ciis-network/'.length)}`;
  if (raw.startsWith('/ciisuser/')) return raw;
  return raw.startsWith('/') ? raw : `/ciisuser/${raw}`;
};

const AUTO_FULL_ACCESS_PAGE_KEYS = new Set([
  'register-request',
  'company-all-task-tasks',
  'user-dashboard',
  'attendance',
  'my-leaves',
  'my-assets',
  'profile',
  'change-password',
  'create-user',
  'alert',
  'chat',
]);

const AUTO_FULL_ACCESS_PATHS = new Set([
  '/ciisuser/register-request',
  '/ciisuser/company-all-task/tasks',
  '/ciisuser/user-dashboard',
  '/ciisuser/attendance',
  '/ciisuser/my-leaves',
  '/ciisuser/my-assets',
  '/ciisuser/profile',
  '/ciisuser/change-password',
  '/ciisuser/create-user',
  '/ciisuser/alert',
  '/ciisuser/chat',
]);

// Core employee self-service pages available to all active company employees by default when entitled.
const DEFAULT_OPEN_AUTO_FULL_PATHS = new Set([
  '/ciisuser/user-dashboard',
  '/ciisuser/attendance',
  '/ciisuser/my-leaves',
  '/ciisuser/my-assets',
  '/ciisuser/profile',
  '/ciisuser/change-password',
  '/ciisuser/alert',
  '/ciisuser/chat',
]);

const PATH_TO_KEY = {
  '/ciisuser/register-request': 'register-request',
  '/ciisuser/company-all-task/tasks': 'company-all-task-tasks',
  '/ciisuser/user-dashboard': 'user-dashboard',
  '/ciisuser/attendance': 'attendance',
  '/ciisuser/my-leaves': 'my-leaves',
  '/ciisuser/my-assets': 'my-assets',
  '/ciisuser/profile': 'profile',
  '/ciisuser/change-password': 'change-password',
  '/ciisuser/create-user': 'create-user',
  '/ciisuser/alert': 'alert',
  '/ciisuser/chat': 'chat',
};

const isAutoFullAccessPage = ({ pageKey, path } = {}) => {
  const key = String(pageKey || '').trim().toLowerCase();
  if (key && AUTO_FULL_ACCESS_PAGE_KEYS.has(key)) return true;
  const normalizedPath = normalizePermissionPath(path);
  return Boolean(normalizedPath && AUTO_FULL_ACCESS_PATHS.has(normalizedPath));
};

const ACTION_FIELDS = [
  'viewUsers',
  'editUsers',
  'deleteUsers',
  'approvers',
  'generators',
  'lockUsers',
  'unlockUsers',
];

const hasAnyPagePermissionGrant = (pageDoc, userId) => {
  if (!pageDoc || !userId) return false;
  const targetId = String(userId).trim();
  if (!targetId) return false;

  const hasListGrant = ACTION_FIELDS.some(field =>
    Array.isArray(pageDoc[field]) &&
    pageDoc[field].some(entry => String(entry?.user?._id || entry?.user || entry || '').trim() === targetId)
  );
  if (hasListGrant) return true;

  return Array.isArray(pageDoc.userAccessScopes) && pageDoc.userAccessScopes.some(scope =>
    String(scope?.user?._id || scope?.user || '').trim() === targetId
  );
};

const expandAutoFullAccessPageDoc = pageDoc => {
  if (!pageDoc) return pageDoc;
  if (!isAutoFullAccessPage(pageDoc)) return pageDoc;

  const userEntriesById = new Map();
  for (const field of ACTION_FIELDS) {
    for (const entry of pageDoc[field] || []) {
      const uid = String(entry?.user?._id || entry?.user || entry || '').trim();
      if (uid && !userEntriesById.has(uid)) {
        userEntriesById.set(uid, typeof entry === 'object' && entry?.user ? entry : { user: uid });
      }
    }
  }
  for (const scope of pageDoc.userAccessScopes || []) {
    const uid = String(scope?.user?._id || scope?.user || '').trim();
    if (uid && !userEntriesById.has(uid)) {
      userEntriesById.set(uid, { user: uid });
    }
  }

  const allEntries = [...userEntriesById.values()];
  if (!allEntries.length) return pageDoc;

  return {
    ...pageDoc,
    viewUsers: allEntries,
    editUsers: allEntries,
    deleteUsers: allEntries,
    approvers: allEntries,
    generators: allEntries,
    lockUsers: allEntries,
    unlockUsers: allEntries,
  };
};

const getUserIdStr = user => String(user?._id || user?.id || '').trim();
const getCompanyIdStr = user => String(user?.company?._id || user?.company?.id || user?.company || user?.companyId || '').trim();
const getDepartmentIdStr = user => String(user?.department?._id || user?.department || '').trim();
const getBranchIdStr = user => String(user?.branch?._id || user?.branch || '').trim();

const resolveUserSidebarConfig = async user => {
  const companyId = getCompanyIdStr(user);
  const departmentId = getDepartmentIdStr(user);
  const branchId = getBranchIdStr(user) || null;
  if (!companyId || !departmentId) return null;

  const isDbConnected = mongoose.connection?.readyState === 1;
  const isMocked = Boolean(SidebarConfig.findOne?.mock);
  if (!isMocked && !isDbConnected) return null;

  const candidateRoles = [...new Set(
    [user?.jobRole?.name, user?.jobRole, user?.companyRole, user?.role]
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];
  if (!candidateRoles.length) return null;

  if (!isDbConnected && isMocked) {
    const JobRole = require('../models/JobRole');
    if (!JobRole.find?.mock) {
      try {
        const res = SidebarConfig.findOne({ companyId, branchId, departmentId, role: candidateRoles[0] });
        return typeof res?.lean === 'function' ? await res.lean() : await res;
      } catch {
        return null;
      }
    }
  }

  // Lazy-require to avoid circular dependency with routes/sidebarConfigs.
  const { findSidebarConfig } = require('../routes/sidebarConfigs');
  if (typeof findSidebarConfig !== 'function') return null;

  for (const role of candidateRoles) {
    try {
      const config = await findSidebarConfig({ companyId, branchId, departmentId, role });
      if (config) return config;
    } catch {
      return null;
    }
  }
  return null;
};

const sidebarConfigHasPage = (sidebarConfig, targetPath) => {
  if (!sidebarConfig || !Array.isArray(sidebarConfig.menuItems)) return false;
  const normalizedTarget = normalizePermissionPath(targetPath);
  const targetKey = PATH_TO_KEY[normalizedTarget] || normalizedTarget.replace(/^\/ciisuser\//, '');

  return sidebarConfig.menuItems.some(item => {
    const itemPath = normalizePermissionPath(item?.path || item?.route || '');
    const itemId = String(item?.id || '').trim().toLowerCase();
    return (
      (itemPath && itemPath === normalizedTarget) ||
      (itemId && (itemId === targetKey || normalizePermissionPath(itemId) === normalizedTarget))
    );
  });
};

const userHasAutoFullAccessPage = async ({
  user,
  targetPath,
  pageDoc = null,
  sidebarConfig,
  fetchPageDocIfMissing = true,
  isOwnerOrAdmin = false,
}) => {
  const normalizedTarget = normalizePermissionPath(targetPath);
  if (!isAutoFullAccessPage({ path: normalizedTarget })) return false;
  if (isOwnerOrAdmin) return true;

  const userId = getUserIdStr(user);
  const companyId = getCompanyIdStr(user);
  if (!userId || !companyId) return false;

  let resolvedPageDoc = pageDoc;
  if (!resolvedPageDoc && fetchPageDocIfMissing && (Boolean(PagePermission.findOne?.mock) || mongoose.connection?.readyState === 1)) {
    const canonicalPaths = normalizedTarget === '/ciisuser/company-all-task/tasks'
      ? ['/ciisUser/company-all-task/tasks', 'company-all-task-tasks']
      : [normalizedTarget, targetPath].filter(Boolean);
    try {
      resolvedPageDoc = await PagePermission.findOne({
        company: companyId,
        $or: [
          { path: { $in: canonicalPaths } },
          ...(PATH_TO_KEY[normalizedTarget] ? [{ pageKey: PATH_TO_KEY[normalizedTarget] }] : []),
        ],
      }).lean();
    } catch {
      resolvedPageDoc = null;
    }
  }

  if (hasAnyPagePermissionGrant(resolvedPageDoc, userId)) return true;

  const resolvedSidebar = sidebarConfig === undefined ? await resolveUserSidebarConfig(user) : sidebarConfig;
  if (resolvedSidebar && sidebarConfigHasPage(resolvedSidebar, normalizedTarget)) return true;

  if (DEFAULT_OPEN_AUTO_FULL_PATHS.has(normalizedTarget)) {
    return true;
  }

  return false;
};

module.exports = {
  AUTO_FULL_ACCESS_PAGE_KEYS,
  AUTO_FULL_ACCESS_PATHS,
  DEFAULT_OPEN_AUTO_FULL_PATHS,
  normalizePermissionPath,
  isAutoFullAccessPage,
  hasAnyPagePermissionGrant,
  expandAutoFullAccessPageDoc,
  resolveUserSidebarConfig,
  sidebarConfigHasPage,
  userHasAutoFullAccessPage,
};
