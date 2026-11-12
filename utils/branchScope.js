const mongoose = require('mongoose');

// Branch rule for pages that list many people's data (leaves, assets, payroll, ...):
// - owner / company admin / super admin see every branch of their company;
// - everyone else sees only the people of the branches assigned to them
//   (user.branch + user.assignedBranches). Someone with no branch sees only themself.
// Same rule as Company All Task and Employee Details (allTaskController / userControllers).

const COMPANY_WIDE_ROLES = ['owner', 'company_owner', 'companyowner', 'admin', 'super_admin', 'superadmin', 'career_infowis_admin'];
const norm = value => String((value && typeof value === 'object' ? value.name : value) || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const idOf = value => String((value && typeof value === 'object' ? value._id || value.id : value) || '').trim();

const canSeeAllBranches = (user = {}) => user.isCompanyOwner === true || user.isSuperAdmin === true || user.superAdmin === true ||
  [user.companyRole, user.role, user.jobRole, user.jobRoleName].map(norm).some(role => COMPANY_WIDE_ROLES.includes(role));

const viewerBranchIds = (user = {}) => [...new Set([
  idOf(user.branch), idOf(user.branchId), ...(Array.isArray(user.assignedBranches) ? user.assignedBranches : []).map(idOf),
].filter(id => mongoose.isValidObjectId(id)))];

// Returns null when the viewer may see every branch; otherwise the branch ids they may see.
const allowedBranchIds = (user = {}) => (canSeeAllBranches(user) ? null : viewerBranchIds(user));

// Mongo condition on User documents for the branches this viewer may see (or {} for all).
// `requestedBranch` narrows it further; a branch outside the viewer's list matches nobody.
const userBranchCondition = (user = {}, requestedBranch = '') => {
  const allowed = allowedBranchIds(user);
  const requested = mongoose.isValidObjectId(String(requestedBranch || '')) ? String(requestedBranch) : '';
  if (allowed === null) {
    return requested ? { $or: [{ branch: requested }, { branchId: requested }, { assignedBranches: requested }] } : {};
  }
  const selfId = idOf(user._id || user.id);
  if (!allowed.length) return selfId ? { _id: selfId } : { _id: null };
  const branches = requested ? (allowed.includes(requested) ? [requested] : []) : allowed;
  if (!branches.length) return { _id: null };
  return { $or: [{ branch: { $in: branches } }, { branchId: { $in: branches } }, { assignedBranches: { $in: branches } }] };
};

// Ids of the company's users this viewer may see, or null when there is no branch limit.
// Use as `filter.user = { $in: ids }` on records that belong to a user (leave, asset request ...).
const scopedUserIds = async (user = {}, requestedBranch = '') => {
  if (allowedBranchIds(user) === null && !requestedBranch) return null;
  const User = require('../models/User');
  const companyId = idOf(user.company) || idOf(user.companyId);
  const companyCondition = mongoose.isValidObjectId(companyId)
    ? { $or: [{ company: companyId }, { companyId }] }
    : { companyCode: user.companyCode || '__none__' };
  const rows = await User.find({ $and: [companyCondition, userBranchCondition(user, requestedBranch)] }).select('_id').lean();
  return rows.map(row => row._id);
};

// Register requests: a branch-limited viewer sees requests for their branches plus requests
// that have no branch yet (otherwise nobody but the owner would ever see those).
const registerRequestBranchCondition = (user = {}) => {
  const allowed = allowedBranchIds(user);
  if (allowed === null) return {};
  const noBranch = { $and: [{ $or: [{ branch: null }, { branch: { $exists: false } }] }, { $or: [{ assignedBranches: { $size: 0 } }, { assignedBranches: { $exists: false } }] }] };
  if (!allowed.length) return noBranch;
  return { $or: [{ branch: { $in: allowed } }, { assignedBranches: { $in: allowed } }, noBranch] };
};

// Route guard for actions on one record. `resolveUserIds(req)` returns the user id(s) the record
// belongs to (or null/[] when it cannot tell - then the controller's own checks decide).
// Owner/admin always pass; anyone else needs every owner of the record inside their branches.
const requireRecordInBranches = (resolveUserIds, { label = 'records', message = '' } = {}) => async (req, res, next) => {
  try {
    if (allowedBranchIds(req.user) === null) return next();
    const raw = await resolveUserIds(req);
    const owners = (Array.isArray(raw) ? raw : [raw]).map(idOf).filter(id => mongoose.isValidObjectId(id));
    if (!owners.length) return next();
    const allowed = new Set(((await scopedUserIds(req.user)) || []).map(String));
    if (owners.every(id => allowed.has(id))) return next();
    return res.status(403).json({ success: false, message: message || `You can only manage ${label} of people in your branches.` });
  } catch (error) {
    return next(error);
  }
};

module.exports = { canSeeAllBranches, allowedBranchIds, userBranchCondition, viewerBranchIds, scopedUserIds, registerRequestBranchCondition, requireRecordInBranches };
