const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const User = require('../../models/User');
const Company = require('../../models/Company');
const Branch = require('../../models/Branch');
const Department = require('../../models/Department');
const JobRole = require('../../models/JobRole');
const { notifyPageUsers, getCompanyId } = require('../utils/systemNotificationService');
const {
  normalizeBreakPolicy,
  resolveBreakPolicy,
  fixedWindowsFor,
  classifyBreak,
  shouldNotifyAdmin,
  breakTotalsFor,
  canStartBreak,
  dateKeyOf,
} = require('../utils/breaks');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

const companyOf = user => user?.company?._id || user?.company || user?.companyId || null;
const companyCodeOf = user => user?.companyCode || user?.company?.companyCode || '';

const formatDuration = ms => {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
};

const indiaDayRange = (value = new Date()) => {
  const key = dateKeyOf(value);
  const start = new Date(new Date(`${key}T00:00:00.000Z`).getTime() - INDIA_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { key, start, end };
};

/** Every level's stored policy for this employee, most specific first. */
const policyLevelsFor = async (user) => {
  const company = companyOf(user);
  const companyCode = companyCodeOf(user);
  const [companyDoc, branchDoc, departmentDoc, jobRoleDoc] = await Promise.all([
    company
      ? Company.findById(company).select('breakPolicy companyCode').lean()
      : (companyCode ? Company.findOne({ companyCode }).select('breakPolicy companyCode').lean() : null),
    user?.branch && mongoose.isValidObjectId(String(user.branch))
      ? Branch.findById(user.branch).select('breakPolicy name').lean()
      : null,
    user?.department && mongoose.isValidObjectId(String(user.department))
      ? Department.findById(user.department).select('breakPolicy name').lean()
      : null,
    user?.jobRole && mongoose.isValidObjectId(String(user.jobRole))
      ? JobRole.findById(user.jobRole).select('breakPolicy name').lean()
      : null,
  ]);
  return {
    jobRole: jobRoleDoc?.breakPolicy,
    department: departmentDoc?.breakPolicy,
    branch: branchDoc?.breakPolicy,
    company: companyDoc?.breakPolicy,
    names: {
      company: companyDoc?.companyCode || '',
      branch: branchDoc?.name || '',
      department: departmentDoc?.name || '',
      jobRole: jobRoleDoc?.name || '',
    },
  };
};

const policyForUser = async (user) => {
  const levels = await policyLevelsFor(user);
  return { policy: resolveBreakPolicy(levels), levels };
};

const todayRecordFor = async (userId, now = new Date()) => {
  const { start, end } = indiaDayRange(now);
  let record = await Attendance.findOne({ user: userId, date: { $gte: start, $lte: end } });
  if (!record) {
    // A night shift clock-in from yesterday that is still open.
    record = await Attendance.findOne({ user: userId, isClockedIn: true, inTime: { $lte: now } }).sort({ inTime: -1 });
  }
  return record;
};

/** What the app and the web show: the policy, today's breaks and the live totals. */
const buildState = (record, policy, now = new Date()) => {
  const breaks = (record?.breaks || []).map(entry => ({
    type: entry.type,
    label: entry.label,
    start: entry.start,
    end: entry.end || null,
    minutes: entry.minutes || 0,
  }));
  const totals = breakTotalsFor({
    policy,
    breaks,
    inTime: record?.inTime || null,
    outTime: record?.outTime || null,
    now,
  });
  const running = breaks.find(entry => !entry.end) || null;
  const grossMs = record?.inTime
    ? Math.max(0, (record.outTime ? new Date(record.outTime).getTime() : now.getTime()) - new Date(record.inTime).getTime())
    : 0;
  const workedMs = Math.max(0, grossMs - totals.totalMs);

  return {
    policy: {
      mode: policy.mode,
      source: policy.source,
      fixedBreaks: policy.fixedBreaks,
      allowExtraBreak: policy.allowExtraBreak,
      notifyAdmin: policy.notifyAdmin,
      limits: policy.limits,
    },
    isClockedIn: Boolean(record?.isClockedIn),
    onBreak: Boolean(running),
    runningBreak: running,
    breaks,
    breakMinutes: totals.totalMinutes,
    punchedBreakMinutes: totals.manualMinutes,
    autoBreakMinutes: totals.autoMinutes,
    breakCount: totals.count,
    grossTime: formatDuration(grossMs),
    workingTime: formatDuration(workedMs),
    workingSeconds: Math.floor(workedMs / 1000),
    // The client counts up from here and freezes while a break is running.
    inTime: record?.inTime || null,
    outTime: record?.outTime || null,
    nextFixedBreak: fixedWindowsFor(policy, record?.inTime || now)
      .filter(window => window.endTime > now.getTime())
      .map(window => ({ name: window.name, start: window.start, end: window.end }))[0] || null,
  };
};

/** Keep the stored record in step with the breaks taken. */
const applyBreakTotals = (record, policy, now = new Date()) => {
  const totals = breakTotalsFor({
    policy,
    breaks: record.breaks || [],
    inTime: record.inTime,
    outTime: record.outTime,
    now,
  });
  record.breakMinutes = totals.totalMinutes;
  record.onBreak = totals.onBreak;
  if (record.inTime) {
    const until = record.outTime ? new Date(record.outTime).getTime() : now.getTime();
    const grossMs = Math.max(0, until - new Date(record.inTime).getTime());
    record.grossTime = formatDuration(grossMs);
    if (record.outTime) record.totalTime = formatDuration(Math.max(0, grossMs - totals.totalMs));
  }
  return totals;
};

const notifyBreak = async ({ req, record, policy, entry, phase }) => {
  if (!shouldNotifyAdmin(policy, entry.type)) return;
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) return;
    const name = req.user?.name || 'An employee';
    const minutes = entry.minutes || 0;
    await notifyPageUsers({
      companyId,
      targetPath: '/ciisUser/emp-attendance',
      targetScreen: 'Employee Attendance',
      excludeUserIds: [String(req.user._id || req.user.id)],
      type: 'break_update',
      title: phase === 'start' ? 'Break started' : 'Break ended',
      message: phase === 'start'
        ? `${name} started a ${entry.type === 'EXTRA' ? 'extra ' : ''}break.`
        : `${name} ended their break after ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      actor: req.user._id || req.user.id,
      data: {
        userId: String(req.user._id || req.user.id),
        userName: name,
        attendanceId: String(record._id),
        breakType: entry.type,
        label: entry.label,
        phase,
        minutes,
      },
      priority: 'low',
    });
  } catch (error) {
    console.error('Failed to notify admin of break:', error.message);
  }
};

/** GET /breaks/today */
exports.getToday = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userDoc = await User.findById(userId).select('name company companyCode branch department jobRole').lean();
    const { policy } = await policyForUser({ ...userDoc, company: companyOf(req.user) || userDoc?.company });
    const now = new Date();
    const record = policy.mode === 'OFF' ? null : await todayRecordFor(userId, now);
    return res.json({ success: true, ...buildState(record, policy, now) });
  } catch (error) {
    console.error('getToday (breaks) error:', error.message);
    return fail(res, 500, 'Could not load your break status.');
  }
};

/** POST /breaks/start */
exports.startBreak = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userDoc = await User.findById(userId).select('name company companyCode branch department jobRole').lean();
    const { policy } = await policyForUser({ ...userDoc, company: companyOf(req.user) || userDoc?.company });
    if (policy.mode === 'OFF') return fail(res, 400, 'Break tracking is off for your company.');

    const now = new Date();
    const record = await todayRecordFor(userId, now);
    if (!record || !record.isClockedIn) {
      return fail(res, 400, 'Clock in first, then start your break.');
    }

    const check = canStartBreak({
      policy,
      breaks: record.breaks || [],
      inTime: record.inTime,
      now,
      isClockedIn: Boolean(record.isClockedIn),
    });
    if (!check.ok) return fail(res, 400, check.message);

    const kind = classifyBreak(policy, now);
    const entry = { type: kind.type, label: kind.label, start: now, end: null, minutes: 0, notified: false };
    record.breaks = [...(record.breaks || []), entry];
    applyBreakTotals(record, policy, now);
    await record.save();

    const saved = record.breaks[record.breaks.length - 1];
    await notifyBreak({ req, record, policy, entry: saved, phase: 'start' });

    return res.json({
      success: true,
      message: check.warning ? `Break started. ${check.warning}` : `${kind.label} started.`,
      warning: check.warning || '',
      ...buildState(record, policy, now),
    });
  } catch (error) {
    console.error('startBreak error:', error.message);
    return fail(res, 500, 'Could not start the break.');
  }
};

/** POST /breaks/stop */
exports.stopBreak = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userDoc = await User.findById(userId).select('name company companyCode branch department jobRole').lean();
    const { policy } = await policyForUser({ ...userDoc, company: companyOf(req.user) || userDoc?.company });
    const now = new Date();
    const record = await todayRecordFor(userId, now);
    const running = (record?.breaks || []).find(entry => entry.start && !entry.end);
    if (!record || !running) return fail(res, 400, 'No break is running.');

    running.end = now;
    running.minutes = Math.max(0, Math.round((now.getTime() - new Date(running.start).getTime()) / MINUTE_MS));
    applyBreakTotals(record, policy, now);
    await record.save();

    await notifyBreak({ req, record, policy, entry: running, phase: 'end' });

    return res.json({
      success: true,
      message: `Break ended after ${running.minutes} minute${running.minutes === 1 ? '' : 's'}.`,
      ...buildState(record, policy, now),
    });
  } catch (error) {
    console.error('stopBreak error:', error.message);
    return fail(res, 500, 'Could not end the break.');
  }
};

const LEVEL_MODELS = {
  company: { model: Company, label: 'Company' },
  branch: { model: Branch, label: 'Branch' },
  department: { model: Department, label: 'Department' },
  jobRole: { model: JobRole, label: 'Shift / Job role' },
};

/** GET /breaks/settings — every level's policy for this company, so the admin can see the chain. */
exports.getSettings = async (req, res) => {
  try {
    const company = companyOf(req.user);
    const companyCode = companyCodeOf(req.user);
    const scope = company ? { company } : { companyCode };
    const companyDoc = company
      ? await Company.findById(company).select('breakPolicy companyName companyCode').lean()
      : await Company.findOne({ companyCode }).select('breakPolicy companyName companyCode').lean();
    if (!companyDoc) return fail(res, 404, 'Company not found.');

    const [branches, departments, jobRoles] = await Promise.all([
      Branch.find(scope).select('name breakPolicy').sort({ name: 1 }).lean(),
      Department.find(scope).select('name breakPolicy').sort({ name: 1 }).lean(),
      JobRole.find(scope).select('name breakPolicy').sort({ name: 1 }).lean(),
    ]);

    const shape = (doc, level) => ({
      level,
      id: String(doc._id),
      name: doc.name || doc.companyName || doc.companyCode || '',
      policy: normalizeBreakPolicy(doc.breakPolicy || {}),
    });

    return res.json({
      success: true,
      company: shape(companyDoc, 'company'),
      branches: branches.map(doc => shape(doc, 'branch')),
      departments: departments.map(doc => shape(doc, 'department')),
      jobRoles: jobRoles.map(doc => shape(doc, 'jobRole')),
      modes: ['INHERIT', 'OFF', 'FIXED', 'FLEXIBLE'],
    });
  } catch (error) {
    console.error('getSettings (breaks) error:', error.message);
    return fail(res, 500, 'Could not load the break settings.');
  }
};

/** PUT /breaks/settings/:level/:id — set one level's policy. */
exports.updateSettings = async (req, res) => {
  try {
    const level = String(req.params.level || '');
    const target = LEVEL_MODELS[level];
    if (!target) return fail(res, 400, 'Choose company, branch, department or jobRole.');
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'Invalid id.');

    const doc = await target.model.findById(req.params.id);
    if (!doc) return fail(res, 404, `${target.label} not found.`);

    const company = companyOf(req.user);
    const companyCode = companyCodeOf(req.user);
    const docCompany = level === 'company' ? doc._id : doc.company;
    const sameCompany = (company && String(docCompany || '') === String(company))
      || (companyCode && String(doc.companyCode || '') === String(companyCode));
    if (!sameCompany) return fail(res, 403, `This ${target.label.toLowerCase()} belongs to another company.`);

    const policy = normalizeBreakPolicy(req.body?.policy || req.body || {});
    if (policy.mode === 'FIXED' && policy.fixedBreaks.length === 0) {
      return fail(res, 400, 'Add at least one break window (start and end time) for a fixed break schedule.');
    }
    const requestedBreaks = Array.isArray((req.body?.policy || req.body || {}).fixedBreaks)
      ? (req.body?.policy || req.body).fixedBreaks.length
      : 0;
    if (policy.mode === 'FIXED' && requestedBreaks > policy.fixedBreaks.length) {
      return fail(res, 400, 'Every break window needs a start and an end time, with the end after the start.');
    }

    doc.breakPolicy = {
      ...policy,
      updatedBy: req.user._id || req.user.id,
      updatedAt: new Date(),
    };
    await doc.save();

    return res.json({
      success: true,
      message: policy.mode === 'INHERIT'
        ? `${target.label} now follows the level above.`
        : `Break setting saved for this ${target.label.toLowerCase()}.`,
      data: { level, id: String(doc._id), policy: normalizeBreakPolicy(doc.breakPolicy) },
    });
  } catch (error) {
    console.error('updateSettings (breaks) error:', error.message);
    return fail(res, 500, 'Could not save the break settings.');
  }
};

/** GET /breaks/live — who is on a break right now, and today's break totals. */
exports.getLive = async (req, res) => {
  try {
    const company = companyOf(req.user);
    const companyCode = companyCodeOf(req.user);
    const now = new Date();
    const { start, end } = indiaDayRange(now);
    const scope = company ? { company } : { companyCode };
    const users = await User.find({ ...scope, isActive: { $ne: false } })
      // company and companyCode are needed to resolve each person's policy, not just to show them.
      .select('name employeeId department departmentName branch jobRole company companyCode')
      .lean();
    const userIds = users.map(user => user._id);
    const records = await Attendance.find({ user: { $in: userIds }, date: { $gte: start, $lte: end } })
      .select('user inTime outTime isClockedIn breaks breakMinutes onBreak totalTime grossTime')
      .lean();
    const byUser = new Map(records.map(record => [String(record.user), record]));

    const items = [];
    for (const user of users) {
      const record = byUser.get(String(user._id));
      if (!record) continue;
      const { policy } = await policyForUser(user);
      if (policy.mode === 'OFF') continue;
      const totals = breakTotalsFor({
        policy,
        breaks: record.breaks || [],
        inTime: record.inTime,
        outTime: record.outTime,
        now,
      });
      const running = (record.breaks || []).find(entry => entry.start && !entry.end) || null;
      items.push({
        userId: String(user._id),
        name: user.name || '',
        employeeId: user.employeeId || '',
        departmentName: user.departmentName || '',
        mode: policy.mode,
        onBreak: Boolean(running),
        runningSince: running?.start || null,
        runningLabel: running?.label || '',
        breakMinutes: totals.totalMinutes,
        punchedMinutes: totals.manualMinutes,
        autoMinutes: totals.autoMinutes,
        breakCount: totals.count,
        workingTime: record.totalTime || '00:00:00',
      });
    }

    items.sort((a, b) => Number(b.onBreak) - Number(a.onBreak) || b.breakMinutes - a.breakMinutes);
    return res.json({
      success: true,
      date: dateKeyOf(now),
      onBreakNow: items.filter(item => item.onBreak).length,
      items,
    });
  } catch (error) {
    console.error('getLive (breaks) error:', error.message);
    return fail(res, 500, 'Could not load the break report.');
  }
};

module.exports.policyForUser = policyForUser;
module.exports.policyLevelsFor = policyLevelsFor;
module.exports.applyBreakTotals = applyBreakTotals;
module.exports.buildState = buildState;
