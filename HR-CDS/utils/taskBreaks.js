const Attendance = require('../models/Attendance');
const User = require('../../models/User');
const { isValidObjectId } = require('mongoose');

const idOf = value => String(value?._id || value || '');
const msOf = value => value == null ? NaN : new Date(value).getTime();
const statusOf = value => String(value || '').toLowerCase().replace(/[\s_-]/g, '');
const statuses = new Set(['inprogress', 'pending', 'completed', 'onhold', 'reopen', 'overdue', 'cancelled', 'rejected', 'approved']);
const clock = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit'
});

const breakIntervals = (records, until) => records.flatMap(record => (record.breaks || []).map(entry => ({
  id: idOf(entry._id),
  user: idOf(record.user),
  start: msOf(entry.start),
  end: Math.min(msOf(entry.end || record.outTime || (record.isClockedIn !== false ? until : null)), msOf(until)),
  open: !entry.end && !record.outTime && record.isClockedIn !== false
})).filter(entry => entry.end > entry.start));

const subtractBreakIntervals = (intervals, breaks) => {
  const ordered = [...breaks].sort((a, b) => a.start - b.start);
  return intervals.flatMap(({ start, end }) => {
    let cursor = msOf(start);
    const until = msOf(end);
    const remaining = [];
    for (const pause of ordered) {
      if (pause.start >= until) break;
      if (pause.end <= cursor) continue;
      if (pause.start > cursor) remaining.push({ start: new Date(cursor), end: new Date(pause.start) });
      cursor = Math.max(cursor, pause.end);
    }
    if (until > cursor) remaining.push({ start: new Date(cursor), end: new Date(until) });
    return remaining;
  });
};

const loadBreaks = async (users, companyCode, start, end) => {
  if (!users.length || !companyCode || !(end > start)) return [];
  const exactCode = new RegExp(`^${String(companyCode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const records = await Attendance.find({
    user: { $in: users },
    companyCode: exactCode,
    breaks: { $elemMatch: { start: { $lt: new Date(end) }, $or: [{ end: null }, { end: { $gt: new Date(start) } }] } }
  }).select('user breaks.start breaks.end breaks._id outTime isClockedIn').lean();
  return breakIntervals(records, end);
};

const elapsedTaskSeconds = async (user, companyCode, start, end) => {
  const from = msOf(start);
  const until = msOf(end);
  if (!(until > from)) return 0;
  const worker = idOf(user);
  const pauses = await loadBreaks(isValidObjectId(worker) ? [worker] : [], companyCode, from, until);
  const activeMs = subtractBreakIntervals([{ start, end }], pauses)
    .reduce((sum, span) => sum + (span.end - span.start), 0);
  return Math.floor(activeMs / 1000);
};

const taskStatusEvents = task => (task.statusHistory?.length ? task.statusHistory : task.activityLogs || [])
  .map(entry => {
    const change = String(entry.description || '').match(/\bstatus\s+(?:changed\s+)?from\s+["']([^"']+)["']\s+to\s+["']([^"']+)["']/i);
    return {
      status: statusOf(entry.status || entry.newValues?.status || entry.newValue || change?.[2]),
      previous: statusOf(entry.oldValues?.status || entry.oldValue || change?.[1]),
      at: msOf(entry.changedAt || entry.performedAt || entry.createdAt),
      user: idOf(entry.changedBy || entry.performedBy || entry.user)
    };
  }).filter(event => statuses.has(event.status) && Number.isFinite(event.at)).sort((a, b) => a.at - b.at);

const progressSpans = (task, events, status, now, startFallback) => {
  const spans = [];
  const created = msOf(task.createdAt);
  let start = events[0]?.previous === 'inprogress' && created <= events[0].at ? created : NaN;
  for (const event of events) {
    if (event.status === 'inprogress') {
      if (!Number.isFinite(start)) start = event.at;
    } else {
      if (event.at > start) spans.push({ start, end: event.at });
      start = NaN;
    }
  }
  if (statusOf(status) === 'inprogress') {
    const explicitStart = msOf(startFallback);
    const lastStatusAt = events.at(-1)?.at;
    if (Number.isFinite(explicitStart) && (!Number.isFinite(start) || explicitStart > start)) start = explicitStart;
    if (!Number.isFinite(start)) start = lastStatusAt ?? created;
    if (now > start) spans.push({ start, end: now, running: true });
  } else {
    const stoppedAt = msOf(startFallback || task.completedAt || task.completionDate || task.statusChangedAt);
    if (stoppedAt > start) spans.push({ start, end: stoppedAt });
  }
  return spans;
};

const getTaskBreakActivity = async ({ task, workers, companyCode, individual = false, now = Date.now() }) => {
  if (!companyCode) return [];
  const people = new Map(workers.filter(worker => isValidObjectId(idOf(worker.user)))
    .map(worker => [idOf(worker.user), worker]));
  if (!people.size) return [];
  const events = taskStatusEvents(task);
  const spans = new Map([...people].map(([id, worker]) => [id, progressSpans(
    task,
    individual && people.size > 1 ? events.filter(event => event.user === id) : events,
    worker.status || task.status || task.overallStatus,
    now,
    worker.startedAt || task.inProgressSince
  )]));
  const allSpans = [...spans.values()].flat();
  if (!allSpans.length) return [];
  const pauses = await loadBreaks([...people.keys()], companyCode,
    Math.min(...allSpans.map(span => span.start)), Math.max(...allSpans.map(span => span.end)));
  if (!pauses.length) return [];
  const userIds = [...new Set(pauses.map(pause => pause.user))];
  const users = await User.find({ _id: { $in: userIds } }).select('name').lean();
  const usersById = new Map(users.map(user => [String(user._id), user]));
  const logs = [];
  for (const pause of pauses) {
    for (const span of spans.get(pause.user) || []) {
      const start = Math.max(pause.start, span.start);
      const end = Math.min(pause.end, span.end);
      if (end <= start) continue;
      const running = Boolean(pause.open && span.running && end === now);
      const durationSeconds = Math.floor((end - start) / 1000);
      const duration = [Math.floor(durationSeconds / 3600), Math.floor(durationSeconds / 60) % 60, durationSeconds % 60]
        .map(value => String(value).padStart(2, '0')).join(':');
      const user = usersById.get(pause.user);
      logs.push({
        _id: `break-${pause.user}-${pause.id || pause.start}-${start}`,
        action: 'task_break',
        user,
        userName: user?.name || 'Employee',
        description: running
          ? `Break in progress. Task timer paused at ${clock.format(start)} IST.`
          : `Task timer paused for a break from ${clock.format(start)} to ${clock.format(end)} IST (${duration}).`,
        createdAt: new Date(start),
        breakStart: new Date(start),
        breakEnd: running ? null : new Date(end),
        durationSeconds
      });
    }
  }
  return logs;
};

module.exports = { breakIntervals, subtractBreakIntervals, elapsedTaskSeconds, getTaskBreakActivity };
