/**
 * Break rules: whose policy applies, how break time is counted (punched and auto-deducted), what
 * the admin is told about, and when another break may start. Pure functions, so no database.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  overstayFor,
  normalizeReasons,
  DEFAULT_REASONS,
  normalizeBreakPolicy,
  resolveBreakPolicy,
  fixedWindowsFor,
  classifyBreak,
  shouldNotifyAdmin,
  breakTotalsFor,
  netWorkedMs,
  canStartBreak,
  indiaClockToTime,
} = require('../HR-CDS/utils/breaks');

// A working day in India time: clock in 09:30, clock out 18:30.
const DAY = '2026-11-16';
const at = clock => new Date(indiaClockToTime(`${DAY}T06:00:00.000Z`, clock));
const IN = at('09:30');
const OUT = at('18:30');
const hours = n => n * 60 * 60 * 1000;

const fixedPolicy = (over = {}) => normalizeBreakPolicy({
  mode: 'FIXED',
  fixedBreaks: [
    { name: 'Lunch', start: '13:00', end: '13:30' },
    { name: 'Tea', start: '16:00', end: '16:15' },
  ],
  ...over,
});
const flexiblePolicy = (over = {}) => normalizeBreakPolicy({ mode: 'FLEXIBLE', ...over });

test('a policy is cleaned up, and nonsense windows are dropped', () => {
  const policy = normalizeBreakPolicy({
    mode: 'fixed',
    fixedBreaks: [
      { name: 'Tea', start: '16:00', end: '16:15' },
      { name: 'Lunch', start: '13:00', end: '13:30' },
      { name: 'Broken', start: '14:00', end: '13:00' },   // ends before it starts
      { name: 'Junk', start: '99:99', end: '10:00' },
    ],
  });
  assert.equal(policy.mode, 'FIXED');
  assert.deepEqual(policy.fixedBreaks.map(item => item.name), ['Lunch', 'Tea'], 'sorted by start, junk removed');
  assert.equal(policy.fixedBreaks[0].minutes, 30);
  assert.equal(policy.fixedBreaks[0].autoDeduct, true, 'windows deduct themselves unless told otherwise');
  assert.equal(normalizeBreakPolicy({}).mode, 'INHERIT', 'nothing set means inherit');
});

test('limits only count as set when a number comes with them', () => {
  assert.equal(normalizeBreakPolicy({ mode: 'FLEXIBLE', limits: { enabled: true } }).limits.enabled, false);
  const withCount = normalizeBreakPolicy({ mode: 'FLEXIBLE', limits: { enabled: true, maxBreaksPerDay: 3 } });
  assert.equal(withCount.limits.enabled, true);
  assert.equal(withCount.limits.enforce, 'WARN', 'warn unless the admin picks block');
  const blocking = normalizeBreakPolicy({ mode: 'FLEXIBLE', limits: { enabled: true, maxMinutesPerDay: 45, enforce: 'block' } });
  assert.equal(blocking.limits.enforce, 'BLOCK');
});

test('the most specific policy wins, and nothing set means breaks are off', () => {
  const company = { mode: 'FIXED', fixedBreaks: [{ name: 'Lunch', start: '13:00', end: '13:30' }] };
  const department = { mode: 'FLEXIBLE' };
  assert.equal(resolveBreakPolicy({ company }).source, 'company');
  assert.equal(resolveBreakPolicy({ company, department }).mode, 'FLEXIBLE');
  assert.equal(resolveBreakPolicy({ company, department }).source, 'department');
  assert.equal(resolveBreakPolicy({ company, department, jobRole: { mode: 'OFF' } }).mode, 'OFF', 'a shift can switch it off');
  assert.equal(resolveBreakPolicy({ company, branch: { mode: 'INHERIT' } }).source, 'company', 'inherit is skipped');
  assert.equal(resolveBreakPolicy({}).mode, 'OFF');
  assert.equal(resolveBreakPolicy({}).source, 'default');
});

test('fixed windows land on the right day in India time', () => {
  const windows = fixedWindowsFor(fixedPolicy(), IN);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].startTime, at('13:00').getTime());
  assert.equal(windows[0].endTime, at('13:30').getTime());
  assert.equal(fixedWindowsFor(flexiblePolicy(), IN).length, 0, 'a flexible company has no windows');
});

test('a break is recognised as the scheduled one, an extra, or just a break', () => {
  assert.equal(classifyBreak(fixedPolicy(), at('13:05')).type, 'FIXED');
  assert.equal(classifyBreak(fixedPolicy(), at('13:05')).label, 'Lunch');
  assert.equal(classifyBreak(fixedPolicy(), at('12:58')).type, 'FIXED', 'a few minutes early still counts');
  assert.equal(classifyBreak(fixedPolicy(), at('15:00')).type, 'EXTRA');
  assert.equal(classifyBreak(fixedPolicy(), at('16:10')).label, 'Tea');
  assert.equal(classifyBreak(flexiblePolicy(), at('15:00')).type, 'FLEXIBLE');
});

test('the admin hears about flexible breaks and extra ones, not the scheduled ones', () => {
  assert.equal(shouldNotifyAdmin(flexiblePolicy(), 'FLEXIBLE'), true);
  assert.equal(shouldNotifyAdmin(fixedPolicy(), 'FIXED'), false, 'everyone breaks together: no notification');
  assert.equal(shouldNotifyAdmin(fixedPolicy(), 'EXTRA'), true, 'an extra break is worth telling');
  assert.equal(shouldNotifyAdmin(flexiblePolicy({ notifyAdmin: false }), 'FLEXIBLE'), false, 'admin can switch it off');
  assert.equal(shouldNotifyAdmin(normalizeBreakPolicy({ mode: 'OFF' }), 'FLEXIBLE'), false);
});

test('a fixed company deducts its windows with no button pressed', () => {
  const totals = breakTotalsFor({ policy: fixedPolicy(), breaks: [], inTime: IN, outTime: OUT });
  assert.equal(totals.autoMinutes, 45, 'lunch 30 + tea 15');
  assert.equal(totals.manualMinutes, 0);
  assert.equal(totals.totalMinutes, 45);
  assert.equal(totals.onBreak, false);
});

test('a punched break inside a window replaces the automatic deduction', () => {
  const breaks = [{ type: 'FIXED', label: 'Lunch', start: at('13:00'), end: at('13:50') }];
  const totals = breakTotalsFor({ policy: fixedPolicy(), breaks, inTime: IN, outTime: OUT });
  // 50 real minutes of lunch, and tea still deducted on its own: never 30 + 50.
  assert.equal(totals.manualMinutes, 50);
  assert.equal(totals.autoMinutes, 15);
  assert.equal(totals.totalMinutes, 65);
});

test('an employee who leaves before a window only loses the part they were there for', () => {
  const earlyOut = at('13:10');
  const totals = breakTotalsFor({ policy: fixedPolicy(), breaks: [], inTime: IN, outTime: earlyOut });
  assert.equal(totals.autoMinutes, 10, 'only the 10 minutes of lunch inside their day');
});

test('an extra break adds to the fixed ones', () => {
  const breaks = [{ type: 'EXTRA', label: 'Extra break', start: at('11:00'), end: at('11:20') }];
  const totals = breakTotalsFor({ policy: fixedPolicy(), breaks, inTime: IN, outTime: OUT });
  assert.equal(totals.manualMinutes, 20);
  assert.equal(totals.autoMinutes, 45);
  assert.equal(totals.totalMinutes, 65);
});

test('a flexible company counts only what was punched', () => {
  const breaks = [
    { type: 'FLEXIBLE', start: at('11:00'), end: at('11:15') },
    { type: 'FLEXIBLE', start: at('14:30'), end: at('15:00') },
  ];
  const totals = breakTotalsFor({ policy: flexiblePolicy(), breaks, inTime: IN, outTime: OUT });
  assert.equal(totals.totalMinutes, 45);
  assert.equal(totals.autoMinutes, 0);
  assert.equal(totals.count, 2);
});

test('a break still running counts up to now', () => {
  const breaks = [{ type: 'FLEXIBLE', start: at('14:30'), end: null }];
  const totals = breakTotalsFor({ policy: flexiblePolicy(), breaks, inTime: IN, now: at('14:50') });
  assert.equal(totals.onBreak, true);
  assert.equal(totals.runningMinutes, 20);
  assert.equal(totals.totalMinutes, 20);
});

test('working time is gross minus breaks and never negative', () => {
  const gross = hours(9);                       // 09:30 → 18:30
  assert.equal(netWorkedMs(gross, 45 * 60 * 1000), hours(9) - 45 * 60 * 1000);
  assert.equal(netWorkedMs(gross, 0), gross);
  assert.equal(netWorkedMs(hours(1), hours(3)), 0, 'a long break cannot make time negative');
  assert.equal(netWorkedMs(null, null), 0);
});

test('a second break cannot start while one is running', () => {
  const breaks = [{ start: at('14:30'), end: null }];
  const result = canStartBreak({ policy: flexiblePolicy(), breaks, inTime: IN, now: at('14:40') });
  assert.equal(result.ok, false);
  assert.match(result.message, /already running/);
});

test('a break needs a clock-in, and breaks that are off are refused', () => {
  assert.equal(canStartBreak({ policy: flexiblePolicy(), isClockedIn: false, now: at('11:00') }).ok, false);
  assert.equal(canStartBreak({ policy: normalizeBreakPolicy({ mode: 'OFF' }), inTime: IN, now: at('11:00') }).ok, false);
});

test('an extra break is allowed in a fixed company, unless the admin forbids it', () => {
  const allowed = canStartBreak({ policy: fixedPolicy(), breaks: [], inTime: IN, now: at('11:00') });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.type, 'EXTRA');

  const forbidden = canStartBreak({ policy: fixedPolicy({ allowExtraBreak: false }), breaks: [], inTime: IN, now: at('11:00') });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.message, /scheduled breaks/);
  // The scheduled one is still fine for that company.
  assert.equal(canStartBreak({ policy: fixedPolicy({ allowExtraBreak: false }), breaks: [], inTime: IN, now: at('13:05') }).ok, true);
});

test('a limit set to warn lets the break start and says so', () => {
  const policy = flexiblePolicy({ limits: { enabled: true, maxBreaksPerDay: 2, enforce: 'WARN' } });
  const breaks = [
    { start: at('11:00'), end: at('11:10') },
    { start: at('12:00'), end: at('12:10') },
  ];
  const result = canStartBreak({ policy, breaks, inTime: IN, now: at('15:00') });
  assert.equal(result.ok, true);
  assert.match(result.warning, /already taken 2 breaks/);
});

test('a limit set to block refuses the next break', () => {
  const byCount = flexiblePolicy({ limits: { enabled: true, maxBreaksPerDay: 2, enforce: 'BLOCK' } });
  const breaks = [
    { start: at('11:00'), end: at('11:10') },
    { start: at('12:00'), end: at('12:10') },
  ];
  const blocked = canStartBreak({ policy: byCount, breaks, inTime: IN, now: at('15:00') });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /limit 2/);

  const byMinutes = flexiblePolicy({ limits: { enabled: true, maxMinutesPerDay: 30, enforce: 'BLOCK' } });
  const longBreaks = [{ start: at('11:00'), end: at('11:40') }];
  const tooLong = canStartBreak({ policy: byMinutes, breaks: longBreaks, inTime: IN, now: at('15:00') });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.message, /40 minutes/);
});

test('under the limit, a break starts without a warning', () => {
  const policy = flexiblePolicy({ limits: { enabled: true, maxBreaksPerDay: 3, maxMinutesPerDay: 60, enforce: 'BLOCK' } });
  const breaks = [{ start: at('11:00'), end: at('11:10') }];
  const result = canStartBreak({ policy, breaks, inTime: IN, now: at('15:00') });
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

// ---- the gap between breaks, the cap on one break, and what a break was for ----------------

test('a policy comes with a default list of reasons, which the admin can replace', () => {
  assert.deepEqual(normalizeBreakPolicy({ mode: 'FLEXIBLE' }).reasons, DEFAULT_REASONS);
  const custom = normalizeBreakPolicy({ mode: 'FLEXIBLE', reasons: ['Lunch', 'Lunch', ' Prayer ', ''], requireReason: true });
  assert.deepEqual(custom.reasons, ['Lunch', 'Prayer'], 'trimmed, de-duplicated, blanks dropped');
  assert.equal(custom.requireReason, true);
  assert.equal(normalizeReasons(['a'.repeat(80)])[0].length, 40, 'a very long tag is cut');
});

test('a reason is demanded only when the admin asks for one', () => {
  const optional = flexiblePolicy();
  assert.equal(canStartBreak({ policy: optional, breaks: [], inTime: IN, now: at('11:00') }).ok, true);

  const required = flexiblePolicy({ requireReason: true, reasons: ['Lunch', 'Tea'] });
  const missing = canStartBreak({ policy: required, breaks: [], inTime: IN, now: at('11:00') });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /what this break is for/);

  const wrong = canStartBreak({ policy: required, breaks: [], inTime: IN, now: at('11:00'), reason: 'Cricket' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /Lunch, Tea/);

  const right = canStartBreak({ policy: required, breaks: [], inTime: IN, now: at('11:00'), reason: 'tea' });
  assert.equal(right.ok, true, 'the tag is matched without caring about case');
});

test('breaks have to be a set number of minutes apart', () => {
  const policy = flexiblePolicy({ limits: { enabled: true, minGapMinutes: 60, enforce: 'BLOCK' } });
  const breaks = [{ start: at('11:00'), end: at('11:15') }];
  const tooSoon = canStartBreak({ policy, breaks, inTime: IN, now: at('11:40') });
  assert.equal(tooSoon.ok, false);
  assert.match(tooSoon.message, /25 minutes ago/);
  assert.match(tooSoon.message, /wait 35 more/);

  const longEnough = canStartBreak({ policy, breaks, inTime: IN, now: at('12:20') });
  assert.equal(longEnough.ok, true);
});

test('the gap can warn instead of blocking', () => {
  const policy = flexiblePolicy({ limits: { enabled: true, minGapMinutes: 60, enforce: 'WARN' } });
  const breaks = [{ start: at('11:00'), end: at('11:15') }];
  const result = canStartBreak({ policy, breaks, inTime: IN, now: at('11:40') });
  assert.equal(result.ok, true);
  assert.match(result.warning, /60 minutes apart/);
});

test('the gap is measured from the last break that ended, and the first break is always free', () => {
  const policy = flexiblePolicy({ limits: { enabled: true, minGapMinutes: 60, enforce: 'BLOCK' } });
  assert.equal(canStartBreak({ policy, breaks: [], inTime: IN, now: at('11:00') }).ok, true);
  const breaks = [
    { start: at('10:00'), end: at('10:10') },
    { start: at('12:00'), end: at('12:10') },
  ];
  assert.equal(canStartBreak({ policy, breaks, inTime: IN, now: at('12:30') }).ok, false, 'measured from 12:10, not 10:10');
  assert.equal(canStartBreak({ policy, breaks, inTime: IN, now: at('13:15') }).ok, true);
});

test('a break that runs past the cap is an overstay, once', () => {
  const policy = flexiblePolicy({ limits: { enabled: true, maxSingleBreakMinutes: 20 } });
  const breaks = [{ start: at('14:00'), end: null }];
  assert.equal(overstayFor({ policy, breaks, now: at('14:15') }), null, 'still inside the cap');
  const over = overstayFor({ policy, breaks, now: at('14:35') });
  assert.equal(over.minutes, 35);
  assert.equal(over.cap, 20);
  assert.equal(over.overBy, 15);
  assert.equal(over.entry, breaks[0]);
});

test('no cap, no limits or no running break means no overstay', () => {
  const breaks = [{ start: at('14:00'), end: null }];
  assert.equal(overstayFor({ policy: flexiblePolicy(), breaks, now: at('15:00') }), null, 'no cap set');
  assert.equal(overstayFor({
    policy: flexiblePolicy({ limits: { enabled: false, maxSingleBreakMinutes: 20 } }),
    breaks,
    now: at('15:00'),
  }), null, 'limits switched off');
  assert.equal(overstayFor({
    policy: flexiblePolicy({ limits: { enabled: true, maxSingleBreakMinutes: 20 } }),
    breaks: [{ start: at('14:00'), end: at('14:10') }],
    now: at('15:00'),
  }), null, 'the break already ended');
});

test('break time is also totalled per reason, for the monthly report', () => {
  const breaks = [
    { reason: 'Lunch', start: at('13:00'), end: at('13:30') },
    { reason: 'Tea', start: at('16:00'), end: at('16:10') },
    { reason: 'Tea', start: at('17:00'), end: at('17:05') },
  ];
  const totals = breakTotalsFor({ policy: flexiblePolicy(), breaks, inTime: IN, outTime: OUT });
  assert.equal(totals.byReason.Lunch, 30);
  assert.equal(totals.byReason.Tea, 15, 'both tea breaks add up');
  assert.equal(totals.totalMinutes, 45);
});
