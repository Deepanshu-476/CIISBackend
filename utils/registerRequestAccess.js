const PagePermission = require('../models/PagePermission');
const { isClientLogin } = require('../middleware/pageAccess');
const { findSidebarConfig, filterMenuItemsByCompanyAccess } = require('../routes/sidebarConfigs');

const REGISTER_REQUEST_KEY = 'register-request';
const REGISTER_REQUEST_PATH = '/ciisUser/register-request';
const registerRequestPage = { id: REGISTER_REQUEST_KEY, path: REGISTER_REQUEST_PATH };
const noAccess = { canView: false, canVerify: false };

const idOf = value => String(value?._id || value?.id || value || '');
const normalize = value => String(value || '').trim().toLowerCase().replace(/\/+$/, '');

const isRegisterRequestAdmin = user => {
  const role = String(user.companyRole || user.jobRole || user.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['owner', 'admin', 'hr', 'super_admin', 'superadmin', 'company_owner', 'companyowner'].includes(role);
};

const getRegisterRequestAccess = async user => {
  if (!user || isClientLogin(user)) return noAccess;
  const companyId = idOf(user.company);
  if (!companyId || !(await filterMenuItemsByCompanyAccess(companyId, [registerRequestPage])).length) return noAccess;
  if (isRegisterRequestAdmin(user)) return { canView: true, canVerify: true };

  const userId = idOf(user._id || user.id);
  if (!userId) return noAccess;
  const page = await PagePermission.findOne({ company: companyId, path: REGISTER_REQUEST_PATH }).lean();
  const hasGrant = field => (page?.[field] || []).some(entry => idOf(entry.user) === userId);
  const canVerify = hasGrant('approvers');
  if (canVerify || ['viewUsers', 'editUsers', 'deleteUsers'].some(hasGrant)) {
    return { canView: true, canVerify };
  }

  const departmentId = idOf(user.department);
  const role = idOf(user.jobRoleId || user.jobRole || user.role);
  if (!departmentId || !role) return noAccess;
  const config = await findSidebarConfig({
    companyId, departmentId, role, branchId: idOf(user.branch), allowOtherBranches: false
  });
  const canView = Boolean(config?.menuItems?.some(item => (
    item.visible !== false && !item.disabled &&
    (normalize(item.id) === REGISTER_REQUEST_KEY || normalize(item.path) === REGISTER_REQUEST_PATH.toLowerCase())
  )));
  return { canView, canVerify: false };
};

module.exports = { REGISTER_REQUEST_PATH, getRegisterRequestAccess };
