const mongoose = require('mongoose');
const WeekOffRequest = require('../models/WeekOffRequest');
const Holiday = require('../models/Holiday');
const User = require('../../models/User');
const Department = require('../../models/Department');
const { notifyPageUsers, notifyDirectUsers, getCompanyId } = require('../utils/systemNotificationService');
const {
  dateKeyOf,
  weekStartKeyOf,
  addDaysToKey,
  weekdayOfKey,
  effectiveWorkingDays,
  weekOffEntitlement,
  normalizeWeekOffDays,
  resolveOffDayKeys,
  validateSwap,
} = require('../utils/weekOff');

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekdayName = value => WEEKDAY_NAMES[Number(value)] || '';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const companyOf = user => user?.company?._id || user?.company || user?.companyId || null;
const companyCodeOf = user => user?.companyCode || user?.company?.companyCode || '';

/** The employee's department document, by id or by name within the company. */
const departmentOf = async (user) => {
  const raw = user?.department;
  if (raw && typeof raw === 'object' && (raw.workingDays !== undefined || Array.isArray(raw.workingDayHistory))) {
    return raw;
  }
  const value = typeof raw === 'object' ? (raw?._id || raw?.id || raw?.name) : (raw || user?.departmentName);
  if (!value) return null;
  const text = String(value).trim();
  if (mongoose.Types.ObjectId.isValid(text)) {
    const byId = await Department.findById(text).select('name workingDays workingDayHistory').lean();
    if (byId) return byId;
  }
  const filter = { name: { $regex: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };
  const company = companyOf(user);
  if (company && mongoose.Types.ObjectId.isValid(String(company))) filter.company = company;
  else if (companyCodeOf(user)) filter.companyCode = companyCodeOf(user);
  return Department.findOne(filter).select('name workingDays workingDayHistory').lean();
};

const approvedSwapsFor = async (userId, fromKey, toKey) => WeekOffRequest.find({
  user: userId,
  status: 'Approved',
  weekStartKey: { $gte: weekStartKeyOf(fromKey), $lte: weekStartKeyOf(toKey) },
}).select('weekStartKey fromDateKey toDateKey status').lean();

const monthRange = (month) => {
  const text = /^\d{4}-\d{2}$/.test(String(month || '').trim()) ? String(month).trim() : dateKeyOf(new Date()).slice(0, 7);
  const from = `${text}-01`;
  const [year, monthNumber] = text.split('-').map(Number);
  const to = `${text}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  return { month: text, from, to };
};

/** GET /week-off/my-schedule?month=YYYY-MM — my off days, my fixed day and this month's requests. */
const getMySchedule = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { month, from, to } = monthRange(req.query?.month);
    const userDoc = await User.findById(userId).select('name weekOffDays department departmentName company companyCode').lean();
    if (!userDoc) return fail(res, 404, 'User not found.');

    const department = await departmentOf({ ...userDoc, company: companyOf(req.user) || userDoc.company });
    const entitlement = weekOffEntitlement(department, from);
    const swaps = await approvedSwapsFor(userId, from, to);
    const offDayKeys = [...resolveOffDayKeys({
      department,
      weekOffDays: userDoc.weekOffDays,
      swaps,
      from,
      to,
    })].sort();

    const requests = await WeekOffRequest.find({
      user: userId,
      weekStartKey: { $gte: weekStartKeyOf(addDaysToKey(from, -7)), $lte: weekStartKeyOf(to) },
    }).sort({ weekStartKey: -1, createdAt: -1 }).lean();

    return res.json({
      success: true,
      month,
      workingDays: effectiveWorkingDays(department, from),
      entitlement,
      departmentName: department?.name || userDoc.departmentName || '',
      weekOffDays: normalizeWeekOffDays(userDoc.weekOffDays, entitlement),
      weekOffDayNames: normalizeWeekOffDays(userDoc.weekOffDays, entitlement).map(weekdayName),
      offDayKeys,
      requests,
    });
  } catch (error) {
    console.error('getMySchedule error:', error.message);
    return fail(res, 500, 'Could not load your weekly off schedule.');
  }
};

/** POST /week-off/request — ask to take this week's off on another day of the same week. */
const createRequest = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const companyCode = companyCodeOf(req.user);
    if (!companyCode) return fail(res, 400, 'User company code not found.');

    const toDateKey = dateKeyOf(req.body?.toDate || req.body?.toDateKey);
    const fromDateKeyInput = req.body?.fromDate || req.body?.fromDateKey || null;
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!toDateKey) return fail(res, 400, 'Choose the day you want as your weekly off.');

    const todayKey = dateKeyOf(new Date());
    if (weekStartKeyOf(toDateKey) < weekStartKeyOf(todayKey)) {
      return fail(res, 400, 'That week is already over. Pick a day in this week or a later one.');
    }

    const userDoc = await User.findById(userId).select('name weekOffDays department departmentName company companyCode').lean();
    if (!userDoc) return fail(res, 404, 'User not found.');
    const department = await departmentOf({ ...userDoc, company: companyOf(req.user) || userDoc.company });

    const weekStartKey = weekStartKeyOf(toDateKey);
    const weekEndKey = addDaysToKey(weekStartKey, 6);
    const swaps = await approvedSwapsFor(userId, weekStartKey, weekEndKey);
    const check = validateSwap({
      department,
      weekOffDays: userDoc.weekOffDays,
      swaps,
      toDate: toDateKey,
      fromDate: fromDateKeyInput,
    });
    if (!check.ok) return fail(res, 400, check.message);

    const pending = await WeekOffRequest.findOne({ user: userId, weekStartKey, status: 'Pending' }).lean();
    if (pending) {
      return fail(res, 400, 'You already have a weekly off request waiting for approval for that week.');
    }

    const holiday = await Holiday.findOne({
      $or: [
        { companyCode },
        ...(companyOf(req.user) ? [{ company: companyOf(req.user) }] : []),
      ],
      isActive: { $ne: false },
      date: { $gte: new Date(`${toDateKey}T00:00:00.000Z`), $lte: new Date(`${toDateKey}T23:59:59.999Z`) },
    }).select('title').lean();
    if (holiday) {
      return fail(res, 400, `${toDateKey} is already a company holiday (${holiday.title || 'Holiday'}), so there is nothing to move.`);
    }

    const request = await WeekOffRequest.create({
      user: userId,
      company: companyOf(req.user),
      companyCode,
      weekStartKey: check.weekStartKey,
      fromDateKey: check.fromDateKey,
      toDateKey: check.toDateKey,
      reason,
    });

    try {
      const companyId = getCompanyId(req.user);
      if (companyId) {
        await notifyPageUsers({
          companyId,
          targetPath: '/ciisUser/emp-attendance',
          targetScreen: 'Employee Attendance',
          excludeUserIds: [String(userId)],
          type: 'week_off_request',
          title: 'New Weekly Off Request',
          message: `${req.user.name || userDoc.name || 'An employee'} wants ${weekdayName(weekdayOfKey(check.toDateKey))} ${check.toDateKey} as their weekly off instead of ${check.fromDateKey}`,
          actor: userId,
          data: {
            requestId: request._id,
            userId: String(userId),
            userName: req.user.name || userDoc.name || '',
            fromDateKey: check.fromDateKey,
            toDateKey: check.toDateKey,
            weekStartKey: check.weekStartKey,
          },
          priority: 'medium',
        });
      }
    } catch (notifyError) {
      console.error('Failed to notify approvers of week off request:', notifyError.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Weekly off request sent for approval.',
      data: request,
    });
  } catch (error) {
    console.error('createRequest (week off) error:', error.message);
    return fail(res, 500, 'Could not send the weekly off request.');
  }
};

/** GET /week-off/my-requests */
const getMyRequests = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const filter = { user: userId };
    if (req.query?.status) filter.status = String(req.query.status);
    const requests = await WeekOffRequest.find(filter)
      .populate('reviewedBy', 'name')
      .sort({ weekStartKey: -1, createdAt: -1 })
      .limit(Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200))
      .lean();
    return res.json({ success: true, data: requests });
  } catch (error) {
    console.error('getMyRequests (week off) error:', error.message);
    return fail(res, 500, 'Could not load your weekly off requests.');
  }
};

/** DELETE /week-off/request/:id — withdraw a request that nobody has acted on yet. */
const cancelRequest = async (req, res) => {
  try {
    const userId = String(req.user._id || req.user.id);
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'Invalid request id.');
    const request = await WeekOffRequest.findById(req.params.id);
    if (!request) return fail(res, 404, 'Request not found.');
    if (String(request.user) !== userId) return fail(res, 403, 'This is not your request.');
    if (request.status !== 'Pending') return fail(res, 400, `This request is already ${request.status.toLowerCase()}.`);
    await request.deleteOne();
    return res.json({ success: true, message: 'Weekly off request withdrawn.' });
  } catch (error) {
    console.error('cancelRequest (week off) error:', error.message);
    return fail(res, 500, 'Could not withdraw the request.');
  }
};

/** GET /week-off/admin-requests?status=Pending — for whoever may approve. */
const getAdminRequests = async (req, res) => {
  try {
    const companyCode = companyCodeOf(req.user);
    const company = companyOf(req.user);
    const filter = company ? { $or: [{ company }, { companyCode }] } : { companyCode };
    if (req.query?.status && req.query.status !== 'All') filter.status = String(req.query.status);
    if (req.query?.month && /^\d{4}-\d{2}$/.test(String(req.query.month))) {
      const { from, to } = monthRange(req.query.month);
      filter.weekStartKey = { $gte: weekStartKeyOf(addDaysToKey(from, -7)), $lte: weekStartKeyOf(to) };
    }
    const requests = await WeekOffRequest.find(filter)
      .populate('user', 'name email employeeId department departmentName weekOffDays')
      .populate('reviewedBy', 'name')
      .sort({ status: 1, weekStartKey: -1, createdAt: -1 })
      .limit(Math.min(Math.max(parseInt(req.query?.limit, 10) || 100, 1), 300))
      .lean();
    const pendingCount = await WeekOffRequest.countDocuments({ ...filter, status: 'Pending' });
    return res.json({ success: true, data: requests, pendingCount });
  } catch (error) {
    console.error('getAdminRequests (week off) error:', error.message);
    return fail(res, 500, 'Could not load weekly off requests.');
  }
};

/** PUT /week-off/admin-action/:id — approve or reject. */
const reviewRequest = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'Invalid request id.');
    const action = String(req.body?.action || '').toLowerCase();
    if (!['approve', 'reject'].includes(action)) return fail(res, 400, 'Choose approve or reject.');

    const request = await WeekOffRequest.findById(req.params.id);
    if (!request) return fail(res, 404, 'Request not found.');

    const company = companyOf(req.user);
    const sameCompany = (company && String(request.company || '') === String(company))
      || (companyCodeOf(req.user) && request.companyCode === companyCodeOf(req.user));
    if (!sameCompany) return fail(res, 403, 'This request belongs to another company.');
    if (request.status !== 'Pending') return fail(res, 400, `This request is already ${request.status.toLowerCase()}.`);

    if (action === 'approve') {
      // Re-check against what is approved now: an earlier approval may have moved the same week.
      const userDoc = await User.findById(request.user).select('name weekOffDays department departmentName company companyCode').lean();
      if (!userDoc) return fail(res, 404, 'The employee no longer exists.');
      const department = await departmentOf({ ...userDoc, company: request.company || userDoc.company });
      const weekEndKey = addDaysToKey(request.weekStartKey, 6);
      const swaps = await approvedSwapsFor(request.user, request.weekStartKey, weekEndKey);
      const check = validateSwap({
        department,
        weekOffDays: userDoc.weekOffDays,
        swaps,
        toDate: request.toDateKey,
        fromDate: request.fromDateKey,
      });
      if (!check.ok) return fail(res, 400, `Cannot approve: ${check.message}`);
    }

    request.status = action === 'approve' ? 'Approved' : 'Rejected';
    request.reviewedBy = req.user._id || req.user.id;
    request.reviewedAt = new Date();
    request.reviewRemarks = String(req.body?.remarks || '').trim().slice(0, 500);
    await request.save();

    try {
      await notifyDirectUsers({
        userIds: [String(request.user)],
        type: 'week_off_request',
        title: request.status === 'Approved' ? 'Weekly Off Approved' : 'Weekly Off Rejected',
        message: request.status === 'Approved'
          ? `Your weekly off has been moved to ${weekdayName(weekdayOfKey(request.toDateKey))} ${request.toDateKey}.`
          : `Your weekly off change for ${request.toDateKey} was rejected.${request.reviewRemarks ? ` Reason: ${request.reviewRemarks}` : ''}`,
        targetPath: '/ciisUser/attendance',
        targetScreen: 'Attendance',
        actor: req.user._id || req.user.id,
        company: request.company || companyOf(req.user),
        data: {
          requestId: request._id,
          status: request.status,
          fromDateKey: request.fromDateKey,
          toDateKey: request.toDateKey,
        },
        priority: 'medium',
      });
    } catch (notifyError) {
      console.error('Failed to notify employee of week off decision:', notifyError.message);
    }

    return res.json({ success: true, message: `Weekly off request ${request.status.toLowerCase()}.`, data: request });
  } catch (error) {
    console.error('reviewRequest (week off) error:', error.message);
    return fail(res, 500, 'Could not update the request.');
  }
};

/** GET /week-off/employees — every employee's fixed weekly off, for the admin screen. */
const getEmployeeSettings = async (req, res) => {
  try {
    const company = companyOf(req.user);
    const companyCode = companyCodeOf(req.user);
    const filter = company ? { company } : { companyCode };
    if (req.query?.search) {
      const pattern = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }, { employeeId: pattern }];
    }
    const users = await User.find({ ...filter, isActive: { $ne: false } })
      .select('name email employeeId department departmentName weekOffDays')
      .sort({ name: 1 })
      .limit(Math.min(Math.max(parseInt(req.query?.limit, 10) || 200, 1), 500))
      .lean();

    const departments = await Department.find(company ? { company } : { companyCode })
      .select('name workingDays workingDayHistory')
      .lean();
    const byId = new Map(departments.map(item => [String(item._id), item]));
    const byName = new Map(departments.map(item => [String(item.name || '').toLowerCase(), item]));
    const today = dateKeyOf(new Date());

    const items = users.map(user => {
      const raw = String(user.department || user.departmentName || '');
      const department = byId.get(raw) || byName.get(raw.toLowerCase()) || null;
      const entitlement = weekOffEntitlement(department, today);
      const weekOffDays = normalizeWeekOffDays(user.weekOffDays, entitlement);
      return {
        userId: String(user._id),
        name: user.name || '',
        email: user.email || '',
        employeeId: user.employeeId || '',
        departmentName: department?.name || user.departmentName || raw,
        workingDays: effectiveWorkingDays(department, today),
        entitlement,
        weekOffDays,
        weekOffDayNames: weekOffDays.map(weekdayName),
        usingDefault: weekOffDays.length === 0,
      };
    });
    return res.json({ success: true, data: items });
  } catch (error) {
    console.error('getEmployeeSettings (week off) error:', error.message);
    return fail(res, 500, 'Could not load the weekly off settings.');
  }
};

/** PUT /week-off/employees/:userId — set (or clear) an employee's fixed weekly off day(s). */
const updateEmployeeSettings = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return fail(res, 400, 'Invalid employee id.');
    const company = companyOf(req.user);
    const companyCode = companyCodeOf(req.user);
    const user = await User.findById(req.params.userId).select('name company companyCode department departmentName weekOffDays');
    if (!user) return fail(res, 404, 'Employee not found.');
    const sameCompany = (company && String(user.company || '') === String(company))
      || (companyCode && user.companyCode === companyCode);
    if (!sameCompany) return fail(res, 403, 'This employee belongs to another company.');

    const raw = req.body?.weekOffDays;
    if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
      return fail(res, 400, 'Send weekOffDays as a list of weekdays (1 = Monday … 7 = Sunday).');
    }
    const requested = normalizeWeekOffDays(raw, 7);
    if (Array.isArray(raw) && raw.length && requested.length !== [...new Set(raw.map(Number))].length) {
      return fail(res, 400, 'Weekly off days must be numbers from 1 (Monday) to 7 (Sunday).');
    }

    const department = await departmentOf({ ...user.toObject(), company: user.company || company });
    const entitlement = weekOffEntitlement(department, dateKeyOf(new Date()));
    if (requested.length > entitlement) {
      return fail(res, 400, entitlement === 0
        ? 'This department works all seven days, so no weekly off can be set.'
        : `This department allows ${entitlement} weekly off${entitlement === 1 ? '' : 's'}, so pick at most ${entitlement} day${entitlement === 1 ? '' : 's'}.`);
    }

    user.weekOffDays = requested;
    await user.save();

    if (requested.length) {
      try {
        await notifyDirectUsers({
          userIds: [String(user._id)],
          type: 'week_off_request',
          title: 'Weekly Off Updated',
          message: `Your weekly off is now ${requested.map(weekdayName).join(', ')}.`,
          targetPath: '/ciisUser/attendance',
          targetScreen: 'Attendance',
          actor: req.user._id || req.user.id,
          company: user.company || company,
          data: { weekOffDays: requested },
          priority: 'low',
        });
      } catch (notifyError) {
        console.error('Failed to notify employee of week off change:', notifyError.message);
      }
    }

    return res.json({
      success: true,
      message: requested.length
        ? `Weekly off set to ${requested.map(weekdayName).join(', ')}.`
        : 'Weekly off cleared; the department default applies.',
      data: {
        userId: String(user._id),
        weekOffDays: requested,
        weekOffDayNames: requested.map(weekdayName),
        entitlement,
      },
    });
  } catch (error) {
    console.error('updateEmployeeSettings (week off) error:', error.message);
    return fail(res, 500, 'Could not update the weekly off.');
  }
};

module.exports = {
  getMySchedule,
  createRequest,
  getMyRequests,
  cancelRequest,
  getAdminRequests,
  reviewRequest,
  getEmployeeSettings,
  updateEmployeeSettings,
  // exported for other modules that need the same resolution
  departmentOf,
  approvedSwapsFor,
  weekdayName,
};
