// Shared access checks for company pages.
//
// requirePageAccess: owners always pass; client logins never pass; everyone
// else needs the Page Management permission for that page. When the company has
// not configured the page yet, the fallback roles (e.g. admin, hr) are allowed,
// the same way job roles work (routes/jobRoleRoutes.js).
//
// blockClientLogins: for company-internal APIs a client login must not use.
const PagePermission = require('../models/PagePermission');
const { isSuperAdminUser } = require('./authMiddleware');

const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
const roleText = value => (value && typeof value === 'object'
  ? value.name || value.roleName || value.title || ''
  : value);
const rolesOf = user => [user?.companyRole, user?.role, user?.jobRole, user?.jobRoleName, user?.userType]
  .map(roleText).filter(Boolean).map(normalizeRole);

const OWNER_ROLES = ['owner', 'company_owner', 'companyowner', 'super_admin', 'superadmin'];

const isClientLogin = user => {
  if (!user) return false;
  if (rolesOf(user).includes('client')) return true;
  return false;
};

const isCompanyOwner = user => Boolean(user) && (
  user.isCompanyOwner === true || isSuperAdminUser(user) || rolesOf(user).some(r => OWNER_ROLES.includes(r))
);

const idsOf = list => (list || []).map(item => String(item?.user?._id || item?.user || '')).filter(Boolean);
const scopedIds = (scopes, type) => (scopes || [])
  .filter(s => String(s?.accessType || '').trim().toLowerCase() === type)
  .map(s => String(s?.user?._id || s?.user || '')).filter(Boolean);

// alwaysRoles: roles that pass without a Page Management entry (e.g. company admin).
// fallbackRoles: roles that pass only while the page has not been configured yet.
const hasPageAccess = async (user, { paths, action = 'edit', fallbackRoles = [], alwaysRoles = [] }) => {
  if (!user) return false;
  if (isClientLogin(user)) return false;
  if (isCompanyOwner(user)) return true;

  const roles = rolesOf(user);
  if (roles.some(r => alwaysRoles.map(normalizeRole).includes(r))) return true;
  const fallback = roles.some(r => fallbackRoles.map(normalizeRole).includes(r));
  const companyId = user.company?._id || user.company || user.companyId;
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return fallback;

  const page = await PagePermission.findOne({ company: companyId, path: { $in: paths } }).lean();
  if (!page) return fallback;

  const configured = [
    ...idsOf(page.viewUsers), ...idsOf(page.editUsers), ...idsOf(page.deleteUsers), ...idsOf(page.approvers),
    ...(page.userAccessScopes || []).map(s => String(s?.user?._id || s?.user || '')).filter(Boolean),
  ];
  if (configured.length === 0) return fallback;

  if (action === 'view') return configured.includes(userId);
  if (action === 'delete') return new Set([...idsOf(page.deleteUsers), ...scopedIds(page.userAccessScopes, 'delete')]).has(userId);
  return new Set([...idsOf(page.editUsers), ...idsOf(page.approvers), ...scopedIds(page.userAccessScopes, 'edit')]).has(userId);
};

const requirePageAccess = options => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authorized' });
    if (await hasPageAccess(req.user, options)) return next();
    return res.status(403).json({
      success: false,
      message: `You do not have ${options.action || 'edit'} access for ${options.label || 'this page'}. Ask an admin to give it in Page Management.`,
    });
  } catch (error) {
    return next(error);
  }
};

const blockClientLogins = (req, res, next) => {
  if (isClientLogin(req.user)) {
    return res.status(403).json({ success: false, message: 'Client logins cannot use this feature.' });
  }
  return next();
};

// The client records a client login belongs to (linked by userId or email).
const ownClientIds = async user => {
  const Client = require('../HR-CDS/models/Client');
  const or = [{ userId: user._id || user.id }];
  if (user.email) or.push({ email: String(user.email).trim().toLowerCase() });
  const rows = await Client.find({ $or: or }).select('_id').lean();
  const ids = new Set(rows.map(row => String(row._id)));
  if (user.clientId) ids.add(String(user.clientId?._id || user.clientId));
  return ids;
};

// Employees keep their current access; a client login may only open its own client.
const canSeeClient = async (user, clientId) => !isClientLogin(user) || (await ownClientIds(user)).has(String(clientId));

const requireOwnClient = getClientId => async (req, res, next) => {
  try {
    if (await canSeeClient(req.user, getClientId(req))) return next();
    return res.status(403).json({ success: false, message: 'You can only see your own client account.' });
  } catch (error) {
    return next(error);
  }
};

module.exports = { requirePageAccess, hasPageAccess, blockClientLogins, isClientLogin, isCompanyOwner, canSeeClient, requireOwnClient };
