const mongoose = require('mongoose');
const Task = require('../../HR-CDS/models/Task');
const Attendance = require('../../HR-CDS/models/Attendance');
const Lead = require('../../models/Lead');
const User = require('../../models/User');
const Department = require('../../models/Department');
const { escapeRegex } = require('./assigneeResolver');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUSES = ['completed', 'approved'];
const PRESENT_STATUSES = ['PRESENT', 'LATE', 'HALF DAY', 'SHORT LEAVE'];
const ABSENT_STATUSES = ['ABSENT', 'UNINFORMED LEAVE'];

// ---------- helpers ----------
function getCompanyScope(user) {
    const rawId = user?.company?._id || user?.company || null;
    const rawCode = user?.companyCode || user?.company?.companyCode || '';
    const baseCode = String(rawCode).split('-')[0].trim();
    if (!rawId || !baseCode || !mongoose.Types.ObjectId.isValid(String(rawId))) {
        const err = new Error('Company context missing');
        err.code = 'COMPANY_MISSING';
        throw err;
    }
    return {
        companyId: String(rawId),
        companyObjectId: new mongoose.Types.ObjectId(String(rawId)),
        baseCode,
        companyCodeFilter: { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') },
    };
}

function istDayStart(date = new Date()) {
    const shifted = new Date(date.getTime() + IST_OFFSET_MS);
    return new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS
    );
}

function istDateString(date = new Date()) {
    return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function pct(n, d) {
    return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function round1(n) {
    return n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10;
}

function hmsToMinutes(value) {
    const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
}

function rangeFor(days, now) {
    const safeDays = Math.min(Math.max(Number(days) || 30, 1), 90);
    const endOfToday = new Date(istDayStart(now).getTime() + DAY_MS - 1);
    const start = new Date(istDayStart(now).getTime() - (safeDays - 1) * DAY_MS);
    return { days: safeDays, start, endOfToday };
}

// ---------- Employee metrics ----------
async function getEmployeeMetrics({ user, userId, days = 30, now = new Date() }) {
    const scope = getCompanyScope(user);
    const uid = String(userId || user._id || user.id);
    const range = rangeFor(days, now);

    const [tasks, openOverdueAllTime, attendanceDocs] = await Promise.all([
        Task.find({
            companyCode: scope.companyCodeFilter,
            assignedUsers: uid,
            isActive: { $ne: false },
            dueDateTime: { $gte: range.start, $lte: range.endOfToday },
        })
            .select('dueDateTime completionDate createdAt priority overallStatus statusByUser statusHistory')
            .lean(),
        Task.countDocuments({
            companyCode: scope.companyCodeFilter,
            assignedUsers: uid,
            isActive: { $ne: false },
            overallStatus: { $nin: [...DONE_STATUSES, 'cancelled', 'rejected'] },
            dueDateTime: { $lt: now },
        }),
        Attendance.find({
            user: uid,
            companyCode: scope.companyCodeFilter,
            date: { $gte: range.start, $lte: range.endOfToday },
        })
            .select('date status lateBy')
            .lean(),
    ]);

    let total = 0;
    let done = 0;
    let onTime = 0;
    let overdue = 0;
    let reopened = 0;
    let high = 0;
    let highDone = 0;
    let turnaroundSum = 0;
    let turnaroundCount = 0;

    for (const t of tasks) {
        const mine = (t.statusByUser || []).find((s) => String(s.user) === uid);
        const status = mine?.status || t.overallStatus;
        if (status === 'cancelled' || t.overallStatus === 'cancelled') continue;

        total += 1;
        const isDone = DONE_STATUSES.includes(status);
        const completedAt = t.completionDate || (isDone ? mine?.updatedAt : null) || null;

        if (isDone) {
            done += 1;
            if (!t.dueDateTime || !completedAt || new Date(completedAt) <= new Date(t.dueDateTime)) onTime += 1;
            if (completedAt && t.createdAt) {
                turnaroundSum += new Date(completedAt) - new Date(t.createdAt);
                turnaroundCount += 1;
            }
        } else if (t.dueDateTime && new Date(t.dueDateTime) < now && status !== 'rejected') {
            overdue += 1;
        }

        const wasReopened =
            t.overallStatus === 'reopen' || (t.statusHistory || []).some((h) => h.status === 'reopen');
        if (wasReopened) reopened += 1;

        if (t.priority === 'high') {
            high += 1;
            if (isDone) highDone += 1;
        }
    }

    let presentDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    let lateMinutesSum = 0;
    for (const a of attendanceDocs) {
        if (PRESENT_STATUSES.includes(a.status)) {
            presentDays += 1;
            const lateMin = hmsToMinutes(a.lateBy);
            if (a.status === 'LATE' || lateMin > 0) {
                lateDays += 1;
                lateMinutesSum += lateMin;
            }
        } else if (ABSENT_STATUSES.includes(a.status)) {
            absentDays += 1;
        }
    }

    return {
        period: { days: range.days, from: istDateString(range.start), to: istDateString(now) },
        tasks: {
            totalAssigned: total,
            completed: done,
            completionRatePct: pct(done, total),
            onTimePct: pct(onTime, done),
            overdueCount: overdue,
            openOverdueAllTime: openOverdueAllTime,
            reopenedCount: reopened,
            reopenRatePct: pct(reopened, done + reopened),
            highPriorityTotal: high,
            highPriorityCompleted: highDone,
            avgTurnaroundHours: turnaroundCount ? round1(turnaroundSum / turnaroundCount / 3600000) : null,
        },
        attendance: {
            presentDays,
            absentDays,
            lateDays,
            punctualityPct: pct(presentDays - lateDays, presentDays),
            avgLateMinutes: lateDays ? round1(lateMinutesSum / lateDays) : 0,
        },
    };
}

// ---------- Executive metrics ----------
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
    $cond: [{ $and: [doneExpr, hasCompletion] }, { $subtract: ['$completionDate', '$createdAt'] }, null],
};
const taskGroupAccumulators = {
    total: { $sum: 1 },
    done: { $sum: { $cond: [doneExpr, 1, 0] } },
    onTime: { $sum: { $cond: [onTimeExpr, 1, 0] } },
    overdue: { $sum: { $cond: [doneExpr, 0, 1] } }, // match already limits dueDateTime <= now
    reopened: { $sum: { $cond: [reopenExpr, 1, 0] } },
    avgTurnaroundMs: { $avg: turnaroundExpr },
};

function shapeGroup(g) {
    return {
        total: g.total,
        completed: g.done,
        completionRatePct: pct(g.done, g.total),
        onTimePct: pct(g.onTime, g.done),
        overdue: g.overdue,
        reopened: g.reopened,
        reopenRatePct: pct(g.reopened, g.done + g.reopened),
        avgTurnaroundHours: g.avgTurnaroundMs != null ? round1(g.avgTurnaroundMs / 3600000) : null,
    };
}

async function resolveDepartmentNames(ids, companyObjectId) {
    const valid = ids.map(String).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const map = new Map();
    if (valid.length) {
        const docs = await Department.find({ _id: { $in: valid }, company: companyObjectId })
            .select('_id name')
            .lean();
        docs.forEach((d) => map.set(String(d._id), d.name));
    }
    return map;
}

async function getExecutiveMetrics({ user, days = 30, now = new Date() }) {
    const scope = getCompanyScope(user);
    const range = rangeFor(days, now);

    const taskMatch = {
        companyCode: scope.companyCodeFilter,
        isActive: { $ne: false },
        overallStatus: { $ne: 'cancelled' },
        dueDateTime: { $gte: range.start, $lte: now },
    };

    const [taskAgg, leadAgg, attAgg] = await Promise.all([
        Task.aggregate([
            { $match: taskMatch },
            {
                $facet: {
                    overall: [{ $group: { _id: null, ...taskGroupAccumulators } }],
                    weekly: [
                        {
                            $group: {
                                _id: { $dateToString: { format: '%G-W%V', date: '$dueDateTime', timezone: 'Asia/Kolkata' } },
                                due: { $sum: 1 },
                                completed: { $sum: { $cond: [doneExpr, 1, 0] } },
                            },
                        },
                        { $sort: { _id: 1 } },
                    ],
                    byDepartment: [
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
                        { $match: { 'u.company': scope.companyObjectId } }, // tenant guard
                        { $group: { _id: '$u.department', ...taskGroupAccumulators } },
                        { $sort: { overdue: -1 } },
                    ],
                },
            },
        ]),
        Lead.aggregate([
            { $match: { company: scope.companyObjectId, createdAt: { $gte: range.start, $lte: now } } },
            {
                $facet: {
                    funnel: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
                    byAgent: [
                        { $match: { assignedTo: { $ne: null } } },
                        {
                            $group: {
                                _id: '$assignedTo',
                                name: { $first: '$assignedToName' },
                                total: { $sum: 1 },
                                converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
                            },
                        },
                        { $sort: { total: -1 } },
                        { $limit: 10 },
                    ],
                },
            },
        ]),
        Attendance.aggregate([
            {
                $match: {
                    companyCode: scope.companyCodeFilter,
                    date: { $gte: range.start, $lte: range.endOfToday },
                },
            },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
    ]);

    const facet = taskAgg[0] || {};
    const overall = facet.overall?.[0] ? shapeGroup(facet.overall[0]) : shapeGroup({ total: 0, done: 0, onTime: 0, overdue: 0, reopened: 0, avgTurnaroundMs: null });

    const deptRows = facet.byDepartment || [];
    const deptNames = await resolveDepartmentNames(deptRows.map((d) => d._id).filter(Boolean), scope.companyObjectId);
    const byDepartment = deptRows.map((d) => ({
        department: deptNames.get(String(d._id)) || (d._id ? String(d._id) : 'Unassigned'),
        ...shapeGroup(d),
    }));

    const funnelRaw = leadAgg[0]?.funnel || [];
    const funnel = {};
    let leadTotal = 0;
    funnelRaw.forEach((f) => {
        funnel[f._id || 'unknown'] = f.count;
        leadTotal += f.count;
    });
    const converted = funnel.converted || 0;

    const attendance = {};
    attAgg.forEach((a) => { attendance[a._id] = a.count; });
    const presentTotal = PRESENT_STATUSES.reduce((s, k) => s + (attendance[k] || 0), 0);

    return {
        period: { days: range.days, from: istDateString(range.start), to: istDateString(now) },
        tasks: { overall, weeklyVelocity: (facet.weekly || []).map((w) => ({ week: w._id, due: w.due, completed: w.completed })), byDepartment },
        crm: {
            totalLeads: leadTotal,
            funnel,
            conversionRatePct: pct(converted, leadTotal),
            topAgents: (leadAgg[0]?.byAgent || []).map((a) => ({
                name: a.name || 'Unknown',
                total: a.total,
                converted: a.converted,
                conversionRatePct: pct(a.converted, a.total),
            })),
        },
        attendance: {
            present: presentTotal,
            late: attendance.LATE || 0,
            absent: ABSENT_STATUSES.reduce((s, k) => s + (attendance[k] || 0), 0),
            latePct: pct(attendance.LATE || 0, presentTotal),
        },
    };
}

module.exports = {
    getCompanyScope,
    getEmployeeMetrics,
    getExecutiveMetrics,
    istDayStart,
    istDateString,
};