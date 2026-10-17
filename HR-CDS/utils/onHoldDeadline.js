const DAY_MS = 24 * 60 * 60 * 1000;
const INDIA_OFFSET_MS = 330 * 60 * 1000;
const normalizeStatus = value => String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
const isOnHold = value => normalizeStatus(value) === 'onhold';
const isFinished = value => ['completed', 'approved', 'rejected', 'cancelled'].includes(normalizeStatus(value));
const validDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const indiaDateKey = value => new Date(new Date(value).getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);

const inferHoldStart = (task, now = new Date()) => {
  if (validDate(task.holdStartedAt)) return validDate(task.holdStartedAt);
  const events = [
    ...(task.statusHistory || []).filter(item => isOnHold(item.status)).map(item => item.changedAt || item.createdAt),
    ...(task.activityLogs || []).filter(item => isOnHold(item.newValue || item.newValues?.status)).map(item => item.performedAt || item.createdAt || item.timestamp),
  ].map(validDate).filter(Boolean).sort((a, b) => b - a);
  return events[0] || validDate(task.updatedAt) || now;
};

// Called by model save hooks, so every status-changing API uses the same clock.
const trackHoldClock = (document, status, changed, now = new Date()) => {
  if (isOnHold(status)) {
    if (changed || !validDate(document.holdStartedAt)) {
      document.holdStartedAt = changed ? now : inferHoldStart(document, now);
      document.holdOverdueCheckAt = new Date(document.holdStartedAt.getTime() + DAY_MS);
    } else if (!validDate(document.holdOverdueCheckAt)) {
      document.holdOverdueCheckAt = new Date(new Date(document.holdStartedAt).getTime() + DAY_MS);
    }
  } else {
    document.holdStartedAt = null;
    document.holdOverdueCheckAt = null;
  }
};

// Each absent deadline day postpones the check by a full elapsed 24 hours.
// Attendance is checked for the deadline day, including users already clocked out.
const evaluateHoldDeadline = ({startedAt, checkAt, now = new Date(), presentDays = new Set()}) => {
  const start = validDate(startedAt);
  if (!start) return {overdue: false, nextCheckAt: null};
  const firstCheck = new Date(start.getTime() + DAY_MS);
  let deadline = validDate(checkAt);
  if (!deadline || deadline < firstCheck) deadline = firstCheck;
  while (deadline <= now) {
    if (presentDays.has(indiaDateKey(deadline))) return {overdue: true, nextCheckAt: deadline};
    deadline = new Date(deadline.getTime() + DAY_MS);
  }
  return {overdue: false, nextCheckAt: deadline};
};

module.exports = {DAY_MS, INDIA_OFFSET_MS, isOnHold, isFinished, validDate, indiaDateKey, inferHoldStart, trackHoldClock, evaluateHoldDeadline};
