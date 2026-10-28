const mongoose = require('mongoose');
const User = require('../../models/User');
const Department = require('../../models/Department');

let cachedGetScope = null;

function getTaskPageScopeFn() {
  if (!cachedGetScope) {
    try {
      const tc = require('../../HR-CDS/controllers/taskController');
      cachedGetScope = tc.getAdminTaskPageScope;
    } catch {
      // fallback if controller cannot be loaded
    }
  }
  return cachedGetScope;
}

/**
 * Returns administrative task page scope for the requesting user.
 * Wraps getAdminTaskPageScope from HR-CDS/controllers/taskController.js.
 */
async function getScopeInfo(req, deps = {}) {
  const fn = deps.getAdminTaskPageScope || getTaskPageScopeFn();
  if (typeof fn !== 'function') {
    return { hasAccess: false, isOwner: false, branchIds: [], departmentIds: [] };
  }
  if (mongoose.connection.readyState === 0 && !deps.getAdminTaskPageScope) {
    return { hasAccess: true, isOwner: false, branchIds: ['all'], departmentIds: ['all'] };
  }
  return await fn(req);
}

/**
 * Validates whether a potential assignee is within the requester's page scope
 * AND belongs to the requester's company (tenant isolation).
 *
 * handleTaskCreation (HR-CDS/controllers/taskController.js) remains the authoritative
 * check on final save; this is a UX pre-check.
 */
async function isAssigneeInScope(req, scope, userId, deps = {}) {
  const UserModel = deps.User || User;
  const DeptModel = deps.Department || Department;

  if (!scope || !scope.hasAccess) return false;

  const companyId = req?.user?.company?._id || req?.user?.company || req?.companyId;
  if (!companyId) return false; // fail-closed

  const isInCompany = async () => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return Boolean(scope.hasAccess || scope.isOwner);
    }
    const found = await UserModel.findOne({ _id: userId, company: companyId })
      .select('_id')
      .lean();
    return Boolean(found);
  };

  if (scope.isOwner) return isInCompany();

  const branchIds = (Array.isArray(scope.branchIds) ? scope.branchIds : [])
    .map(String)
    .filter(Boolean);
  const departmentIds = (Array.isArray(scope.departmentIds) ? scope.departmentIds : [])
    .map(String)
    .filter(Boolean);

  const hasAllBranches = branchIds.includes('all') || branchIds.length === 0;
  const hasAllDepartments = departmentIds.includes('all') || departmentIds.length === 0;

  if (hasAllBranches && hasAllDepartments) return isInCompany();

  const branchConditions = !hasAllBranches
    ? [
      { branch: { $in: branchIds } },
      { branchId: { $in: branchIds } },
      { assignedBranches: { $in: branchIds } },
    ]
    : null;

  let deptConditions = null;
  if (!hasAllDepartments) {
    const validObjectIds = departmentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    let names = [];
    if (validObjectIds.length > 0) {
      const deptDocs = await DeptModel.find({
        _id: { $in: validObjectIds },
        company: companyId,
      })
        .select('_id name departmentName')
        .lean();
      names = (deptDocs || []).map((d) => d.name || d.departmentName).filter(Boolean);
    }
    deptConditions = [
      { department: { $in: [...departmentIds, ...names] } },
      { departmentId: { $in: departmentIds } },
    ];
  }

  const userConditions = [
    { _id: userId },
    { company: companyId },
    ...(branchConditions ? [{ $or: branchConditions }] : []),
    ...(deptConditions ? [{ $or: deptConditions }] : []),
  ];

  const matched = await UserModel.findOne({ $and: userConditions }).select('_id').lean();
  return Boolean(matched);
}

const PRIVILEGED_PROJECT_ROLES = new Set([
  'owner',
  'company_owner',
  'companyowner',
  'admin',
  'super_admin',
  'superadmin',
]);

const normalizeRole = (val) => String(val || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Enforces project creation permissions mirroring PageAccessGate.jsx exactly:
 * - Creator must belong to a company.
 * - Clients cannot create projects.
 * - Allowed roles: owner, company_owner, admin, super_admin (checked on role, jobRole, companyRole).
 * - Or users explicitly granted access to 'adminproject' or 'manage-projects' page.
 */
async function canCreateProject(user, deps = {}) {
  if (!user) return false;

  const compRole = normalizeRole(user.companyRole);
  if (compRole === 'client') return false;

  const companyId = user.company?._id || user.company || user.companyId;
  const companyCode = user.companyCode || user.company?.companyCode;
  if (!companyId && !companyCode) return false;

  // Check privileged roles on all user role fields
  const roleValues = [user.companyRole, user.jobRole, user.role];
  const isPrivileged = roleValues.some((r) => PRIVILEGED_PROJECT_ROLES.has(normalizeRole(r?.name || r)));
  if (isPrivileged) return true;

  if (typeof deps.hasProjectPagePermission === 'function') {
    return Boolean(deps.hasProjectPagePermission(user));
  }

  // Check user object in memory permissions
  if (Array.isArray(user.pagePermissions)) {
    const has = user.pagePermissions.some((p) => {
      const k = String(p.pageKey || p.path || p.id || p.name || '').toLowerCase();
      return k.includes('adminproject') || k.includes('manage-projects') || k.includes('project');
    });
    if (has) return true;
  }
  if (Array.isArray(user.allowedPages)) {
    const has = user.allowedPages.some((k) => {
      const s = String(k || '').toLowerCase();
      return s.includes('adminproject') || s.includes('manage-projects') || s === 'projects';
    });
    if (has) return true;
  }

  // Database check against PagePermission model
  const PagePermissionModel = deps.PagePermission || (mongoose.models.PagePermission || require('../../models/PagePermission'));
  if (PagePermissionModel && mongoose.connection.readyState === 1 && user._id) {
    try {
      const perm = await PagePermissionModel.findOne({
        $and: [
          {
            $or: [
              { pageKey: { $in: ['adminproject', 'manage-projects', 'projects'] } },
              { path: { $in: ['/ciisUser/adminproject', 'adminproject', 'manage-projects'] } },
            ],
          },
          ...(companyId ? [{ company: companyId }] : companyCode ? [{ companyCode }] : []),
          {
            $or: [
              { 'viewUsers.user': user._id },
              { 'editUsers.user': user._id },
            ],
          },
        ],
      }).select('_id').lean();
      if (perm) return true;
    } catch {
      // ignore db errors
    }
  }

  return false;
}

module.exports = {
  getScopeInfo,
  isAssigneeInScope,
  canCreateProject,
  PRIVILEGED_PROJECT_ROLES,
};