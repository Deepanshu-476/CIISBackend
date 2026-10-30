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
  assets: require('../HR-CDS/routes/assetRequestRoutes.js'),
  meetings: require('../HR-CDS/routes/meetingRoutes.js'),
  alerts: require('../HR-CDS/routes/alertRoutes.js'),
  leaves: require('../HR-CDS/routes/LeaveRoutes.js'),
  crmAdmin: require('./adminCallRoutes.js'),
};

const BADGE_TTL_MS = 30 * 1000;

const pendingFromStats = body => {
  const stats = body?.stats || body?.data?.stats || body?.statusCounts || body?.data?.statusCounts;
  const pending = stats?.pending;
  if (typeof pending === 'number') return pending;
  if (typeof pending?.count === 'number') return pending.count;
  return null;
};

const records = (body, keys = []) => {
  const candidates = [body, body?.data, ...keys.flatMap(key => [body?.[key], body?.data?.[key]])];
  return candidates.find(Array.isArray) || [];
};

const ok = result => result && result.status < 400 && result.body !== undefined;

const buildCounts = async (req, includeCrm) => {
  const userId = String(req.user._id || req.user.id);
  const [selfTasks, assignedTasks, assets, meetings, alerts, leaves, crm] = await Promise.all([
    internalGet(routers.selfTasks, req, '/stats'),
    internalGet(routers.assignedTasks, req, '/to-me/stats'),
    internalGet(routers.assets, req, '/my-requests'),
    internalGet(routers.meetings, req, `/user/${userId}?page=1&limit=100`),
    internalGet(routers.alerts, req, '/unread/count?mine=1'),
    internalGet(routers.leaves, req, '/status'),
    includeCrm ? internalGet(routers.crmAdmin, req, '/dashboard') : Promise.resolve(null),
  ]);

  const counts = {};
  const selfPending = ok(selfTasks) ? pendingFromStats(selfTasks.body) : null;
  const assignedPending = ok(assignedTasks) ? pendingFromStats(assignedTasks.body) : null;
  if (selfPending !== null || assignedPending !== null) {
    counts.tasks = Math.max(0, selfPending || 0) + Math.max(0, assignedPending || 0);
  }
  if (ok(assets)) {
    counts.assets = records(assets.body, ['requests']).filter(item => String(item?.status || '').toLowerCase() === 'pending').length;
  }
  if (ok(leaves)) {
    counts.leaves = records(leaves.body, ['leaves']).filter(item => String(item?.status || '').toLowerCase() === 'pending').length;
  }
  if (ok(meetings)) {
    const now = Date.now();
    counts.meetings = records(meetings.body, ['meetings']).filter(meeting => {
      const status = String(meeting?.status || '').toLowerCase();
      if (['completed', 'closed', 'cancelled', 'canceled'].includes(status)) return false;
      const dateValue = meeting?.meetingDate || meeting?.date || meeting?.startDate || meeting?.scheduledAt;
      const timestamp = dateValue ? new Date(dateValue).getTime() : NaN;
      return Number.isNaN(timestamp) || timestamp >= now;
    }).length;
  }
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
