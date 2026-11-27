// Shared access checks for company pages.
//
// Company owners retain access to entitled pages. Staff receive only the
// actions granted in Page Management.
//
// blockClientLogins: for company-internal APIs a client login must not use.
const PagePermission = require('../models/PagePermission');
const { isPlatformOwner } = require('./authMiddleware');
const { getCompanyPageEntitlements, isPageEntitled } = require('../utils/companyPageEntitlements');

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
  user.isCompanyOwner === true || isPlatformOwner(user) ||
  [user.companyRole, user.role].map(roleText).map(normalizeRole).some(r => OWNER_ROLES.includes(r))
);

const ACTION_FIELDS = {
  view: 'viewUsers', edit: 'editUsers', delete: 'deleteUsers', approve: 'approvers',
  generate: 'generateUsers', lock: 'lockUsers', unlock: 'unlockUsers',
};

const grantId = entry => String(entry?.user?._id || entry?.user || entry?._id || entry || '');

const hasGrantedPageAction = (page, userId, action) => {
  if (!page || !ACTION_FIELDS[action]) return false;
  const actions = action === 'view' ? Object.keys(ACTION_FIELDS) : [action];
  return actions.some(type => (page[ACTION_FIELDS[type]] || []).some(entry => grantId(entry) === userId) ||
    (page.userAccessScopes || []).some(scope => scope.accessType === type && grantId(scope) === userId));
};

const getEntitledPaths = async (companyId, paths) => {
  const entitlements = await getCompanyPageEntitlements(companyId);
  return paths.filter(path => isPageEntitled(entitlements, {path}));
};

const hasPageAccess = async (user, { paths, action = 'edit', allowOwner = true }) => {
  if (!user || isClientLogin(user)) return false;
  // Platform users retain their cross-company administration capabilities.
  if (allowOwner && isPlatformOwner(user)) return true;
  const companyId = user.company?._id || user.company || user.companyId;
  const userId = String(user._id || user.id || '');
  if (!companyId || !userId) return false;

  const entitledPaths = await getEntitledPaths(companyId, paths);
  if (!entitledPaths.length) return false;
  if (allowOwner && isCompanyOwner(user)) return true;

  const pages = await PagePermission.find({ company: companyId, path: { $in: entitledPaths } }).lean();
  return pages.some(page => hasGrantedPageAction(page, userId, action));
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

// The client records a client login belongs to (linked by userId, email, client name, or explicit additional details).
const ownClientIds = async user => {
  const Client = require('../HR-CDS/models/Client');
  const or = [{ userId: user._id || user.id }];
  if (user.email) or.push({ email: String(user.email).trim().toLowerCase() });
  const name = String(user.name || user.fullName || '').trim();
  if (name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    or.push({ client: new RegExp('^' + escapedName + '$', 'i'), companyCode: user.companyCode || 'CAREER' });
  }
  let additionalClientIds = [];
  try {
    const details = typeof user.additionalDetails === 'string'
      ? JSON.parse(user.additionalDetails || '{}')
      : (user.additionalDetails || {});
    if (details?.clientId) additionalClientIds.push(details.clientId);
    if (Array.isArray(details?.clientIds)) additionalClientIds.push(...details.clientIds);
  } catch (_) {}
  if (additionalClientIds.length) {
    or.push({ _id: { $in: additionalClientIds } });
  }

  const rows = await Client.find({ $or: or }).select('_id').lean();
  const ids = new Set(rows.map(row => String(row._id)));
  if (user.clientId) ids.add(String(user.clientId?._id || user.clientId));
  additionalClientIds.forEach(id => ids.add(String(id)));
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

module.exports = { requirePageAccess, hasPageAccess, hasGrantedPageAction, blockClientLogins, isClientLogin, isCompanyOwner, canSeeClient, requireOwnClient };
