/**
 * Which calendar dates are a given employee's weekly offs.
 *
 * The department only says HOW MANY days a week are off (7 - workingDays). Until now those days
 * were always at the end of the week and the same for everyone in the department. Now:
 *   - each employee can have their own fixed off weekday(s) (`user.weekOffDays`, 1 = Monday … 7 =
 *     Sunday); with none set the old end-of-week pattern still applies, so nothing changes for a
 *     company that has not set anything;
 *   - for a single week the employee can swap that day for another day of the SAME week, once an
 *     approved WeekOffRequest says so. A swap moves the day, it never adds one: the scheduled day
 *     becomes a working day and the chosen date becomes the off day.
 *
 * Everything here is pure (no database, no clock) so the rules can be tested, and both attendance
 * and payroll resolve off days through this one place.
 */
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = value => (value instanceof Date ? value : new Date(value));

/** 'YYYY-MM-DD' for the India day a timestamp falls in. */
const dateKeyOf = value => {
  // new Date(null) is the epoch, not an invalid date, so empty input is rejected first.
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
};

const weekdayOfKey = key => {
  if (!key) return 0;
  const day = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

/** Monday = 1 … Sunday = 7, in India time. */
const weekdayOf = value => weekdayOfKey(dateKeyOf(value));

const addDaysToKey = (key, days) => {
  if (!key) return '';
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
};

/** The key of the Monday that starts this date's week. */
const weekStartKeyOf = value => {
  const key = dateKeyOf(value);
  if (!key) return '';
  return addDaysToKey(key, -(weekdayOfKey(key) - 1));
};

const normalizeWorkingDays = value => {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 7 ? days : 5;
};

/** The department's working days for a date, honouring workingDayHistory. */
const effectiveWorkingDays = (department, date) => {
  if (!department) return 5;
  const targetKey = dateKeyOf(date);
  let days = normalizeWorkingDays(department.workingDays);
  const history = Array.isArray(department.workingDayHistory)
    ? [...department.workingDayHistory]
        .filter(entry => entry?.effectiveFrom)
        .sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom))
    : [];
  history.forEach(entry => {
    if (dateKeyOf(entry.effectiveFrom) <= targetKey) days = normalizeWorkingDays(entry.workingDays);
  });
  return days;
};

/** How many weekly offs this employee gets in a week. */
const weekOffEntitlement = (department, date) => Math.max(0, 7 - effectiveWorkingDays(department, date));

/** Valid, de-duplicated off weekdays, at most as many as the entitlement allows. */
const normalizeWeekOffDays = (list, limit = 7) => {
  const days = [...new Set((Array.isArray(list) ? list : [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 7))]
    .sort((a, b) => a - b);
  return limit >= 0 ? days.slice(0, limit) : days;
};

/**
 * The off weekdays for one week: the employee's own days when set, otherwise the end of the week,
 * which is what every department used before this existed.
 */
const offWeekdaysForWeek = ({department, weekOffDays = []} = {}, dateInWeek) => {
  const entitlement = weekOffEntitlement(department, dateInWeek);
  if (entitlement <= 0) return [];
  const chosen = normalizeWeekOffDays(weekOffDays, entitlement);
  if (chosen.length === entitlement) return chosen;
  // Partly set (or not set at all): fill the rest from the end of the week, skipping chosen days.
  const filled = [...chosen];
  for (let weekday = 7; weekday >= 1 && filled.length < entitlement; weekday -= 1) {
    if (!filled.includes(weekday)) filled.push(weekday);
  }
  return filled.sort((a, b) => a - b);
};

const isApprovedSwap = swap => String(swap?.status || 'Approved') === 'Approved';

/**
 * Every off-day date key for one employee between two dates (inclusive).
 *
 * `swaps` are that employee's WeekOffRequest documents; only approved ones count, and each one only
 * affects its own week.
 */
const resolveOffDayKeys = ({department, weekOffDays = [], swaps = [], from, to} = {}) => {
  const fromKey = dateKeyOf(from);
  const toKey = dateKeyOf(to);
  if (!fromKey || !toKey || fromKey > toKey) return new Set();

  const swapsByWeek = new Map();
  (Array.isArray(swaps) ? swaps : []).filter(isApprovedSwap).forEach(swap => {
    const weekKey = swap.weekStartKey || weekStartKeyOf(swap.fromDateKey || swap.toDateKey);
    if (!weekKey) return;
    swapsByWeek.set(weekKey, [...(swapsByWeek.get(weekKey) || []), swap]);
  });

  const offKeys = new Set();
  let weekKey = weekStartKeyOf(fromKey);
  const lastWeekKey = weekStartKeyOf(toKey);

  while (weekKey && weekKey <= lastWeekKey) {
    const weekDates = Array.from({length: 7}, (_, index) => addDaysToKey(weekKey, index));
    // The entitlement can change mid-month (workingDayHistory), so read it per week.
    const weekdays = offWeekdaysForWeek({department, weekOffDays}, weekKey);
    const weekOffKeys = new Set(weekdays.map(weekday => weekDates[weekday - 1]).filter(Boolean));

    (swapsByWeek.get(weekKey) || []).forEach(swap => {
      if (swap.fromDateKey) weekOffKeys.delete(swap.fromDateKey);
      if (swap.toDateKey && weekDates.includes(swap.toDateKey)) weekOffKeys.add(swap.toDateKey);
    });

    weekOffKeys.forEach(key => {
      if (key >= fromKey && key <= toKey) offKeys.add(key);
    });
    weekKey = addDaysToKey(weekKey, 7);
  }

  return offKeys;
};

/** Is this one date an off day for this employee? */
const isOffDayFor = ({department, weekOffDays = [], swaps = []} = {}, date) => {
  const key = dateKeyOf(date);
  if (!key) return false;
  return resolveOffDayKeys({department, weekOffDays, swaps, from: key, to: key}).has(key);
};

/**
 * Can this swap be made? Returns {ok: true, fromDateKey, toDateKey, weekStartKey} or
 * {ok: false, message}. The chosen day must be a working day in the same week as the scheduled off
 * day it replaces, so the employee never gains or loses a day.
 */
const validateSwap = ({department, weekOffDays = [], swaps = [], toDate, fromDate = null} = {}) => {
  const toKey = dateKeyOf(toDate);
  if (!toKey) return {ok: false, message: 'Choose a valid date for the week off.'};

  if (weekOffEntitlement(department, toKey) <= 0) {
    return {ok: false, message: 'This department works all seven days, so there is no weekly off to move.'};
  }

  const weekKey = weekStartKeyOf(toKey);
  const weekDates = Array.from({length: 7}, (_, index) => addDaysToKey(weekKey, index));
  const scheduled = resolveOffDayKeys({
    department,
    weekOffDays,
    swaps,
    from: weekDates[0],
    to: weekDates[6],
  });

  if (scheduled.has(toKey)) {
    return {ok: false, message: 'That day is already your weekly off.'};
  }

  const scheduledKeys = [...scheduled].sort();
  let fromKey = dateKeyOf(fromDate);
  if (fromKey) {
    if (!scheduled.has(fromKey)) {
      return {ok: false, message: 'The day you are giving up is not your weekly off that week.'};
    }
  } else if (scheduledKeys.length === 1) {
    fromKey = scheduledKeys[0];
  } else {
    return {ok: false, message: 'You have more than one weekly off that week, so pick which day you are giving up.'};
  }

  return {ok: true, fromDateKey: fromKey, toDateKey: toKey, weekStartKey: weekKey};
};

module.exports = {
  INDIA_OFFSET_MS,
  dateKeyOf,
  weekdayOf,
  weekdayOfKey,
  weekStartKeyOf,
  addDaysToKey,
  normalizeWorkingDays,
  effectiveWorkingDays,
  weekOffEntitlement,
  normalizeWeekOffDays,
  offWeekdaysForWeek,
  resolveOffDayKeys,
  isOffDayFor,
  validateSwap,
};
