/**
 * Break rules: whose policy applies, how long someone was on break, and what the admin hears about.
 *
 * A company can run breaks in one of three ways:
 *   OFF       nothing is tracked (the default, so nothing changes for a company that does not use it)
 *   FIXED     everyone breaks at the same time (lunch 13:00–13:30, tea 16:00–16:15). Those windows
 *             are deducted from working time on their own, no button needed; if the employee did
 *             punch a break inside a window, their real time is used instead. A break outside the
 *             windows is an EXTRA break — allowed, and the admin is told about it.
 *   FLEXIBLE  no fixed times. Everyone punches their own breaks whenever they can, and the admin is
 *             told each time one starts and ends.
 *
 * The policy can be set on the company, a branch, a department or a shift (job role); the most
 * specific one that is not "inherit" wins.
 *
 * Pure functions (no database, no clock of their own) so every rule here is testable, and the live
 * timer, the stored attendance record and payroll all compute break time the same way.
 */
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const MODES = ['OFF', 'FIXED', 'FLEXIBLE'];
const INHERIT = 'INHERIT';
// Most specific first: a shift's policy beats a department's, which beats a branch's, then the company.
const POLICY_LEVELS = ['jobRole', 'department', 'branch', 'company'];

const toDate = value => (value instanceof Date ? value : new Date(value));
const isValidDate = value => value instanceof Date && !Number.isNaN(value.getTime());

const timeOf = value => {
  const date = toDate(value);
  return isValidDate(date) ? date.getTime() : 0;
};

/** 'YYYY-MM-DD' for the India day a timestamp falls in. */
const dateKeyOf = value => {
  const date = toDate(value);
  if (!isValidDate(date)) return '';
  return new Date(date.getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
};

/** 'HH:mm' → minutes after midnight, or null when it is not a time. */
const minutesOfClock = value => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const clockOfMinutes = minutes => {
  const total = ((Number(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** The absolute time of 'HH:mm' on the India day of `onDate`. */
const indiaClockToTime = (onDate, clock) => {
  const key = dateKeyOf(onDate);
  const minutes = minutesOfClock(clock);
  if (!key || minutes === null) return null;
  return new Date(`${key}T00:00:00.000Z`).getTime() - INDIA_OFFSET_MS + minutes * MINUTE_MS;
};

const normalizeFixedBreak = (raw, index) => {
  const start = minutesOfClock(raw?.start);
  const end = minutesOfClock(raw?.end);
  if (start === null || end === null || end <= start) return null;
  return {
    name: String(raw?.name || `Break ${index + 1}`).trim().slice(0, 60) || `Break ${index + 1}`,
    start: clockOfMinutes(start),
    end: clockOfMinutes(end),
    minutes: end - start,
    autoDeduct: raw?.autoDeduct !== false,
  };
};

const normalizeLimits = raw => {
  const maxBreaks = Math.max(0, Math.floor(Number(raw?.maxBreaksPerDay) || 0));
  const maxMinutes = Math.max(0, Math.floor(Number(raw?.maxMinutesPerDay) || 0));
  return {
    enabled: Boolean(raw?.enabled) && (maxBreaks > 0 || maxMinutes > 0),
    maxBreaksPerDay: maxBreaks,
    maxMinutesPerDay: maxMinutes,
    // WARN lets the employee carry on and tells the admin; BLOCK refuses the next break.
    enforce: String(raw?.enforce || 'WARN').toUpperCase() === 'BLOCK' ? 'BLOCK' : 'WARN',
  };
};

/** A stored policy, cleaned up. `mode: 'INHERIT'` (the default) means "use the level above". */
const normalizeBreakPolicy = (raw = {}) => {
  const mode = String(raw?.mode || INHERIT).toUpperCase();
  const fixedBreaks = (Array.isArray(raw?.fixedBreaks) ? raw.fixedBreaks : [])
    .map(normalizeFixedBreak)
    .filter(Boolean)
    .sort((a, b) => minutesOfClock(a.start) - minutesOfClock(b.start))
    .slice(0, 10);
  return {
    mode: MODES.includes(mode) ? mode : INHERIT,
    fixedBreaks,
    allowExtraBreak: raw?.allowExtraBreak !== false,
    notifyAdmin: raw?.notifyAdmin !== false,
    limits: normalizeLimits(raw?.limits),
  };
};

const OFF_POLICY = Object.freeze({
  mode: 'OFF',
  fixedBreaks: [],
  allowExtraBreak: false,
  notifyAdmin: false,
  limits: normalizeLimits(null),
  source: 'default',
});

/**
 * The policy that applies to one employee.
 * `levels` is {jobRole, department, branch, company} of stored policies; the most specific one that
 * is not INHERIT wins. Nothing set anywhere means breaks are not tracked at all.
 */
const resolveBreakPolicy = (levels = {}) => {
  for (const level of POLICY_LEVELS) {
    const policy = normalizeBreakPolicy(levels[level] || {});
    if (policy.mode !== INHERIT) {
      return { ...policy, source: level };
    }
  }
  return { ...OFF_POLICY };
};

/** The fixed windows as absolute times on the India day of `onDate`. */
const fixedWindowsFor = (policy, onDate) => {
  if (!policy || policy.mode !== 'FIXED') return [];
  return (policy.fixedBreaks || []).map(item => {
    const start = indiaClockToTime(onDate, item.start);
    const end = indiaClockToTime(onDate, item.end);
    if (start === null || end === null) return null;
    return { ...item, startTime: start, endTime: end };
  }).filter(Boolean);
};

const overlapMs = (aStart, aEnd, bStart, bEnd) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/**
 * What kind of break starting at `startedAt` is: one of the fixed windows, an extra break on top of
 * them, or just a break in a flexible company.
 */
const classifyBreak = (policy, startedAt) => {
  if (!policy || policy.mode === 'OFF') return { type: 'FLEXIBLE', label: 'Break', windowName: '' };
  if (policy.mode === 'FLEXIBLE') return { type: 'FLEXIBLE', label: 'Break', windowName: '' };
  const start = timeOf(startedAt);
  const window = fixedWindowsFor(policy, startedAt)
    // A break that starts within its window, or a few minutes before it, counts as that break.
    .find(item => start >= item.startTime - 5 * MINUTE_MS && start < item.endTime);
  if (window) return { type: 'FIXED', label: window.name, windowName: window.name };
  return { type: 'EXTRA', label: 'Extra break', windowName: '' };
};

/** Does the admin hear about this break starting or ending? */
const shouldNotifyAdmin = (policy, breakType) => {
  if (!policy || policy.mode === 'OFF' || policy.notifyAdmin === false) return false;
  if (policy.mode === 'FLEXIBLE') return true;
  // Fixed company: the scheduled breaks are expected, only an extra one is worth a notification.
  return breakType === 'EXTRA';
};

const breakSpanEnd = (entry, now) => (entry?.end ? timeOf(entry.end) : timeOf(now));

/**
 * All the break time for one attendance day.
 *
 * Manual punches always count. On top of that, a fixed window is deducted on its own for the part
 * of it the employee was clocked in for — unless they punched a break inside that window, in which
 * case their real time is what counts (no double counting).
 */
const breakTotalsFor = ({ policy, breaks = [], inTime, outTime = null, now = new Date() } = {}) => {
  const start = timeOf(inTime);
  const end = outTime ? timeOf(outTime) : timeOf(now);
  const entries = Array.isArray(breaks) ? breaks.filter(entry => entry?.start) : [];

  let manualMs = 0;
  let runningMs = 0;
  entries.forEach(entry => {
    const entryStart = timeOf(entry.start);
    const entryEnd = breakSpanEnd(entry, now);
    const span = Math.max(0, entryEnd - entryStart);
    manualMs += span;
    if (!entry.end) runningMs += span;
  });

  let autoMs = 0;
  const windows = fixedWindowsFor(policy, inTime || now);
  windows.forEach(window => {
    if (!window.autoDeduct) return;
    const punched = entries.some(entry => (
      overlapMs(timeOf(entry.start), breakSpanEnd(entry, now), window.startTime, window.endTime) > 0
    ));
    if (punched) return;   // their own punch already covers this window
    if (!start) return;
    autoMs += overlapMs(start, end, window.startTime, window.endTime);
  });

  const totalMs = manualMs + autoMs;
  return {
    manualMinutes: Math.round(manualMs / MINUTE_MS),
    autoMinutes: Math.round(autoMs / MINUTE_MS),
    totalMinutes: Math.round(totalMs / MINUTE_MS),
    runningMinutes: Math.round(runningMs / MINUTE_MS),
    manualMs,
    autoMs,
    totalMs,
    onBreak: entries.some(entry => !entry.end),
    count: entries.length,
  };
};

/** Working time with break time taken out; it never goes below zero. */
const netWorkedMs = (grossMs, breakMs = 0) => Math.max(0, Math.round(Number(grossMs) || 0) - Math.max(0, Math.round(Number(breakMs) || 0)));

/**
 * May another break start now? {ok, blocked, message}. With limits set to WARN the break still
 * starts and the message is what the admin and the employee are told.
 */
const canStartBreak = ({ policy, breaks = [], inTime, now = new Date(), isClockedIn = true } = {}) => {
  if (!policy || policy.mode === 'OFF') {
    return { ok: false, blocked: true, message: 'Break tracking is off for your company.' };
  }
  if (!isClockedIn) {
    return { ok: false, blocked: true, message: 'Clock in first, then start your break.' };
  }
  const entries = Array.isArray(breaks) ? breaks : [];
  if (entries.some(entry => entry?.start && !entry?.end)) {
    return { ok: false, blocked: true, message: 'A break is already running. End it first.' };
  }

  const kind = classifyBreak(policy, now);
  if (policy.mode === 'FIXED' && kind.type === 'EXTRA' && policy.allowExtraBreak === false) {
    return { ok: false, blocked: true, message: 'Only the scheduled breaks are allowed. Please wait for the next one.' };
  }

  const limits = policy.limits || {};
  if (limits.enabled) {
    const totals = breakTotalsFor({ policy, breaks: entries, inTime, now });
    const countReached = limits.maxBreaksPerDay > 0 && totals.count >= limits.maxBreaksPerDay;
    const minutesReached = limits.maxMinutesPerDay > 0 && totals.totalMinutes >= limits.maxMinutesPerDay;
    if (countReached || minutesReached) {
      const message = countReached
        ? `You have already taken ${totals.count} break${totals.count === 1 ? '' : 's'} today (limit ${limits.maxBreaksPerDay}).`
        : `Your breaks add up to ${totals.totalMinutes} minutes today (limit ${limits.maxMinutesPerDay}).`;
      if (limits.enforce === 'BLOCK') return { ok: false, blocked: true, message };
      return { ok: true, blocked: false, warning: message, message };
    }
  }

  return { ok: true, blocked: false, type: kind.type, label: kind.label };
};

module.exports = {
  INDIA_OFFSET_MS,
  MODES,
  INHERIT,
  POLICY_LEVELS,
  dateKeyOf,
  minutesOfClock,
  clockOfMinutes,
  indiaClockToTime,
  normalizeBreakPolicy,
  resolveBreakPolicy,
  fixedWindowsFor,
  classifyBreak,
  shouldNotifyAdmin,
  breakTotalsFor,
  netWorkedMs,
  canStartBreak,
  OFF_POLICY,
};
