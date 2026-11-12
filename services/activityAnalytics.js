const mongoose = require('mongoose');
const PageActivity = require('../models/PageActivity');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Department = require('../models/Department');

// Usage numbers for one company, read by the company "User Activity" page and by the super
// admin company view. `userIds` (optional) limits everything to those users, e.g. the users of
// the branches a branch-limited viewer may see.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_PAGE = '(unknown)';

const istDayStart = (date = new Date()) => {
  const local = new Date(date.getTime() + IST_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - IST_OFFSET_MS);
};

// ?days=7 (default) or ?from=YYYY-MM-DD&to=YYYY-MM-DD, both in India time; `to` is inclusive.
const parseRange = (query = {}, defaultDays = 7) => {
  const dayKey = /^\d{4}-\d{2}-\d{2}$/;
  if (dayKey.test(String(query.from || '')) && dayKey.test(String(query.to || ''))) {
    const from = new Date(`${query.from}T00:00:00+05:30`);
    const to = new Date(new Date(`${query.to}T00:00:00+05:30`).getTime() + DAY_MS);
    if (from < to && to - from <= 366 * DAY_MS) return { from, to };
  }
  const days = Math.min(366, Math.max(1, parseInt(query.days, 10) || defaultDays));
  const to = new Date(istDayStart().getTime() + DAY_MS);
  return { from: new Date(to.getTime() - days * DAY_MS), to };
};

const toObjectId = value => (mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null);

const baseMatch = (companyId, { from, to }, userIds) => ({
  company: toObjectId(companyId),
  createdAt: { $gte: from, $lt: to },
  ...(Array.isArray(userIds) ? { user: { $in: userIds.map(toObjectId).filter(Boolean) } } : {}),
});

const pageKeyExpr = { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$path', ''] } }, 0] }, '$path', UNKNOWN_PAGE] };
const countType = type => ({ $sum: { $cond: [{ $eq: ['$type', type] }, 1, 0] } });

const pageStats = (match) => PageActivity.aggregate([
  { $match: { ...match, type: { $in: ['view', 'action'] } } },
  { $group: {
    _id: pageKeyExpr,
    views: countType('view'),
    actions: countType('action'),
    users: { $addToSet: '$user' },
    lastAt: { $max: '$createdAt' },
    totalDurationMs: { $sum: { $ifNull: ['$durationMs', 0] } },
    timedViews: { $sum: { $cond: [{ $gt: ['$durationMs', 0] }, 1, 0] } },
  } },
  { $project: {
    _id: 0,
    path: '$_id',
    views: 1,
    actions: 1,
    uniqueUsers: { $size: '$users' },
    lastAt: 1,
    avgDurationMs: { $cond: [{ $gt: ['$timedViews', 0] }, { $divide: ['$totalDurationMs', '$timedViews'] }, 0] },
  } },
  { $sort: { views: -1, actions: -1 } },
]);

const userStats = (match) => PageActivity.aggregate([
  { $match: match },
  { $group: {
    _id: '$user',
    views: countType('view'),
    actions: countType('action'),
    logins: countType('login'),
    lastActiveAt: { $max: '$createdAt' },
    timeMs: { $sum: { $ifNull: ['$durationMs', 0] } },
  } },
]);

// Most used page per user.
const topPagePerUser = (match) => PageActivity.aggregate([
  { $match: { ...match, type: { $in: ['view', 'action'] }, path: { $nin: ['', null] } } },
  { $group: { _id: { user: '$user', path: '$path' }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $group: { _id: '$_id.user', path: { $first: '$_id.path' }, count: { $first: '$count' } } },
]);

const dailyStats = (match) => PageActivity.aggregate([
  { $match: match },
  { $group: {
    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
    views: countType('view'),
    actions: countType('action'),
    logins: countType('login'),
    users: { $addToSet: '$user' },
  } },
  { $project: { _id: 0, date: '$_id', views: 1, actions: 1, logins: 1, activeUsers: { $size: '$users' } } },
  { $sort: { date: 1 } },
]);

const nameMap = async (Model, companyId, ids, fields = 'name') => {
  const list = [...new Set(ids.filter(id => mongoose.isValidObjectId(id)).map(String))];
  if (!list.length) return new Map();
  const rows = await Model.find({ _id: { $in: list } }).select(fields).lean();
  return new Map(rows.map(row => [String(row._id), row.name || row.branchName || row.departmentName || '']));
};

const idOf = value => String((value && typeof value === 'object' ? value._id || value.id : value) || '');

const buildUsageSummary = async (companyId, { range, userIds = null, userFilter = {} } = {}) => {
  const company = toObjectId(companyId);
  if (!company) throw new Error('Invalid company');
  const { from, to } = range || parseRange();
  const match = baseMatch(company, { from, to }, userIds);
  const todayStart = istDayStart();

  const usersQuery = {
    company,
    companyRole: { $not: /^client$/i },
    ...(Array.isArray(userIds) ? { _id: { $in: userIds.map(toObjectId).filter(Boolean) } } : {}),
    ...userFilter,
  };

  const [pages, perUser, topPages, days, users] = await Promise.all([
    pageStats(match),
    userStats(match),
    topPagePerUser(match),
    dailyStats(match),
    User.find(usersQuery)
      .select('name email companyRole jobRole jobRoleName department departmentName branch assignedBranches lastLogin isActive profileImage employeeId')
      .lean(),
  ]);

  const statsByUser = new Map(perUser.map(row => [String(row._id), row]));
  const topByUser = new Map(topPages.map(row => [String(row._id), row]));
  const [branchNames, departmentNames] = await Promise.all([
    nameMap(Branch, company, users.flatMap(u => [idOf(u.branch), ...(u.assignedBranches || []).map(idOf)])),
    nameMap(Department, company, users.map(u => idOf(u.department))),
  ]);

  const userRows = users.map(user => {
    const id = String(user._id);
    const stats = statsByUser.get(id) || {};
    const top = topByUser.get(id);
    const branchIds = [...new Set([idOf(user.branch), ...(user.assignedBranches || []).map(idOf)].filter(Boolean))];
    const lastLogin = user.lastLogin || null;
    return {
      _id: id,
      name: user.name || user.email || 'User',
      email: user.email || '',
      employeeId: user.employeeId || '',
      role: user.jobRoleName || (typeof user.jobRole === 'string' && !mongoose.isValidObjectId(user.jobRole) ? user.jobRole : '') || user.companyRole || '',
      department: user.departmentName || departmentNames.get(idOf(user.department)) || '',
      branches: branchIds.map(branchId => branchNames.get(branchId)).filter(Boolean),
      isActive: user.isActive !== false,
      lastLogin,
      lastActiveAt: stats.lastActiveAt || null,
      views: stats.views || 0,
      actions: stats.actions || 0,
      logins: stats.logins || 0,
      timeMs: stats.timeMs || 0,
      topPage: top ? top.path : '',
    };
  }).sort((a, b) => (new Date(b.lastActiveAt || b.lastLogin || 0) - new Date(a.lastActiveAt || a.lastLogin || 0)));

  const activeUsers = userRows.filter(u => u.isActive);
  const totals = {
    users: userRows.length,
    activeAccounts: activeUsers.length,
    loggedInToday: activeUsers.filter(u => u.lastLogin && new Date(u.lastLogin) >= todayStart).length,
    loggedInInRange: activeUsers.filter(u => u.lastLogin && new Date(u.lastLogin) >= from).length,
    neverLoggedIn: activeUsers.filter(u => !u.lastLogin).length,
    activeInRange: userRows.filter(u => u.views + u.actions + u.logins > 0).length,
    views: pages.reduce((sum, p) => sum + p.views, 0),
    actions: pages.reduce((sum, p) => sum + p.actions, 0),
    logins: perUser.reduce((sum, u) => sum + (u.logins || 0), 0),
  };

  return { range: { from, to }, totals, pages, users: userRows, days };
};

// Latest activity rows (who did what, where), newest first.
const activityFeed = async (companyId, { range, userIds = null, filters = {}, page = 1, limit = 50 } = {}) => {
  const company = toObjectId(companyId);
  const { from, to } = range || parseRange();
  const match = baseMatch(company, { from, to }, userIds);
  if (filters.userId && mongoose.isValidObjectId(filters.userId)) {
    const wanted = String(filters.userId);
    if (Array.isArray(userIds) && !userIds.map(String).includes(wanted)) return { items: [], total: 0, page: 1, pages: 1 };
    match.user = toObjectId(wanted);
  }
  if (filters.path) match.path = filters.path === UNKNOWN_PAGE ? { $in: ['', null] } : String(filters.path);
  if (['view', 'action', 'login'].includes(filters.type)) match.type = filters.type;

  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const [items, total] = await Promise.all([
    PageActivity.find(match).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit)
      .populate('user', 'name email').lean(),
    PageActivity.countDocuments(match),
  ]);
  return {
    items: items.map(item => ({
      _id: String(item._id),
      at: item.createdAt,
      type: item.type,
      path: item.path || '',
      method: item.method || '',
      endpoint: item.endpoint || '',
      source: item.source,
      durationMs: item.durationMs || 0,
      user: item.user ? { _id: String(item.user._id), name: item.user.name || item.user.email || 'User' } : null,
    })),
    total,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

module.exports = { parseRange, buildUsageSummary, activityFeed, istDayStart, UNKNOWN_PAGE };
