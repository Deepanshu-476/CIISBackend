const router = require('express').Router({ mergeParams: true });
const mongoose = require('mongoose');
const { protect, restrictTo, requirePlatformOwner } = require('../middleware/authMiddleware');
const Company = require('../models/Company');
const User = require('../models/User');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const Task = require('../HR-CDS/models/Task');
const Attendance = require('../HR-CDS/models/Attendance');
const Leave = require('../HR-CDS/models/Leave');
const Client = require('../HR-CDS/models/Client');
const Meeting = require('../HR-CDS/models/Meeting');

// Read-only view of one company's data for the platform owner (super admin "All Company" -> View Data).
// These routes never change anything and never return ID numbers, bank, salary, password or token fields.
// The regular APIs stay scoped to the logged-in user's own company and are not touched.
router.use(protect, restrictTo('super_admin'), requirePlatformOwner);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const page = req => {
  const p = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page: p, limit, skip: (p - 1) * limit };
};
const istDay = key => {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
  const start = valid ? new Date(`${key}T00:00:00+05:30`) : (() => {
    const local = new Date(Date.now() + IST_OFFSET_MS);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - IST_OFFSET_MS);
  })();
  return { start, end: new Date(start.getTime() + DAY_MS) };
};
const send = (res, items, total, { page: p, limit }, extra = {}) => res.json({
  success: true, items, total, page: p, limit, pages: Math.max(1, Math.ceil(total / limit)), ...extra,
});

// Resolve the company once per request.
router.use(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Invalid company id' });
    const company = await Company.findById(id)
      .select('companyName companyCode companyEmail companyPhone ownerName logo isActive subscriptionPlan subscriptionExpiry createdAt')
      .lean();
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    req.viewCompany = company;
    req.viewCompanyId = company._id;
    req.viewCompanyCode = company.companyCode;
    next();
  } catch (error) { next(error); }
});

const USER_FIELDS = 'name email phone companyRole jobRole jobRoleName department departmentName branch branchName employeeId employeeType isActive lastLogin createdAt profileImage';

router.get('/summary', async (req, res, next) => {
  try {
    const { viewCompanyId: company, viewCompanyCode: code } = req;
    const { start, end } = istDay();
    const now = new Date();
    const [users, activeUsers, taskStatus, attendanceToday, pendingLeaves, leadStatus, callsToday, totalCalls, pendingFollowUps, clients, upcomingMeetings] = await Promise.all([
      User.countDocuments({ company }),
      User.countDocuments({ company, isActive: { $ne: false } }),
      Task.aggregate([{ $match: { companyCode: code, isActive: { $ne: false } } }, { $group: { _id: '$overallStatus', n: { $sum: 1 } } }]),
      Attendance.aggregate([{ $match: { companyCode: code, date: { $gte: start, $lt: end } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Leave.countDocuments({ companyCode: code, status: /^pending$/i }),
      Lead.aggregate([{ $match: { company } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      CallLog.countDocuments({ company, createdAt: { $gte: start, $lt: end } }),
      CallLog.countDocuments({ company }),
      FollowUp.countDocuments({ company, status: { $nin: ['done', 'completed'] } }),
      Client.countDocuments({ companyCode: code }),
      Meeting.countDocuments({ companyCode: code, date: { $gte: now } }),
    ]);
    const toMap = rows => Object.fromEntries(rows.map(row => [row._id || 'unknown', row.n]));
    const sum = rows => rows.reduce((total, row) => total + row.n, 0);
    res.json({
      success: true,
      company: req.viewCompany,
      summary: {
        users: { total: users, active: activeUsers },
        tasks: { total: sum(taskStatus), byStatus: toMap(taskStatus) },
        attendanceToday: { total: sum(attendanceToday), byStatus: toMap(attendanceToday), notMarked: Math.max(0, activeUsers - sum(attendanceToday)) },
        leaves: { pending: pendingLeaves },
        crm: { leads: sum(leadStatus), leadsByStatus: toMap(leadStatus), callsToday, totalCalls, pendingFollowUps },
        clients,
        upcomingMeetings,
      },
    });
  } catch (error) { next(error); }
});

router.get('/users', async (req, res, next) => {
  try {
    const p = page(req);
    const filter = { company: req.viewCompanyId };
    if (req.query.search) {
      const pattern = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }, { employeeId: pattern }];
    }
    if (req.query.status === 'active') filter.isActive = { $ne: false };
    if (req.query.status === 'inactive') filter.isActive = false;
    const [items, total] = await Promise.all([
      User.find(filter).select(USER_FIELDS).populate('branch', 'name').sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      User.countDocuments(filter),
    ]);
    send(res, items, total, p);
  } catch (error) { next(error); }
});

router.get('/tasks', async (req, res, next) => {
  try {
    const p = page(req);
    const filter = { companyCode: req.viewCompanyCode, isActive: { $ne: false } };
    if (req.query.status && req.query.status !== 'all') filter.overallStatus = String(req.query.status);
    if (req.query.search) filter.title = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
    const [items, total] = await Promise.all([
      Task.find(filter)
        .select('title priority overallStatus dueDateTime taskFor createdAt completionDate assignedUsers createdBy')
        .populate('assignedUsers', 'name')
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Task.countDocuments(filter),
    ]);
    send(res, items, total, p);
  } catch (error) { next(error); }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const p = page(req);
    const { start, end } = istDay(req.query.date);
    const filter = { companyCode: req.viewCompanyCode, date: { $gte: start, $lt: end } };
    if (req.query.status && req.query.status !== 'all') filter.status = String(req.query.status);
    const [items, total] = await Promise.all([
      Attendance.find(filter)
        .select('user date inTime outTime status totalTime lateBy shiftName isClockedIn clockOutMode')
        .populate('user', 'name employeeId')
        .sort({ inTime: 1 }).skip(p.skip).limit(p.limit).lean(),
      Attendance.countDocuments(filter),
    ]);
    send(res, items, total, p, { date: start });
  } catch (error) { next(error); }
});

router.get('/leaves', async (req, res, next) => {
  try {
    const p = page(req);
    const filter = { companyCode: req.viewCompanyCode };
    if (req.query.status && req.query.status !== 'all') filter.status = new RegExp(`^${escapeRegex(req.query.status)}$`, 'i');
    const [items, total] = await Promise.all([
      Leave.find(filter)
        .select('user type startDate endDate days reason status createdAt')
        .populate('user', 'name employeeId')
        .sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Leave.countDocuments(filter),
    ]);
    send(res, items, total, p);
  } catch (error) { next(error); }
});

router.get('/clients', async (req, res, next) => {
  try {
    const p = page(req);
    const filter = { companyCode: req.viewCompanyCode };
    if (req.query.search) {
      const pattern = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      filter.$or = [{ client: pattern }, { company: pattern }, { email: pattern }, { phone: pattern }];
    }
    const [items, total] = await Promise.all([
      Client.find(filter)
        .select('client company email phone city status services progress projectManager createdAt')
        .sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Client.countDocuments(filter),
    ]);
    send(res, items, total, p);
  } catch (error) { next(error); }
});

router.get('/calls', async (req, res, next) => {
  try {
    const p = page(req);
    const filter = { company: req.viewCompanyId };
    if (req.query.status && req.query.status !== 'all') filter.status = String(req.query.status).toLowerCase();
    const [items, total] = await Promise.all([
      CallLog.find(filter)
        .select('leadName leadPhone agentName callType status duration createdAt notes')
        .sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      CallLog.countDocuments(filter),
    ]);
    send(res, items, total, p);
  } catch (error) { next(error); }
});

router.use((error, req, res, next) => {
  console.error('Company view error:', error);
  res.status(500).json({ success: false, message: 'Failed to load company data' });
});

module.exports = router;
