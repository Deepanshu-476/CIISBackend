const PagePermission = require('../models/PagePermission');

const telecallerUserIds = async company => {
  const pages = await PagePermission.find({ company, path: /^\/ciisUser\/telecaller\//i })
    .select('viewUsers editUsers deleteUsers approvers')
    .lean();
  const pageUserIds = [...new Set(pages.flatMap(page => ['viewUsers', 'editUsers', 'deleteUsers', 'approvers']
    .flatMap(field => (page[field] || []).map(entry => String(entry?.user?._id || entry?.user || '')).filter(Boolean))))];

  if (pageUserIds.length > 0) {
    return pageUserIds;
  }

  // Fallback: If no explicit PagePermissions exist for telecaller pages, discover active users with telecaller role
  try {
    const User = require('../models/User');
    const roleUsers = await User.find({
      company,
      isActive: { $ne: false },
      $or: [
        { jobRole: /telecaller/i },
        { companyRole: /telecaller/i },
        { role: /telecaller/i }
      ]
    }).select('_id').lean();
    return roleUsers.map(u => String(u._id)).filter(Boolean);
  } catch {
    return [];
  }
};

const telecallerFilter = (company, userIds) => ({
  company,
  isActive: { $ne: false },
  _id: { $in: userIds }
});

const hasTelecallerAccess = async (company, userId) => {
  const eligible = await telecallerUserIds(company);
  if (eligible.includes(String(userId))) return true;
  try {
    const User = require('../models/User');
    const user = await User.findOne({
      _id: userId,
      company,
      isActive: { $ne: false },
      $or: [
        { jobRole: /telecaller/i },
        { companyRole: /telecaller/i },
        { role: /telecaller/i }
      ]
    }).select('_id').lean();
    return Boolean(user);
  } catch {
    return false;
  }
};

module.exports = { telecallerFilter, telecallerUserIds, hasTelecallerAccess };

