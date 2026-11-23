const ApiKey = require('../models/ApiKey');
const User = require('../models/User');

/**
 * Authenticates an MCP connection using fullKey (ciis_live_...)
 * Returns { user, companyCode, companyId, permissions } or throws error.
 */
async function authenticateMcpKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') {
    throw new Error('Authentication required: Missing or invalid CIIS API key');
  }

  const cleanKey = rawKey.replace(/^Bearer\s+/i, '').trim();
  if (!cleanKey.startsWith('ciis_live_')) {
    throw new Error('Invalid CIIS API key format. Expected key starting with ciis_live_');
  }

  const keyHash = ApiKey.hashKey(cleanKey);
  const keyDoc = await ApiKey.findOne({ keyHash, isActive: true })
    .populate('user')
    .lean();

  if (!keyDoc || !keyDoc.user) {
    throw new Error('Authentication failed: Invalid or revoked CIIS API key');
  }

  // Update lastUsedAt in background without blocking
  ApiKey.updateOne({ _id: keyDoc._id }, { $set: { lastUsedAt: new Date() } }).exec().catch(() => {});

  const user = keyDoc.user;
  const companyCode = String(keyDoc.companyCode || user.companyCode || '').toUpperCase();
  const companyId = keyDoc.company || user.company;

  const role = String(user.companyRole || user.role || user.jobRole || user.userType || keyDoc.role || '').toLowerCase();
  const isSuperAdmin = user.isSuperAdmin === true;
  const isOwner = user.isOwner === true || role.includes('owner');
  const isAdmin = isSuperAdmin || isOwner || role.includes('admin') || role.includes('director');
  const isHr = isAdmin || role.includes('hr');
  const isManager = isAdmin || isHr || role.includes('manager');

  const permissions = {
    role,
    isSuperAdmin,
    isOwner,
    isAdmin,
    isHr,
    isManager,
    canCreateClientPlans: isSuperAdmin || isOwner || isAdmin,
    canManageClientServices: isSuperAdmin || isOwner || isAdmin || isManager,
    canManageClients: isSuperAdmin || isOwner || isAdmin || isManager,
    canViewAllAttendance: isSuperAdmin || isOwner || isAdmin || isHr,
    canExportReports: isSuperAdmin || isOwner || isAdmin || isHr,
    canAssignTeamTasks: isSuperAdmin || isOwner || isAdmin || isHr || isManager,
    allowedPages: Array.isArray(keyDoc.allowedPages) && keyDoc.allowedPages.length > 0 
      ? keyDoc.allowedPages 
      : null
  };

  return {
    user,
    userId: String(user._id || user.id),
    companyCode,
    companyId,
    permissions,
    keyName: keyDoc.name
  };
}

module.exports = {
  authenticateMcpKey
};
