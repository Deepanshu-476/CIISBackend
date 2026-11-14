/**
 * Weekly-off resolution rules: how many offs a week, which weekday each employee gets, and what an
 * approved swap does. Pure functions, so this suite needs no database.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  dateKeyOf,
  weekdayOf,
  weekStartKeyOf,
  effectiveWorkingDays,
  weekOffEntitlement,
  offWeekdaysForWeek,
  resolveOffDayKeys,
  isOffDayFor,
  validateSwap,
} = require('../HR-CDS/utils/weekOff');

// 2026-11-09 is a Monday; that week runs to Sunday 2026-11-15.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const WED = '2026-11-11';
const THU = '2026-11-12';
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const SUN = '2026-11-15';
const NEXT_WED = '2026-11-18';

const dept = (workingDays, history = []) => ({workingDays, workingDayHistory: history});
const keys = set => [...set].sort();

test('India dates and weekdays', () => {
  // 18:30 UTC is already the next day in India.
  assert.equal(dateKeyOf('2026-11-13T18:30:00.000Z'), '2026-11-14');
  assert.equal(dateKeyOf('2026-11-13T12:00:00.000Z'), '2026-11-13');
  assert.equal(weekdayOf(MON), 1);
  assert.equal(weekdayOf(SUN), 7);
  assert.equal(weekStartKeyOf(SUN), MON, 'the week starts on Monday');
  assert.equal(weekStartKeyOf(NEXT_WED), '2026-11-16');
});

test('working days come from the department, with history applied by date', () => {
  assert.equal(effectiveWorkingDays(dept(6), WED), 6);
  assert.equal(effectiveWorkingDays(null, WED), 5, 'no department falls back to five');
  const withHistory = dept(5, [
    {workingDays: 6, effectiveFrom: '2026-11-12T00:00:00.000Z'},
    {workingDays: 5, effectiveFrom: '2026-01-01T00:00:00.000Z'},
  ]);
  assert.equal(effectiveWorkingDays(withHistory, '2026-11-11'), 5, 'before the change');
  assert.equal(effectiveWorkingDays(withHistory, '2026-11-13'), 6, 'after the change');
  assert.equal(weekOffEntitlement(dept(6), WED), 1);
  assert.equal(weekOffEntitlement(dept(5), WED), 2);
  assert.equal(weekOffEntitlement(dept(7), WED), 0);
});

test('with no day set, the old end-of-week pattern still applies', () => {
  assert.deepEqual(offWeekdaysForWeek({department: dept(6)}, WED), [7], 'six-day week: Sunday off');
  assert.deepEqual(offWeekdaysForWeek({department: dept(5)}, WED), [6, 7], 'five-day week: Sat + Sun');
  assert.deepEqual(offWeekdaysForWeek({department: dept(7)}, WED), [], 'seven-day week: no off');
});

test("an employee's own off day replaces the default one", () => {
  assert.deepEqual(offWeekdaysForWeek({department: dept(6), weekOffDays: [2]}, WED), [2], 'Tuesday off');
  const offKeys = resolveOffDayKeys({department: dept(6), weekOffDays: [2], from: MON, to: SUN});
  assert.deepEqual(keys(offKeys), [TUE]);
  assert.equal(isOffDayFor({department: dept(6), weekOffDays: [2]}, TUE), true);
  assert.equal(isOffDayFor({department: dept(6), weekOffDays: [2]}, SUN), false, 'Sunday is now a working day');
});

test('two offs a week can be two chosen days', () => {
  const person = {department: dept(5), weekOffDays: [3, 7]};
  assert.deepEqual(keys(resolveOffDayKeys({...person, from: MON, to: SUN})), [WED, SUN]);
});

test('more days than the entitlement are trimmed, fewer are filled from the end of the week', () => {
  // One off a week but three days chosen: only the first counts.
  assert.deepEqual(offWeekdaysForWeek({department: dept(6), weekOffDays: [2, 4, 6]}, WED), [2]);
  // Two offs a week with one day chosen: the rest comes from the end of the week, skipping it.
  assert.deepEqual(offWeekdaysForWeek({department: dept(5), weekOffDays: [3]}, WED), [3, 7]);
  // Junk input is ignored.
  assert.deepEqual(offWeekdaysForWeek({department: dept(6), weekOffDays: [0, 9, 'x', null]}, WED), [7]);
});

test('an approved swap moves the off day inside that week only', () => {
  const swap = {status: 'Approved', weekStartKey: MON, fromDateKey: SUN, toDateKey: WED};
  const person = {department: dept(6), swaps: [swap]};
  const thisWeek = resolveOffDayKeys({...person, from: MON, to: SUN});
  assert.deepEqual(keys(thisWeek), [WED], 'Wednesday off instead of Sunday');

  // The next week is untouched: Sunday is the off day again.
  const nextWeek = resolveOffDayKeys({...person, from: '2026-11-16', to: '2026-11-22'});
  assert.deepEqual(keys(nextWeek), ['2026-11-22']);
});

test('a swap never adds or removes a day', () => {
  const swap = {status: 'Approved', weekStartKey: MON, fromDateKey: SUN, toDateKey: WED};
  const withSwap = resolveOffDayKeys({department: dept(6), swaps: [swap], from: MON, to: SUN});
  const without = resolveOffDayKeys({department: dept(6), from: MON, to: SUN});
  assert.equal(withSwap.size, without.size);
  assert.equal(withSwap.has(SUN), false, 'the given-up day becomes a working day');
});

test('a swap that is not approved changes nothing', () => {
  ['Pending', 'Rejected'].forEach(status => {
    const swap = {status, weekStartKey: MON, fromDateKey: SUN, toDateKey: WED};
    const offKeys = resolveOffDayKeys({department: dept(6), swaps: [swap], from: MON, to: SUN});
    assert.deepEqual(keys(offKeys), [SUN], `${status} must not move the off day`);
  });
});

test('a swap pointing outside its week cannot smuggle in an extra day', () => {
  const swap = {status: 'Approved', weekStartKey: MON, fromDateKey: SUN, toDateKey: NEXT_WED};
  const offKeys = resolveOffDayKeys({department: dept(6), swaps: [swap], from: MON, to: '2026-11-22'});
  assert.equal(offKeys.has(NEXT_WED), false, 'the stray target is ignored');
  assert.equal(offKeys.has(SUN), false, 'and the given-up day is still given up');
});

test('a month spanning a working-days change resolves week by week', () => {
  const department = dept(5, [
    {workingDays: 5, effectiveFrom: '2026-01-01T00:00:00.000Z'},
    {workingDays: 6, effectiveFrom: '2026-11-16T00:00:00.000Z'},
  ]);
  const offKeys = resolveOffDayKeys({department, from: MON, to: '2026-11-22'});
  // First week five days: Sat + Sun. Second week six days: Sunday only.
  assert.deepEqual(keys(offKeys), [SAT, SUN, '2026-11-22']);
});

test('a seven-day department has no off days at all', () => {
  assert.equal(resolveOffDayKeys({department: dept(7), from: MON, to: SUN}).size, 0);
});

test('only the dates asked for come back', () => {
  const offKeys = resolveOffDayKeys({department: dept(5), from: THU, to: SAT});
  assert.deepEqual(keys(offKeys), [SAT], 'Sunday is outside the range');
  assert.equal(resolveOffDayKeys({department: dept(5), from: SUN, to: THU}).size, 0, 'reversed range');
  assert.equal(resolveOffDayKeys({department: dept(5), from: 'nonsense', to: SAT}).size, 0);
});

test('a swap request is accepted when it moves the single off day of that week', () => {
  const result = validateSwap({department: dept(6), toDate: WED});
  assert.equal(result.ok, true);
  assert.equal(result.fromDateKey, SUN, 'the scheduled Sunday is given up');
  assert.equal(result.toDateKey, WED);
  assert.equal(result.weekStartKey, MON);
});

test('a swap request is refused when it makes no sense', () => {
  // The day is already the off day.
  assert.equal(validateSwap({department: dept(6), toDate: SUN}).ok, false);
  // The department works all seven days.
  assert.equal(validateSwap({department: dept(7), toDate: WED}).ok, false);
  // Nonsense date.
  assert.equal(validateSwap({department: dept(6), toDate: 'not-a-date'}).ok, false);
  // Giving up a day that is not an off day.
  const wrongFrom = validateSwap({department: dept(6), toDate: WED, fromDate: THU});
  assert.equal(wrongFrom.ok, false);
  assert.match(wrongFrom.message, /not your weekly off/);
});

test('with two offs a week the employee must say which day they are giving up', () => {
  const ambiguous = validateSwap({department: dept(5), toDate: WED});
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.message, /more than one weekly off/);

  const explicit = validateSwap({department: dept(5), toDate: WED, fromDate: SAT});
  assert.equal(explicit.ok, true);
  assert.equal(explicit.fromDateKey, SAT);
});

test('a second swap in the same week is validated against the first', () => {
  const firstSwap = {status: 'Approved', weekStartKey: MON, fromDateKey: SUN, toDateKey: WED};
  // Wednesday is the off day now, so asking for Wednesday again is refused…
  assert.equal(validateSwap({department: dept(6), swaps: [firstSwap], toDate: WED}).ok, false);
  // …and giving up Wednesday for Friday is fine.
  const second = validateSwap({department: dept(6), swaps: [firstSwap], toDate: FRI});
  assert.equal(second.ok, true);
  assert.equal(second.fromDateKey, WED);
});
