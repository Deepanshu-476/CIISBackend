const PagePermission = require('../models/PagePermission');
const { isClientLogin, isCompanyOwner } = require('../middleware/pageAccess');
const { getCompanyPageEntitlements, isPageEntitled } = require('./companyPageEntitlements');
const { registerRequestBranchCondition } = require('./branchScope');
const { hasAnyPagePermissionGrant, resolveUserSidebarConfig, sidebarConfigHasPage } = require('./autoFullAccessPages');

const REGISTER_REQUEST_PATH = '/ciisUser/register-request';
const noAccess = { canView: false, canVerify: false };
const fullAccess = { canView: true, canVerify: true };
const adminRoles = new Set(['admin', 'company_admin', 'companyadmin', 'career_infowis_admin']);
const companyIdOf = user => user?.company?._id || user?.company?.id || user?.company || user?.companyId;
const normalizeRole = role => String(role?.name || role?.roleName || role || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');

const hasCompanyRegistrationAdminAccess = user => Boolean(companyIdOf(user) && (user?._id || user?.id) &&
  !isClientLogin(user) && (isCompanyOwner(user) || adminRoles.has(normalizeRole(user.companyRole || user.role))));

const getRegisterRequestBranchCondition = user => hasCompanyRegistrationAdminAccess(user)
  ? {} : registerRequestBranchCondition(user);

const getRegisterRequestAccess = async user => {
  if (!user || isClientLogin(user)) return noAccess;
  const companyId = companyIdOf(user);
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return noAccess;
  // Company administrators manage onboarding for their own company independently of staff grants.
  if (hasCompanyRegistrationAdminAccess(user)) return fullAccess;
  if (!isPageEntitled(await getCompanyPageEntitlements(companyId), { path: REGISTER_REQUEST_PATH })) return noAccess;

  const page = await PagePermission.findOne({ company: companyId, path: REGISTER_REQUEST_PATH }).lean();
  if (hasAnyPagePermissionGrant(page, userId)) {
    return fullAccess;
  }

  const sidebarConfig = await resolveUserSidebarConfig(user);
  if (sidebarConfigHasPage(sidebarConfig, REGISTER_REQUEST_PATH)) {
    return fullAccess;
  }

  return noAccess;
};

module.exports = { REGISTER_REQUEST_PATH, getRegisterRequestAccess, hasCompanyRegistrationAdminAccess, getRegisterRequestBranchCondition };
