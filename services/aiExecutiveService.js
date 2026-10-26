const mongoose = require('mongoose');
const Task = require('../HR-CDS/models/Task');
const Attendance = require('../HR-CDS/models/Attendance');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Department = require('../models/Department');
const thresholds = require('../config/aiExecutiveThresholds');
const {
  getCompanyScope,
  istDayStart,
  istDateString,
} = require('./ai/aiMetricsService');

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUSES = ['completed', 'approved'];
const PRESENT_STATUSES = ['PRESENT', 'LATE', 'HALF DAY', 'HALFDAY', 'SHORT LEAVE'];
const ABSENT_STATUSES = ['ABSENT', 'UNINFORMED LEAVE', 'UNINFORMEDLEAVE'];

// In-memory cache & concurrent request coalescing
const memoryCache = new Map();
const inFlightRequests = new Map();

/**
 * Math & string helpers
 */
function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function round1(n) {
  return n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10;
}

/**
 * Safely parse "HH:mm:ss" or "H:m:s" string into total minutes.
 * Returns 0 on empty, invalid, or malformed strings.
 */
function hmsToMinutes(value) {
  if (!value || typeof value !== 'string') return 0;
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
}

/**
 * Compute ISO date (YYYY-MM-DD) for start of week (Monday) in IST
 */
function getIstMondayDateString(date) {
  const shifted = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const day = shifted.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const mondayUtc = new Date(shifted.getTime() + diffToMonday * DAY_MS);
  return mondayUtc.toISOString().slice(0, 10);
}

/**
 * Generate weekly slot dates from rangeStart to now in IST
 */
function generateIstWeeklySlots(rangeStart, now) {
  const slots = [];
  const startMondayStr = getIstMondayDateString(rangeStart);
  let cur = new Date(startMondayStr + 'T00:00:00.000Z');
  const nowMondayStr = getIstMondayDateString(now);
  const endLimit = new Date(nowMondayStr + 'T23:59:59.999Z');

  while (cur <= endLimit) {
    slots.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 7 * DAY_MS);
  }
  return slots;
}

/**
 * Cache key generator
 */
function getCacheKey(companyId, range, department) {
  const dept = String(department || 'all').trim();
  return `${companyId}:${range}:${dept}`;
}

/**
 * Clear in-memory cache (useful for testing and manual flushes)
 */
function clearExecutiveCache() {
  memoryCache.clear();
  inFlightRequests.clear();
}

/**
 * Core deterministic aggregation engine. NO LLM CALLS INSIDE.
 */
async function computeExecutiveInsights({ scope, range, department = 'all', now = new Date() }) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const rangeStart = new Date(istDayStart(now).getTime() - (days - 1) * DAY_MS);
  const rangeEnd = now;
  const endOfToday = new Date(istDayStart(now).getTime() + DAY_MS - 1);

  // Department validation & scoping
  let targetDeptId = null;
  let targetDeptDoc = null;
  const deptStr = String(department || 'all').trim();

  if (deptStr !== 'all') {
    if (mongoose.Types.ObjectId.isValid(deptStr)) {
      targetDeptId = new mongoose.Types.ObjectId(deptStr);
      targetDeptDoc = await Department.findOne({ _id: targetDeptId, company: scope.companyObjectId }).lean();
      if (!targetDeptDoc) {
        // Also check if any user has this string as department
        const userWithDept = await User.exists({ company: scope.companyObjectId, department: deptStr });
        if (!userWithDept) {
          const err = new Error('Department not found or does not belong to user company.');
          err.code = 'INVALID_DEPARTMENT';
          throw err;
        }
      }
    } else {
      // String department name (e.g. "Management")
      const userWithDept = await User.exists({ company: scope.companyObjectId, department: deptStr });
      if (!userWithDept) {
        const err = new Error(`Department "${deptStr}" not found for this company.`);
        err.code = 'INVALID_DEPARTMENT';
        throw err;
      }
    }
  }

  // Pre-fetch active non-client users in company (and department if filtered)
  const userFilter = {
    company: scope.companyObjectId,
    isActive: true,
    companyRole: { $nin: ['client', 'Client'] },
  };
  if (deptStr !== 'all') {
    userFilter.department = targetDeptId || deptStr;
  }

  const activeUsersPromise = User.find(userFilter)
    .select('_id name department departmentName companyRole jobRole')
    .lean();

  // If department filtered, fetch department user IDs for task/crm/attendance filtering
  let deptUserIds = null;
  if (deptStr !== 'all') {
    const deptUsers = await User.find({
      company: scope.companyObjectId,
      department: targetDeptId || deptStr,
    }).select('_id').lean();
    deptUserIds = deptUsers.map((u) => u._id);
  }

  // Base Task Match (Cohort: dueDateTime falls inside [rangeStart, now])
  const taskCohortMatch = {
    companyCode: scope.companyCodeFilter,
    isActive: { $ne: false },
    overallStatus: { $ne: 'cancelled' },
    dueDateTime: { $gte: rangeStart, $lte: now },
  };
  if (deptUserIds) {
    taskCohortMatch.assignedUsers = { $in: deptUserIds };
  }

  // Common expressions for aggregations
  const doneExpr = { $in: ['$overallStatus', DONE_STATUSES] };
  const hasCompletion = { $gt: ['$completionDate', null] };
  const onTimeExpr = { $and: [doneExpr, hasCompletion, { $lte: ['$completionDate', '$dueDateTime'] }] };
  const reopenExpr = {
    $or: [
      { $eq: ['$overallStatus', 'reopen'] },
      {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ['$statusHistory', []] },
                as: 'h',
                cond: { $eq: ['$$h.status', 'reopen'] },
              },
            },
          },
          0,
        ],
      },
    ],
  };
  const turnaroundExpr = {
    $cond: [
      { $and: [doneExpr, hasCompletion, { $gt: ['$createdAt', null] }] },
      { $subtract: ['$completionDate', '$createdAt'] },
      null,
    ],
  };

  // Run all primary aggregations in parallel with timing instrumentation
  const timings = {};
  const tStartAll = Date.now();

  const timed = async (name, promiseFn) => {
    const t0 = Date.now();
    const res = await promiseFn();
    timings[name] = Date.now() - t0;
    return res;
  };

  const [
    activeUsers,
    taskFacetRes,
    velocityAssignedRes,
    velocityCompletedRes,
    attendanceAggRes,
    crmAggRes,
  ] = await Promise.all([
    timed('users', () => activeUsersPromise),

    // 1. Task Cohort Facet: overview (NO $unwind), departmentSLA ($unwind), slowModules, byUser ($unwind)
    timed('tasks', () => Task.aggregate([
      { $match: taskCohortMatch },
      {
        $facet: {
          // Company-wide Overview: NEVER $unwind assignedUsers (avoids double counting multi-assignee tasks)
          overview: [
            {
              $group: {
                _id: null,
                cohortSize: { $sum: 1 },
                completed: { $sum: { $cond: [doneExpr, 1, 0] } },
                onTime: { $sum: { $cond: [onTimeExpr, 1, 0] } },
                overdue: { $sum: { $cond: [doneExpr, 0, 1] } }, // live: dueDateTime <= now and not completed
                reopened: { $sum: { $cond: [reopenExpr, 1, 0] } },
                avgTurnaroundMs: { $avg: turnaroundExpr },
              },
            },
          ],

          // Department SLA breakdown: $unwind assignedUsers
          departmentSLA: [
            { $unwind: '$assignedUsers' },
            {
              $lookup: {
                from: User.collection.name,
                localField: 'assignedUsers',
                foreignField: '_id',
                as: 'u',
              },
            },
            { $unwind: '$u' },
            { $match: { 'u.company': scope.companyObjectId } },
            ...(targetDeptId ? [{ $match: { 'u.department': targetDeptId } }] : []),
            {
              $group: {
                _id: '$u.department',
                assigned: { $sum: 1 },
                completed: { $sum: { $cond: [doneExpr, 1, 0] } },
                onTime: { $sum: { $cond: [onTimeExpr, 1, 0] } },
                overdue: { $sum: { $cond: [doneExpr, 0, 1] } },
                avgTurnaroundMs: { $avg: turnaroundExpr },
              },
            },
            {
              $lookup: {
                from: Department.collection.name,
                localField: '_id',
                foreignField: '_id',
                as: 'dept',
              },
            },
            { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                departmentId: '$_id',
                department: {
                  $cond: [
                    { $ne: ['$dept.name', null] },
                    '$dept.name',
                    {
                      $cond: [
                        { $and: [{ $ne: ['$_id', null] }, { $ne: ['$_id', ''] }] },
                        { $toString: '$_id' },
                        'Unassigned',
                      ],
                    },
                  ],
                },
                assigned: 1,
                completed: 1,
                onTime: 1,
                overdue: 1,
                avgTurnaroundMs: 1,
              },
            },
            { $sort: { overdue: -1, assigned: -1 } },
            { $limit: 50 },
          ],

          // Slow Modules: group by department primarily, title bracket prefix secondary
          slowModules: [
            { $unwind: '$assignedUsers' },
            {
              $lookup: {
                from: User.collection.name,
                localField: 'assignedUsers',
                foreignField: '_id',
                as: 'u',
              },
            },
            { $unwind: '$u' },
            { $match: { 'u.company': scope.companyObjectId } },
            ...(deptStr !== 'all' ? [{ $match: { 'u.department': targetDeptId || deptStr } }] : []),
            {
              $lookup: {
                from: Department.collection.name,
                localField: 'u.department',
                foreignField: '_id',
                as: 'dept',
              },
            },
            { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                deptName: {
                  $cond: [
                    { $ne: ['$dept.name', null] },
                    '$dept.name',
                    {
                      $cond: [
                        { $and: [{ $ne: ['$u.department', null] }, { $ne: ['$u.department', ''] }] },
                        { $toString: '$u.department' },
                        'Unassigned',
                      ],
                    },
                  ],
                },
                title: '$title',
                bracketMatch: {
                  $regexFind: {
                    input: '$title',
                    regex: '^\\s*\\[([^\\]]+)\\]',
                  },
                },
                // Delay in hours: if completed, completionDate - dueDateTime; if overdue, now - dueDateTime
                delayHours: {
                  $let: {
                    vars: {
                      effectiveFinish: {
                        $cond: [doneExpr, '$completionDate', now],
                      },
                    },
                    in: {
                      $cond: [
                        { $gt: ['$$effectiveFinish', '$dueDateTime'] },
                        {
                          $divide: [
                            { $subtract: ['$$effectiveFinish', '$dueDateTime'] },
                            3600000,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                },
              },
            },
            {
              $project: {
                deptName: 1,
                prefix: { $arrayElemAt: ['$bracketMatch.captures', 0] },
                delayHours: 1,
              },
            },
            {
              $project: {
                deptName: 1,
                moduleKey: {
                  $cond: [
                    { $and: [{ $ne: ['$prefix', null] }, { $ne: ['$prefix', ''] }] },
                    { $concat: ['$deptName', ' [', '$prefix', ']'] },
                    '$deptName',
                  ],
                },
                delayHours: 1,
              },
            },
            {
              $group: {
                _id: '$moduleKey',
                department: { $first: '$deptName' },
                totalTasks: { $sum: 1 },
                delayedTasksCount: { $sum: { $cond: [{ $gt: ['$delayHours', 0] }, 1, 0] } },
                avgDelayHours: { $avg: '$delayHours' },
              },
            },
            { $sort: { avgDelayHours: -1 } },
            { $limit: 5 },
          ],

          // Team Load raw counts per assignee: $unwind assignedUsers
          byUser: [
            { $unwind: '$assignedUsers' },
            {
              $group: {
                _id: '$assignedUsers',
                assigned: { $sum: 1 },
                completed: { $sum: { $cond: [doneExpr, 1, 0] } },
                overdue: { $sum: { $cond: [doneExpr, 0, 1] } },
              },
            },
          ],
        },
      },
    ], { allowDiskUse: true })),

    // 2. Velocity Assigned: tasks created in [rangeStart, now] grouped by IST week of createdAt
    timed('velocityAssigned', () => Task.aggregate([
      {
        $match: {
          companyCode: scope.companyCodeFilter,
          isActive: { $ne: false },
          overallStatus: { $ne: 'cancelled' },
          createdAt: { $gte: rangeStart, $lte: now },
          ...(deptUserIds ? { assignedUsers: { $in: deptUserIds } } : {}),
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: {
                $dateTrunc: {
                  date: '$createdAt',
                  unit: 'week',
                  timezone: 'Asia/Kolkata',
                  startOfWeek: 'monday',
                },
              },
              timezone: 'Asia/Kolkata',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ], { allowDiskUse: true })),

    // 3. Velocity Completed: tasks completed in [rangeStart, now] grouped by IST week of completionDate
    timed('velocityCompleted', () => Task.aggregate([
      {
        $match: {
          companyCode: scope.companyCodeFilter,
          isActive: { $ne: false },
          overallStatus: { $in: DONE_STATUSES },
          completionDate: { $gte: rangeStart, $lte: now },
          ...(deptUserIds ? { assignedUsers: { $in: deptUserIds } } : {}),
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: {
                $dateTrunc: {
                  date: '$completionDate',
                  unit: 'week',
                  timezone: 'Asia/Kolkata',
                  startOfWeek: 'monday',
                },
              },
              timezone: 'Asia/Kolkata',
            },
          },
          completed: { $sum: 1 },
          onTime: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$dueDateTime', null] },
                    { $lte: ['$completionDate', '$dueDateTime'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ], { allowDiskUse: true })),

    // 4. Attendance: companyCode filter, range [rangeStart, endOfToday]
    timed('attendance', () => Attendance.aggregate([
      {
        $match: {
          companyCode: scope.companyCodeFilter,
          date: { $gte: rangeStart, $lte: endOfToday },
          ...(deptUserIds ? { user: { $in: deptUserIds } } : {}),
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'user',
          foreignField: '_id',
          as: 'u',
        },
      },
      { $unwind: '$u' },
      { $match: { 'u.company': scope.companyObjectId } },
      ...(targetDeptId ? [{ $match: { 'u.department': targetDeptId } }] : []),
      {
        $project: {
          department: '$u.department',
          status: '$status',
          lateBy: '$lateBy',
        },
      },
    ], { allowDiskUse: true })),

    // 5. CRM Leads: company filter, range [rangeStart, now]
    timed('crm', () => Lead.aggregate([
      {
        $match: {
          company: scope.companyObjectId,
          createdAt: { $gte: rangeStart, $lte: now },
          ...(deptUserIds ? { assignedTo: { $in: deptUserIds } } : {}),
        },
      },
      {
        $facet: {
          stages: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
          ],
          telecallers: [
            { $match: { assignedTo: { $ne: null } } },
            {
              $group: {
                _id: '$assignedTo',
                name: { $first: '$assignedToName' },
                role: { $first: '$assignedToRole' },
                leads: { $sum: 1 },
                converted: {
                  $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] },
                },
              },
            },
            { $sort: { leads: -1 } },
            { $limit: 50 },
          ],
        },
      },
    ], { allowDiskUse: true })),
  ]);

  timings.velocity = (timings.velocityAssigned || 0) + (timings.velocityCompleted || 0);
  delete timings.velocityAssigned;
  delete timings.velocityCompleted;
  timings.totalAggMs = Date.now() - tStartAll;

  // ---------- Process Overview ----------
  const facet = taskFacetRes[0] || {};
  const rawOverview = facet.overview?.[0] || {
    cohortSize: 0,
    completed: 0,
    onTime: 0,
    overdue: 0,
    reopened: 0,
    avgTurnaroundMs: null,
  };

  const overview = {
    cohortSize: rawOverview.cohortSize || 0,
    completed: rawOverview.completed || 0,
    completedPct: pct(rawOverview.completed, rawOverview.cohortSize),
    onTime: rawOverview.onTime || 0,
    onTimePct: pct(rawOverview.onTime, rawOverview.completed),
    overdue: rawOverview.overdue || 0,
    reopened: rawOverview.reopened || 0,
    reopenRatePct: pct(rawOverview.reopened, rawOverview.cohortSize),
    avgTurnaroundHours: rawOverview.avgTurnaroundMs != null
      ? round1(rawOverview.avgTurnaroundMs / 3600000)
      : null,
  };

  // ---------- Process Department SLA ----------
  const rawDeptRows = facet.departmentSLA || [];
  const departmentSLA = rawDeptRows.map((d) => ({
    departmentId: d.departmentId ? String(d.departmentId) : null,
    department: d.department || 'Unassigned',
    assigned: d.assigned || 0,
    completed: d.completed || 0,
    avgTurnaroundHours: d.avgTurnaroundMs != null
      ? round1(d.avgTurnaroundMs / 3600000)
      : null,
    onTimePct: pct(d.onTime, d.completed),
    overdue: d.overdue || 0,
  }));

  // ---------- Process Slow Modules ----------
  const rawSlowModules = facet.slowModules || [];
  const slowModules = rawSlowModules.map((m) => ({
    module: m._id || 'General',
    department: m.department || 'Unassigned',
    avgDelayHours: round1(m.avgDelayHours) || 0,
    delayedTasksCount: m.delayedTasksCount || 0,
    totalTasks: m.totalTasks || 0,
  }));

  // ---------- Process Velocity Trend ----------
  const weeklySlots = generateIstWeeklySlots(rangeStart, now);
  const assignedMap = new Map();
  (velocityAssignedRes || []).forEach((row) => {
    if (row._id) assignedMap.set(row._id, row.count);
  });

  const completedMap = new Map();
  (velocityCompletedRes || []).forEach((row) => {
    if (row._id) completedMap.set(row._id, { completed: row.completed, onTime: row.onTime });
  });

  const velocityTrend = weeklySlots.map((weekStr) => {
    const assigned = assignedMap.get(weekStr) || 0;
    const compStats = completedMap.get(weekStr) || { completed: 0, onTime: 0 };
    const completed = compStats.completed || 0;
    const onTime = compStats.onTime || 0;
    const onTimePct = completed > 0 ? pct(onTime, completed) : 0;
    return {
      week: weekStr,
      assigned,
      completed,
      onTimePct,
    };
  });

  // ---------- Process Team Load ----------
  const userStatsMap = new Map();
  (facet.byUser || []).forEach((u) => {
    userStatsMap.set(String(u._id), {
      assigned: u.assigned || 0,
      completed: u.completed || 0,
      overdue: u.overdue || 0,
    });
  });

  const allEmployeeLoad = (activeUsers || []).map((u) => {
    const stats = userStatsMap.get(String(u._id)) || { assigned: 0, completed: 0, overdue: 0 };
    return {
      userId: String(u._id),
      name: u.name || 'Unnamed',
      department: u.departmentName || 'Unassigned',
      assigned: stats.assigned,
      overdue: stats.overdue,
      completed: stats.completed,
    };
  });

  // Overloaded: highest assigned descending
  const overloaded = [...allEmployeeLoad]
    .sort((a, b) => b.assigned - a.assigned || b.overdue - a.overdue)
    .slice(0, 5);

  // Underutilized: lowest assigned ascending
  const underutilized = [...allEmployeeLoad]
    .sort((a, b) => a.assigned - b.assigned || a.completed - b.completed)
    .slice(0, 5);

  const teamLoad = {
    overloaded,
    underutilized,
  };

  // ---------- Process Attendance Signals ----------
  const deptAttendanceMap = new Map();
  let totalPresent = 0;
  let totalLate = 0;
  let totalAbsent = 0;
  let totalLateMinutes = 0;
  let totalLateWithMinCount = 0;

  (attendanceAggRes || []).forEach((rec) => {
    const deptId = rec.department ? String(rec.department) : 'unassigned';
    if (!deptAttendanceMap.has(deptId)) {
      deptAttendanceMap.set(deptId, {
        presentCount: 0,
        lateCount: 0,
        absentCount: 0,
        lateMinutesSum: 0,
        lateWithMinCount: 0,
      });
    }
    const dStats = deptAttendanceMap.get(deptId);
    const status = String(rec.status || '').trim().toUpperCase();

    if (PRESENT_STATUSES.includes(status)) {
      totalPresent += 1;
      dStats.presentCount += 1;
      if (status === 'LATE') {
        totalLate += 1;
        dStats.lateCount += 1;
      }
      const lateMin = hmsToMinutes(rec.lateBy);
      if (lateMin > 0) {
        totalLateMinutes += lateMin;
        totalLateWithMinCount += 1;
        dStats.lateMinutesSum += lateMin;
        dStats.lateWithMinCount += 1;
      }
    } else if (ABSENT_STATUSES.includes(status)) {
      totalAbsent += 1;
      dStats.absentCount += 1;
    }
  });

  // Resolve department names for attendance
  const deptIdsToResolve = Array.from(deptAttendanceMap.keys()).filter((id) => id !== 'unassigned');
  const validObjectIds = deptIdsToResolve.filter((id) => mongoose.Types.ObjectId.isValid(id));
  let deptDocs = [];
  if (validObjectIds.length > 0) {
    deptDocs = await Department.find({
      _id: { $in: validObjectIds },
      company: scope.companyObjectId,
    }).select('_id name').lean();
  }
  const deptNameMap = new Map();
  deptDocs.forEach((d) => deptNameMap.set(String(d._id), d.name));

  const attendanceByDept = Array.from(deptAttendanceMap.entries()).map(([deptId, stats]) => ({
    departmentId: deptId === 'unassigned' ? null : deptId,
    department: deptNameMap.get(deptId) || (deptId === 'unassigned' ? 'Unassigned' : String(deptId)),
    presentCount: stats.presentCount,
    lateCount: stats.lateCount,
    absentCount: stats.absentCount,
    lateRatePct: pct(stats.lateCount, stats.presentCount),
    avgLateMinutes: stats.lateWithMinCount > 0 ? round1(stats.lateMinutesSum / stats.lateWithMinCount) : 0,
  }));

  const attendanceSignals = {
    overall: {
      present: totalPresent,
      late: totalLate,
      absent: totalAbsent,
      lateRatePct: pct(totalLate, totalPresent),
      avgLateMinutes: totalLateWithMinCount > 0 ? round1(totalLateMinutes / totalLateWithMinCount) : 0,
    },
    byDepartment: attendanceByDept,
  };

  // ---------- Process CRM Funnel ----------
  const crmRaw = crmAggRes[0] || {};
  const stageCounts = {
    new: 0,
    'follow-up': 0,
    interested: 0,
    'not interested': 0,
    converted: 0,
    closed: 0,
  };
  let totalLeads = 0;

  (crmRaw.stages || []).forEach((st) => {
    const rawKey = String(st._id || '').trim().toLowerCase();
    const count = st.count || 0;
    if (stageCounts[rawKey] !== undefined) {
      stageCounts[rawKey] = count;
    }
    totalLeads += count;
  });

  const rawTelecallers = crmRaw.telecallers || [];
  const telecallers = rawTelecallers.map((t) => ({
    userId: String(t._id),
    name: t.name || 'Unknown',
    role: t.role || '',
    leads: t.leads || 0,
    converted: t.converted || 0,
    conversionPct: pct(t.converted, t.leads),
  }));

  // Filter telecallers with at least MIN_LEADS_FOR_PERFORMER to avoid small-sample noise
  const minLeads = thresholds.MIN_LEADS_FOR_PERFORMER;
  const qualifiedTelecallers = telecallers.filter((t) => t.leads >= minLeads);

  const topPerformers = [...qualifiedTelecallers]
    .sort((a, b) => b.conversionPct - a.conversionPct || b.converted - a.converted)
    .slice(0, 3);

  const bottomPerformers = [...qualifiedTelecallers]
    .sort((a, b) => a.conversionPct - b.conversionPct || a.converted - b.converted)
    .slice(0, 3);

  const crmFunnel = {
    totalLeads,
    stages: {
      new: stageCounts.new,
      followUp: stageCounts['follow-up'],
      interested: stageCounts.interested,
      notInterested: stageCounts['not interested'],
      converted: stageCounts.converted,
      closed: stageCounts.closed,
    },
    conversionRatePct: pct(stageCounts.converted, totalLeads),
    telecallers,
    topPerformers,
    bottomPerformers,
  };

  // ---------- Deterministic Bottlenecks ----------
  const bottlenecks = [];

  // Rule 1: Department on-time rate below threshold (guarded by MIN_COHORT_FOR_DEPT_RULES)
  departmentSLA.forEach((dept) => {
    const deptCohort = dept.assigned || 0;
    if (
      deptCohort >= thresholds.MIN_COHORT_FOR_DEPT_RULES &&
      dept.completed >= thresholds.MIN_COHORT_FOR_DEPT_RULES &&
      dept.onTimePct < thresholds.DEPT_ON_TIME_MIN_PCT
    ) {
      bottlenecks.push({
        id: `dept_sla_${dept.departmentId || dept.department.toLowerCase().replace(/\s+/g, '_')}`,
        severity: dept.onTimePct < 50 ? 'critical' : 'warning',
        title: `Department "${dept.department}" on-time delivery is low (${dept.onTimePct}%)`,
        evidence: {
          department: dept.department,
          onTimePct: dept.onTimePct,
          thresholdPct: thresholds.DEPT_ON_TIME_MIN_PCT,
          completed: dept.completed,
          overdue: dept.overdue,
          assigned: dept.assigned,
        },
        scope: dept.department,
      });
    }
  });

  // Rule 2: High percentage of live overdue tasks (overdue / cohortSize)
  const liveOverduePct = pct(overview.overdue, overview.cohortSize);
  if (
    overview.cohortSize >= thresholds.MIN_COHORT_FOR_DEPT_RULES &&
    liveOverduePct > thresholds.COMPANY_OVERDUE_MAX_PCT
  ) {
    bottlenecks.push({
      id: 'company_overdue_high',
      severity: liveOverduePct >= thresholds.COMPANY_OVERDUE_MAX_PCT * 2 ? 'critical' : 'warning',
      title: `High percentage of live overdue tasks (${liveOverduePct}%)`,
      evidence: {
        overduePct: liveOverduePct,
        overdue: overview.overdue,
        cohortSize: overview.cohortSize,
        thresholdPct: thresholds.COMPANY_OVERDUE_MAX_PCT,
      },
      scope: 'company',
    });
  }

  // Rule 3: Reopen rate above threshold (guarded by MIN_COHORT_FOR_DEPT_RULES)
  if (overview.cohortSize >= thresholds.MIN_COHORT_FOR_DEPT_RULES && overview.reopenRatePct > thresholds.REOPEN_RATE_MAX_PCT) {
    bottlenecks.push({
      id: 'company_reopen_high',
      severity: 'warning',
      title: `Elevated task reopen rate (${overview.reopenRatePct}%)`,
      evidence: {
        reopenRatePct: overview.reopenRatePct,
        reopened: overview.reopened,
        thresholdPct: thresholds.REOPEN_RATE_MAX_PCT,
        cohortSize: overview.cohortSize,
      },
      scope: 'company',
    });
  }

  // Rule 4: Module delay far above company average (guarded by MIN_COHORT_FOR_DEPT_RULES)
  const benchmarkTurnaround = overview.avgTurnaroundHours || 12;
  slowModules.forEach((m) => {
    if (m.totalTasks >= thresholds.MIN_COHORT_FOR_DEPT_RULES && m.avgDelayHours >= benchmarkTurnaround * thresholds.MODULE_DELAY_RATIO_MAX) {
      bottlenecks.push({
        id: `slow_module_${m.module.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        severity: m.avgDelayHours >= benchmarkTurnaround * 2 ? 'critical' : 'warning',
        title: `Significant delay in module "${m.module}" (${m.avgDelayHours} hrs avg delay)`,
        evidence: {
          module: m.module,
          department: m.department,
          avgDelayHours: m.avgDelayHours,
          benchmarkHours: benchmarkTurnaround,
          delayedTasksCount: m.delayedTasksCount,
          totalTasks: m.totalTasks,
        },
        scope: m.module,
      });
    }
  });

  // Rule 5: High late-arrival rate in attendance (guarded by MIN_ATTENDANCE_RECORDS_FOR_RULES)
  const totalAttendanceRecords = attendanceSignals.overall.records || attendanceSignals.overall.present || 0;
  if (
    totalAttendanceRecords >= thresholds.MIN_ATTENDANCE_RECORDS_FOR_RULES &&
    attendanceSignals.overall.lateRatePct > thresholds.LATE_ARRIVAL_MAX_PCT
  ) {
    bottlenecks.push({
      id: 'attendance_late_high',
      severity: 'warning',
      title: `High workforce late arrival rate (${attendanceSignals.overall.lateRatePct}%)`,
      evidence: {
        lateRatePct: attendanceSignals.overall.lateRatePct,
        late: attendanceSignals.overall.late,
        present: attendanceSignals.overall.present,
        records: totalAttendanceRecords,
        avgLateMinutes: attendanceSignals.overall.avgLateMinutes,
        thresholdPct: thresholds.LATE_ARRIVAL_MAX_PCT,
      },
      scope: 'attendance',
    });
  }

  // Rule 6: Telecaller conversion far below threshold (guarded by MIN_LEADS_FOR_FUNNEL_RULES)
  if (
    crmFunnel.totalLeads >= thresholds.MIN_LEADS_FOR_FUNNEL_RULES &&
    crmFunnel.conversionRatePct < thresholds.TELECALLER_CONVERSION_MIN_PCT
  ) {
    bottlenecks.push({
      id: 'crm_conversion_low',
      severity: 'warning',
      title: `CRM lead conversion rate is low (${crmFunnel.conversionRatePct}%)`,
      evidence: {
        conversionRatePct: crmFunnel.conversionRatePct,
        converted: crmFunnel.stages.converted,
        totalLeads: crmFunnel.totalLeads,
        thresholdPct: thresholds.TELECALLER_CONVERSION_MIN_PCT,
      },
      scope: 'crm',
    });
  }

  // Rule 7: Workload imbalance
  if (allEmployeeLoad.length >= 3 && overloaded.length > 0) {
    const topWorker = overloaded[0];
    const totalAssignedInCohort = allEmployeeLoad.reduce((s, u) => s + u.assigned, 0);
    const avgAssignedPerWorker = totalAssignedInCohort / allEmployeeLoad.length;
    if (topWorker.assigned >= Math.max(5, avgAssignedPerWorker * thresholds.WORKLOAD_IMBALANCE_RATIO)) {
      bottlenecks.push({
        id: 'team_workload_imbalance',
        severity: 'info',
        title: `Workload imbalance detected: ${topWorker.name} has ${topWorker.assigned} tasks`,
        evidence: {
          topUser: topWorker.name,
          assigned: topWorker.assigned,
          teamAverage: round1(avgAssignedPerWorker),
          imbalanceMultiplier: round1(topWorker.assigned / Math.max(1, avgAssignedPerWorker)),
          underutilizedCount: underutilized.filter((u) => u.assigned === 0).length,
        },
        scope: 'team',
      });
    }
  }

  // ---------- Meta & Definitions ----------
  return {
    overview,
    departmentSLA,
    slowModules,
    velocityTrend,
    teamLoad,
    attendanceSignals,
    crmFunnel,
    bottlenecks,
    meta: {
      range,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      department: deptStr,
      generatedAt: new Date().toISOString(),
      cached: false,
      durationMs: 0,
      timings,
      definitions: {
        cohort: 'Tasks whose dueDateTime falls inside [rangeStart, now]. Completed % = completed in cohort / cohort size. On-time % = completed with completionDate <= dueDateTime / completed in cohort. Overdue now = dueDateTime < now AND overallStatus != completed (live dynamic calculation, not stored status). Reopen rate = tasks with overallStatus reopen or reopen statusHistory / cohort size.',
        velocityTrend: 'Weekly buckets in Asia/Kolkata (IST). Assigned = count of tasks created in week. Completed = count of completed tasks with completionDate in week. On-time % = on-time completions in week / completions in week. Empty weeks padded with zeros.',
        multiAssigneeNote: 'Company-wide counts do NOT unwind assignedUsers to prevent double-counting multi-assignee tasks. Department and employee breakdowns unwind assignedUsers, so department/employee sum may exceed company totals.',
        crmFunnel: 'Lead stage progression: new (fresh lead), follow-up (callback/retry scheduled), interested (warm prospective client), not interested (client opted out/disqualified), converted (sale won/contract signed), closed (dispositioned without conversion). Telecallers ranked only if having >= 10 leads to eliminate low-sample statistical noise.',
        bottlenecks: 'Deterministic rule-based alarms evaluated against frozen thresholds defined in config/aiExecutiveThresholds.js.',
      },
    },
  };
}

/**
 * Public API: getExecutiveInsights
 * Enforces company & user validation, in-memory caching (10 min TTL, max 200 items, oldest eviction),
 * concurrent request coalescing, and skipCache option.
 */
async function getExecutiveInsights({
  user,
  range = '30d',
  department = 'all',
  skipCache = false,
  now = new Date(),
}) {
  const startedAt = Date.now();

  // Validate user & derive tenant context ONLY from user (req.user)
  if (!user) {
    const err = new Error('Authentication required: user context missing.');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }
  const scope = getCompanyScope(user);

  // Validate range
  const validRanges = ['7d', '30d', '90d'];
  if (!validRanges.includes(range)) {
    const err = new Error(`Invalid range: "${range}". Must be one of ${validRanges.join(', ')}.`);
    err.code = 'INVALID_RANGE';
    throw err;
  }

  const deptKey = String(department || 'all').trim();
  const cacheKey = getCacheKey(scope.companyId, range, deptKey);

  // 1. In-memory Cache Check
  if (!skipCache) {
    const cachedEntry = memoryCache.get(cacheKey);
    if (cachedEntry && Date.now() < cachedEntry.expiresAt) {
      const cloned = JSON.parse(JSON.stringify(cachedEntry.data));
      cloned.meta.cached = true;
      cloned.meta.durationMs = Date.now() - startedAt;
      return cloned;
    }
  }

  // 2. Coalesce concurrent identical in-flight requests
  let inFlight = inFlightRequests.get(cacheKey);
  if (!inFlight) {
    inFlight = computeExecutiveInsights({ scope, range, department: deptKey, now })
      .then((data) => {
        // Enforce max cache entries before inserting
        if (memoryCache.size >= thresholds.MAX_CACHE_ENTRIES) {
          const oldestKey = memoryCache.keys().next().value;
          if (oldestKey) memoryCache.delete(oldestKey);
        }
        memoryCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + thresholds.CACHE_TTL_MS,
        });
        return data;
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      });

    inFlightRequests.set(cacheKey, inFlight);
  }

  const freshData = await inFlight;
  const cloned = JSON.parse(JSON.stringify(freshData));
  cloned.meta.cached = false;
  cloned.meta.durationMs = Date.now() - startedAt;
  return cloned;
}

module.exports = {
  getExecutiveInsights,
  clearExecutiveCache,
  hmsToMinutes,
  generateIstWeeklySlots,
  getIstMondayDateString,
  pct,
  round1,
};
