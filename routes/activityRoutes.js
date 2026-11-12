const router = require('express').Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { requirePageAccess } = require('../middleware/pageAccess');
const User = require('../models/User');
const { recordViews } = require('../utils/activityTracker');
const { parseRange, buildUsageSummary, activityFeed } = require('../services/activityAnalytics');

// Company "User Activity" page: which user opened which page, what they changed there, and when
// each user last logged in. Owner and company admin see the whole company; anyone else needs
// View on the page in Page Management and sees only the people of their own branches.

const PAGE_PATH = '/ciisUser/user-activity';
const COMPANY_WIDE_ROLES = ['owner', 'company_owner', 'companyowner', 'admin', 'super_admin', 'superadmin', 'career_infowis_admin'];
const norm = value => String((value && typeof value === 'object' ? value.name : value) || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const idOf = value => String((value && typeof value === 'object' ? value._id || value.id : value) || '');

const canSeeWholeCompany = user => user?.isCompanyOwner === true || user?.isSuperAdmin === true ||
  [user?.companyRole, user?.role, user?.jobRole, user?.jobRoleName].map(norm).some(role => COMPANY_WIDE_ROLES.includes(role));

const companyIdOf = user => idOf(user?.company) || idOf(user?.companyId);

// null = every user of the company; otherwise the ids this viewer may see.
const visibleUserIds = async (req) => {
  const user = req.user;
  const companyId = companyIdOf(user);
  const requestedBranch = String(req.query.branch || req.query.branchId || '').trim();
  const branchFilter = mongoose.isValidObjectId(requestedBranch) ? requestedBranch : '';

  let allowedBranches = null;
  if (!canSeeWholeCompany(user)) {
    const fresh = await User.findById(user._id || user.id).select('branch assignedBranches').lean();
    allowedBranches = [...new Set([idOf(fresh?.branch), ...((fresh?.assignedBranches) || []).map(idOf)].filter(Boolean))];
    if (!allowedBranches.length) return [String(user._id || user.id)];
    if (branchFilter && !allowedBranches.includes(branchFilter)) return [];
  }
  const branches = branchFilter ? [branchFilter] : allowedBranches;
  if (!branches) return null;
  const rows = await User.find({
    company: companyId,
    $or: [{ branch: { $in: branches } }, { assignedBranches: { $in: branches } }],
  }).select('_id').lean();
  return rows.map(row => String(row._id));
};

// Website / app report the pages a user opened (batched).
router.post('/views', protect, (req, res) => {
  const views = Array.isArray(req.body?.views) ? req.body.views : (req.body?.path ? [req.body] : []);
  const source = String(req.get('x-client-app') || req.body?.source || '').toLowerCase();
  const saved = recordViews(req.user, views, source === 'web' || source === 'app' ? source : 'unknown');
  res.json({ success: true, saved });
});

const viewAccess = requirePageAccess({ paths: [PAGE_PATH], action: 'view', alwaysRoles: ['admin'], label: 'Employee Activity' });

router.get('/summary', protect, viewAccess, async (req, res, next) => {
  try {
    const companyId = companyIdOf(req.user);
    if (!mongoose.isValidObjectId(companyId)) return res.status(400).json({ success: false, message: 'Company not found for this login' });
    const userIds = await visibleUserIds(req);
    const data = await buildUsageSummary(companyId, { range: parseRange(req.query, 7), userIds });
    res.json({ success: true, wholeCompany: userIds === null && !req.query.branch, ...data });
  } catch (error) { next(error); }
});

router.get('/feed', protect, viewAccess, async (req, res, next) => {
  try {
    const companyId = companyIdOf(req.user);
    if (!mongoose.isValidObjectId(companyId)) return res.status(400).json({ success: false, message: 'Company not found for this login' });
    const userIds = await visibleUserIds(req);
    const data = await activityFeed(companyId, {
      range: parseRange(req.query, 7),
      userIds,
      filters: { userId: req.query.userId, path: req.query.path, type: req.query.type },
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (error) { next(error); }
});

module.exports = router;
