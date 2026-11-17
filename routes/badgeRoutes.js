const router = require('express').Router();
const { protect } = require('../middleware/authMiddleware');
const { internalGet } = require('../utils/internalGet');
const { getOrSetCached, setCached } = require('../utils/inMemoryCache');

// Sidebar badge counts in one request. Web and app used to call 7-8 endpoints every 2 minutes per user
// (full leave / asset / meeting lists just to count them). Each source route still runs with its own
// permission checks, in-process, and the counting below mirrors the client code it replaces.
const routers = {
  selfTasks: require('../HR-CDS/routes/selfTaskRoute.js'),
  assignedTasks: require('../HR-CDS/routes/assignedTaskRoute.js'),
  alerts: require('../HR-CDS/routes/alertRoutes.js'),
  crmAdmin: require('./adminCallRoutes.js'),
};
const AssetRequest = require('../HR-CDS/models/AssetRequest');
const Leave = require('../HR-CDS/models/Leave');
const Meeting = require('../HR-CDS/models/Meeting');
const User = require('../models/User');
const PagePermission = require('../models/PagePermission');
const { autoRejectExpiredLeaves } = require('../HR-CDS/controllers/LeaveController');

// Assets, leaves and meetings used to load the user's full lists (with populates) only to
// count them. These count the same records directly: the user's own pending asset requests,
// their pending leaves (after expiring old ones, as the leave list does) and the meetings
// they attend that have not started yet. The leave and meeting lists were also capped at one
// page, so users with many records got too-low counts.
const countOrNull = promise => promise.catch(error => {
  console.error('Badge count failed:', error.message);
  return null;
});

const countPendingAssets = req => countOrNull(AssetRequest.countDocuments({
  user: req.user._id,
  companyCode: req.user.companyCode,
  status: /^pending$/i,
}));

const countPendingLeaves = req => countOrNull((async () => {
  await autoRejectExpiredLeaves({ user: req.user._id });
  return Leave.countDocuments({ user: req.user._id, status: /^pending$/i });
})());

const countUpcomingMeetings = (req, userId) => countOrNull(Meeting.countDocuments({
  attendees: userId,
  companyCode: req.user?.companyCode || req.user?.company?.companyCode || '',
  date: { $gte: new Date() },
}));

const countPendingRegisterRequests = async (req) => {
  try {
    const user = req.user || {};
    const role = String(user.companyRole || user.jobRole || user.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const isAdminRole = ['owner', 'admin', 'hr', 'super_admin', 'superadmin', 'company_owner', 'companyowner', 'managing_director', 'director'].includes(role);

    if (!isAdminRole) {
      const company = user.company;
      const companyId = company?._id || company?.id || company;
      if (!companyId) return 0;

      const page = await PagePermission.findOne({ company: companyId, path: '/ciisUser/register-request' }).lean();
      if (!page) return 0;

      const currentUserId = String(user._id || user.id || '');
      const pageUserIds = key => (page[key] || []).map(item => String(item?.user?._id || item?.user || '')).filter(Boolean);
      const allowedIds = new Set([
        ...pageUserIds('viewUsers'),
        ...pageUserIds('editUsers'),
        ...pageUserIds('approvers'),
        ...pageUserIds('deleteUsers')
      ]);

      if (!allowedIds.has(currentUserId)) return 0;
    }

    const company = user.company;
    const companyId = company?._id || company?.id || company;
    const filter = {};
    if (companyId) {
      filter.company = companyId;
    } else if (!['super_admin', 'superadmin'].includes(role)) {
      return 0;
    }

    filter.$or = [
      { registrationStatus: 'pending' },
      { registrationSource: 'self_register', isActive: false },
      {
        registrationSource: { $exists: false },
        registrationStatus: { $exists: false },
        isActive: false
      }
    ];

    const branchCondition = require('../utils/branchScope').registerRequestBranchCondition(user);
    if (Object.keys(branchCondition).length) filter.$and = [branchCondition];
    return await User.countDocuments(filter);
  } catch (err) {
    console.error('Badge count pending register requests error:', err.message);
    return null;
  }
};

const BADGE_TTL_MS = 30 * 1000;

const pendingFromStats = body => {
  const stats = body?.stats || body?.data?.stats || body?.statusCounts || body?.data?.statusCounts;
  const pending = stats?.pending;
  if (typeof pending === 'number') return pending;
  if (typeof pending?.count === 'number') return pending.count;
  return null;
};

const ok = result => result && result.status < 400 && result.body !== undefined;

const buildCounts = async (req, includeCrm) => {
  const userId = String(req.user._id || req.user.id);
  const [selfTasks, assignedTasks, assets, meetings, alerts, leaves, registerRequests, crm] = await Promise.all([
    internalGet(routers.selfTasks, req, '/stats'),
    internalGet(routers.assignedTasks, req, '/to-me/stats'),
    countPendingAssets(req),
    countUpcomingMeetings(req, userId),
    internalGet(routers.alerts, req, '/unread/count?mine=1'),
    countPendingLeaves(req),
    countOrNull(countPendingRegisterRequests(req)),
    includeCrm ? internalGet(routers.crmAdmin, req, '/dashboard') : Promise.resolve(null),
  ]);

  const counts = {};
  const selfPending = ok(selfTasks) ? pendingFromStats(selfTasks.body) : null;
  const assignedPending = ok(assignedTasks) ? pendingFromStats(assignedTasks.body) : null;
  if (selfPending !== null || assignedPending !== null) {
    counts.tasks = Math.max(0, selfPending || 0) + Math.max(0, assignedPending || 0);
  }
  if (typeof assets === 'number') counts.assets = assets;
  if (typeof leaves === 'number') counts.leaves = leaves;
  if (typeof meetings === 'number') counts.meetings = meetings;
  if (typeof registerRequests === 'number') counts.registerRequests = registerRequests;
  if (ok(alerts) && typeof alerts.body?.count === 'number') counts.alerts = alerts.body.count;
  if (crm && ok(crm)) {
    const metrics = crm.body?.metrics || {};
    if (typeof metrics.totalLeads === 'number') counts.leads = metrics.totalLeads;
    if (typeof metrics.todaysCalls === 'number') counts.todaysCalls = metrics.todaysCalls;
    if (typeof metrics.pendingFollowUps === 'number') counts.pendingCalls = metrics.pendingFollowUps;
    if (typeof metrics.todaysFollowUps === 'number') counts.followUps = metrics.todaysFollowUps;
  }
  return counts;
};

// GET /api/badges[?crm=1][&fresh=1]
router.get('/', protect, async (req, res) => {
  try {
    const includeCrm = ['1', 'true'].includes(String(req.query.crm || ''));
    const key = `badges|${req.user._id || req.user.id}|${includeCrm ? 'crm' : ''}`;
    const load = () => buildCounts(req, includeCrm);
    // fresh=1 (after the user acted, e.g. marked a notification read) recomputes and refreshes the cache.
    const counts = ['1', 'true'].includes(String(req.query.fresh || ''))
      ? setCached(key, await load(), BADGE_TTL_MS)
      : await getOrSetCached(key, load, BADGE_TTL_MS);
    res.json({ success: true, counts });
  } catch (error) {
    console.error('Badge counts failed:', error);
    res.status(500).json({ success: false, message: 'Failed to load badge counts' });
  }
});

module.exports = router;
