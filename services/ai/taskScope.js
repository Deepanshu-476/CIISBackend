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

module.exports = {
  getScopeInfo,
  isAssigneeInScope,
};