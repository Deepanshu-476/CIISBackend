const { tokenFor } = require('../auth');
const { istKey, istAt, addDaysKey, lastDowBefore, lastWeekdayBefore, monthOfKey, MONTH_NAMES, minutesNowIst, hhmm } = require('../time');
const { inLiveWindow, liveShifts, LIVE_WINDOW } = require('./authSetup');
const { is, denied, rejected, has, idOf, findId, oid, rowsOf, messageOf } = require('./helpers');

const upper = v => String(v || '').toUpperCase();

// Reads one employee's month list and returns the row for a date key.
const listCache = new Map();
const attendanceRow = async (ctx, key, dateKey, { fresh = false, label } = {}) => {
  const { T } = ctx;
  const token = await tokenFor(ctx, key);
  const { year, month0 } = monthOfKey(dateKey);
  const cacheKey = `${key}:${year}-${month0}`;
  if (fresh || !listCache.has(cacheKey)) {
    const r = await T.call(label || `Attendance list ${MONTH_NAMES[month0]} ${year} (${key})`, 'GET', '/api/attendance/list', {
      token, as: key, query: { month: month0, year }, expect: '200',
    }, is(200));
    listCache.set(cacheKey, rowsOf(r.data));
  }
  return listCache.get(cacheKey).find(row => row.dateKey === dateKey || istKey(new Date(row.date)) === dateKey);
};

const expectDayStatus = async (ctx, key, dateKey, expected, why, opts = {}) => {
  const row = await attendanceRow(ctx, key, dateKey, opts);
  const actual = row ? upper(row.status) : '(no row)';
  const list = Array.isArray(expected) ? expected : [expected];
  ctx.T.assert(`${dateKey} shows ${list.join(' / ')} — ${why}`, list.includes(actual), {
    expect: list.join(' / '), actual, detail: `attendance list shows ${actual}`,
  });
  return row;
};

async function attendanceFlow(ctx) {
  const { T, state } = ctx;
  listCache.clear();
  const today = istKey();
  const owner = await tokenFor(ctx, 'owner');
  const o = { token: owner, as: 'owner' };

  // ---------- Live clock-in / clock-out against the real clock ----------
  T.setModule('Attendance: Clock-in / Clock-out (live)');
  if (!inLiveWindow()) {
    T.skip('Live clock-in tests', `Run between ${hhmm(LIVE_WINDOW.from)} and ${hhmm(LIVE_WINDOW.to)} India time (shifts are built around the current time)`);
  } else {
    const live = liveShifts();
    T.log(`Shifts built around now (${hhmm(minutesNowIst())} IST): on-time ${live.ONTIME.shiftStart}–${live.ONTIME.shiftEnd}, late ${live.LATE.shiftStart}, half-day ${live.HALF.shiftStart}, too-early ${live.EARLY.shiftStart}`);
    const ontime = await tokenFor(ctx, 'ontime');

    await T.call('Status before clock-in = not clocked in', 'GET', '/api/attendance/status', { token: ontime, as: 'ontime', expect: '200, not clocked in' },
      r => (r.status === 200 && !(r.data?.isClockedIn || r.data?.data?.isClockedIn) ? true : `got ${r.status}, isClockedIn=${r.data?.isClockedIn ?? r.data?.data?.isClockedIn}`));
    await T.call('On-time employee clocks in → PRESENT', 'POST', '/api/attendance/in', { token: ontime, as: 'ontime', body: {}, expect: '200, PRESENT' },
      r => (r.status === 200 && upper(r.data?.data?.status) === 'PRESENT' ? true : `got ${r.status} status=${r.data?.data?.status}: ${messageOf(r)}`));
    await T.call('Second clock-in same day is refused', 'POST', '/api/attendance/in', { token: ontime, as: 'ontime', body: {}, expect: '400' }, is(400));
    await T.call('Status after clock-in = clocked in', 'GET', '/api/attendance/status', { token: ontime, as: 'ontime', expect: '200, clocked in' },
      r => (r.status === 200 && has(r.data, 'true') ? true : `got ${r.status}`));
    await T.call('Clock-out after a few seconds → ABSENT (worked < half shift)', 'POST', '/api/attendance/out', { token: ontime, as: 'ontime', body: {}, expect: '200, ABSENT' },
      r => (r.status === 200 && upper(r.data?.data?.status) === 'ABSENT' ? true : `got ${r.status} status=${r.data?.data?.status}: ${messageOf(r)}`));
    await T.call('Second clock-out is refused', 'POST', '/api/attendance/out', { token: ontime, as: 'ontime', body: {}, expect: '400' }, is(400));

    const late = await tokenFor(ctx, 'late');
    await T.call('Clock-in after grace time → LATE', 'POST', '/api/attendance/in', { token: late, as: 'late', body: {}, expect: '200, LATE' },
      r => (r.status === 200 && upper(r.data?.data?.status) === 'LATE' ? true : `got ${r.status} status=${r.data?.data?.status}: ${messageOf(r)}`));
    const half = await tokenFor(ctx, 'half');
    await T.call('Clock-in 2.5 h after shift start → HALF DAY', 'POST', '/api/attendance/in', { token: half, as: 'half', body: {}, expect: '200, HALF DAY' },
      r => (r.status === 200 && upper(r.data?.data?.status) === 'HALF DAY' ? true : `got ${r.status} status=${r.data?.data?.status}: ${messageOf(r)}`));
    const early = await tokenFor(ctx, 'early');
    await T.call('Clock-in before the early window is refused', 'POST', '/api/attendance/in', { token: early, as: 'early', body: {}, expect: '400 too early' },
      r => (r.status === 400 && /early/i.test(messageOf(r)) ? true : `got ${r.status}: ${messageOf(r)}`));
    await T.call('Clock-in without login → 401', 'POST', '/api/attendance/in', { body: {}, as: 'guest', expect: '401' }, is(401));

    await expectDayStatus(ctx, 'late', today, 'LATE', 'late employee (attendance list)');
    await expectDayStatus(ctx, 'half', today, 'HALF DAY', 'half-day employee (attendance list)');
    await expectDayStatus(ctx, 'ontime', today, 'ABSENT', 'short punch employee (attendance list)');
  }

  // ---------- Shift rules matrix through the preview API ----------
  T.setModule('Attendance: Shift rules (09:00–18:00)');
  const D = lastWeekdayBefore(today, 0);
  const at = t => istAt(D, t).toISOString();
  const cases = [
    ['09:05', '18:05', 'PRESENT', 'in within grace, full day'],
    ['09:10', '18:00', 'PRESENT', 'in exactly at grace limit 09:10'],
    ['09:30', '18:00', 'LATE', 'in after grace 09:10, before 11:00'],
    ['10:59', '18:00', 'LATE', 'in at 10:59, one minute before half-day line'],
    ['11:00', '18:00', 'HALF DAY', 'in at 11:00 = shift start + 2 h'],
    ['11:30', '18:00', 'HALF DAY', 'in after 11:00'],
    ['09:00', '17:45', 'PRESENT', 'on time, out 17:45 is after the 17:30 short-leave line'],
    ['09:00', '16:00', 'SHORT LEAVE', 'on time, out between 14:00 and 17:30'],
    ['09:00', '13:45', 'HALF DAY', 'on time, out before 14:00, worked ≥ 4.5 h'],
    ['09:00', '12:00', 'ABSENT', 'worked 3 h < half of 9 h shift'],
    ['12:00', '14:00', 'ABSENT', 'late and worked only 2 h'],
    ['09:30', '15:00', 'LATE', 'late in + early out keeps LATE'],
  ];
  for (const [inT, outT, expected, why] of cases) {
    await T.call(`In ${inT} / out ${outT} → ${expected} (${why})`, 'POST', '/api/attendance/preview', {
      ...o, body: { userId: state.users.std.id, date: D, inTime: at(inT), outTime: at(outT) }, expect: expected,
    }, r => (r.status === 200 && upper(r.data?.data?.suggestedStatus) === expected ? true : `got ${r.status} → ${r.data?.data?.suggestedStatus || messageOf(r)}`));
  }
  await T.call('Preview "half day line" is shift start + 2 h (11:00)', 'POST', '/api/attendance/preview', {
    ...o, body: { userId: state.users.std.id, date: D, inTime: at('09:00') }, expect: 'halfDayLateLimit 11:00',
  }, r => (r.status === 200 && r.data?.data?.shiftSettings?.halfDayLateLimit === '11:00' ? true : `got ${JSON.stringify(r.data?.data?.shiftSettings)}`));

  // ---------- Manual attendance by admin ----------
  T.setModule('Attendance: Manual entry by admin');
  const std = await tokenFor(ctx, 'std');
  await T.call('Employee cannot add manual attendance', 'POST', '/api/attendance/manual', {
    token: std, as: 'std', body: { user: state.users.std.id, date: D, inTime: at('09:00'), outTime: at('18:00') }, expect: '403',
  }, denied);
  const manual = await T.call(`Admin adds attendance ${D} 09:30–18:00 → LATE`, 'POST', '/api/attendance/manual', {
    ...o, body: { user: state.users.std.id, date: D, inTime: at('09:30'), outTime: at('18:00') }, expect: '201, LATE',
  }, r => ([200, 201].includes(r.status) && upper(r.data?.data?.status) === 'LATE' ? true : `got ${r.status} status=${r.data?.data?.status}: ${messageOf(r)}`));
  const manualId = idOf(manual.data, 'data._id') || await findId('attendances', { user: oid(state.users.std.id), date: { $gte: istAt(D, '00:00'), $lte: istAt(D, '23:59') } });
  await expectDayStatus(ctx, 'std', D, 'LATE', 'manual entry shows in employee list', { fresh: true });
  if (manualId) {
    await T.call('Admin edits it to 09:00–18:00 → PRESENT', 'PUT', `/api/attendance/${manualId}`, {
      ...o, body: { inTime: at('09:00'), outTime: at('18:00') }, expect: '200, PRESENT',
    }, r => (r.status === 200 && upper(r.data?.data?.status) === 'PRESENT' ? true : `got ${r.status} status=${r.data?.data?.status}: ${messageOf(r)}`));
    await expectDayStatus(ctx, 'std', D, 'PRESENT', 'edited entry is recalculated', { fresh: true });
    await T.call('Employee cannot delete attendance', 'DELETE', `/api/attendance/${manualId}`, { token: std, as: 'std', expect: '403' }, denied);
    await T.call('Admin deletes the entry', 'DELETE', `/api/attendance/${manualId}`, { ...o, expect: '200' }, is(200, 204));
    await expectDayStatus(ctx, 'std', D, 'ABSENT', 'deleted day with no punch is ABSENT', { fresh: true });
  } else {
    T.skip('Edit / delete manual attendance', 'Manual entry id not found');
  }

  T.setModule('Attendance: Admin views');
  await T.call('Admin: all employees attendance', 'GET', '/api/attendance/all', { ...o, expect: '200' }, is(200));
  await T.call('Admin: attendance stats', 'GET', '/api/attendance/stats', { ...o, expect: '200' }, is(200));
  await T.call('Admin: one employee attendance', 'GET', `/api/attendance/user/${state.users.std.id}`, { ...o, expect: '200' }, is(200));
  await T.call('Employee: all employees attendance → 403', 'GET', '/api/attendance/all', { token: std, as: 'std', expect: '403' }, denied);
}

async function weekendFlow(ctx) {
  const { T, state } = ctx;
  T.setModule('Weekend work & Overtime (extra day)');
  const today = istKey();
  const owner = await tokenFor(ctx, 'owner');
  const o = { token: owner, as: 'owner' };
  const wk = await tokenFor(ctx, 'weekend');
  const w = { token: wk, as: 'weekend' };
  const userId = state.users.weekend.id;

  const sat = lastDowBefore(6, today);
  const sun = lastDowBefore(0, today);
  const sat2 = addDaysKey(sat, -7);
  const fri = addDaysKey(sat, -1);
  T.log(`Weekend employee (5-day week): Saturday ${sat}, Sunday ${sun}, older Saturday ${sat2}, Friday ${fri}`);

  await expectDayStatus(ctx, 'weekend', sat2, 'WEEKEND', 'Saturday with no punch is a weekly off');
  if (fri < today) await expectDayStatus(ctx, 'weekend', fri, 'ABSENT', 'Friday with no punch is ABSENT');

  await T.call(`Saturday ${sat}: worked 09:00–12:00 (manual)`, 'POST', '/api/attendance/manual', {
    ...o, body: { user: userId, date: sat, inTime: istAt(sat, '09:00').toISOString(), outTime: istAt(sat, '12:00').toISOString() }, expect: '201',
  }, is(200, 201));
  await T.call(`Sunday ${sun}: worked 11:30–18:00 (manual)`, 'POST', '/api/attendance/manual', {
    ...o, body: { user: userId, date: sun, inTime: istAt(sun, '11:30').toISOString(), outTime: istAt(sun, '18:00').toISOString() }, expect: '201',
  }, is(200, 201));
  listCache.clear();
  await expectDayStatus(ctx, 'weekend', sat, 'WEEKEND', 'short weekend punch stays a weekly off (not ABSENT)', { fresh: true });
  await expectDayStatus(ctx, 'weekend', sun, 'PRESENT', 'weekend work is not marked late/half-day');

  // Overtime request: full extra day for the Saturday worked
  const otBody = { requestType: 'SINGLE_DAY', dates: [sat], calculationType: 'FULL_DAY_PRESENT', reason: 'ZZ Lab: worked on Saturday' };
  const req1 = await T.call(`Employee requests full-day overtime for Saturday ${sat}`, 'POST', '/api/overtime/request', { ...w, body: otBody, expect: '201' }, is(200, 201));
  const otId = idOf(req1.data, 'data._id') || await findId('overtimerequests', { user: oid(userId), dateKeys: sat });
  await T.call('Same date requested again is refused', 'POST', '/api/overtime/request', { ...w, body: otBody, expect: '400' }, is(400));
  await T.call('My overtime requests show it as Pending', 'GET', '/api/overtime/my-requests', { ...w, expect: '200, Pending' },
    r => (r.status === 200 && has(r.data, otId) && has(r.data, 'Pending') ? true : `got ${r.status}; request or Pending missing`));
  if (otId) {
    await T.call('Employee cannot approve own overtime', 'PUT', `/api/overtime/admin-action/${otId}`, { ...w, body: { action: 'Approve', isFullDayApproved: true }, expect: '403' }, denied);
    await T.call('Admin sees the overtime request', 'GET', '/api/overtime/admin-requests', { ...o, expect: '200, has request' },
      r => (r.status === 200 && has(r.data, otId) ? true : `got ${r.status}; request missing`));
    await T.call('Admin approves it as 1 full day', 'PUT', `/api/overtime/admin-action/${otId}`, { ...o, body: { action: 'Approve', isFullDayApproved: true }, expect: '200' }, is(200));
    await T.call('Employee sees it Approved', 'GET', '/api/overtime/my-requests', { ...w, expect: 'Approved' },
      r => (r.status === 200 && has(r.data, 'Approved') ? true : `got ${r.status}; not Approved`));
    const row = await expectDayStatus(ctx, 'weekend', sat, 'PRESENT', 'approved weekend overtime counts as a present day', { fresh: true });
    T.assert(`${sat} shows overtime "Full Day"`, row && (row.overTime === 'Full Day' || row.isFullDayOt === true), {
      expect: 'overTime = Full Day', actual: row ? `${row.overTime} / isFullDayOt=${row.isFullDayOt}` : '(no row)',
    });
  } else {
    T.skip('Approve weekend overtime', 'Overtime request id not found');
  }

  // Full-day overtime for a weekend day with no punch at all
  const req2 = await T.call(`Full-day overtime for ${sat2} (no punch that day)`, 'POST', '/api/overtime/request', {
    ...w, body: { ...otBody, dates: [sat2] }, expect: '201',
  }, is(200, 201));
  const ot2 = idOf(req2.data, 'data._id') || await findId('overtimerequests', { user: oid(userId), dateKeys: sat2 });
  if (ot2) {
    await T.call('Admin approves it', 'PUT', `/api/overtime/admin-action/${ot2}`, { ...o, body: { action: 'Approve', isFullDayApproved: true }, expect: '200' }, is(200));
    listCache.clear();
    await expectDayStatus(ctx, 'weekend', sat2, 'PRESENT', 'approved overtime creates a present day', { fresh: true });
  }

  // Hours-based request that gets rejected
  const req3 = await T.call(`2-hour overtime request for ${sun}`, 'POST', '/api/overtime/request', {
    ...w, body: { requestType: 'SINGLE_DAY', dates: [sun], calculationType: 'BY_HOURS', requestedHours: 2, reason: 'ZZ Lab extra hours' }, expect: '201',
  }, is(200, 201));
  const ot3 = idOf(req3.data, 'data._id') || await findId('overtimerequests', { user: oid(userId), dateKeys: sun });
  if (ot3) {
    await T.call('Admin rejects it', 'PUT', `/api/overtime/admin-action/${ot3}`, { ...o, body: { action: 'Reject', rejectionReason: 'ZZ Lab reject test' }, expect: '200' }, is(200));
    await T.call('Employee sees it Rejected', 'GET', '/api/overtime/my-requests', { ...w, expect: 'Rejected' },
      r => (r.status === 200 && has(r.data, 'Rejected') ? true : `got ${r.status}; not Rejected`));
    const row = await expectDayStatus(ctx, 'weekend', sun, 'PRESENT', 'rejected overtime does not change the day', { fresh: true });
    T.assert(`${sun} has no overtime after rejection`, row && !row.hasOvertimeApproved, { expect: 'hasOvertimeApproved = false', actual: row ? String(row.hasOvertimeApproved) : '(no row)' });
  }
  await T.call('Invalid overtime request type is refused', 'POST', '/api/overtime/request', { ...w, body: { requestType: 'NOPE' }, expect: '400' }, is(400));
}

async function leaveFlow(ctx) {
  const { T, state } = ctx;
  T.setModule('Leave');
  const today = istKey();
  const owner = await tokenFor(ctx, 'owner');
  const o = { token: owner, as: 'owner' };
  const std = await tokenFor(ctx, 'std');
  const s = { token: std, as: 'std' };
  const reason = 'ZZ Lab dummy leave reason for testing the leave flow';

  await T.call('Reason shorter than 20 characters is refused', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason: 'short', startDate: today, endDate: today }, expect: '400' }, is(400));
  await T.call('Leave in the past is refused', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: addDaysKey(today, -3), endDate: addDaysKey(today, -3) }, expect: '400' }, is(400));
  await T.call('End date before start date is refused', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: addDaysKey(today, 3), endDate: addDaysKey(today, 2) }, expect: '400' }, is(400));

  const apply = await T.call(`Apply Casual leave for today ${today}`, 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: today, endDate: today }, expect: '201' }, is(200, 201));
  const leaveId = idOf(apply.data, 'data._id', 'leave._id', 'data.leave._id', '_id') || await findId('leaves', { user: oid(state.users.std.id) });
  await T.call('Overlapping leave is refused', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: today, endDate: addDaysKey(today, 1) }, expect: '400' }, is(400));
  await T.call('Leave type with no policy for this employee is refused', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Sick', reason, startDate: addDaysKey(today, 40), endDate: addDaysKey(today, 40) }, expect: '400' }, is(400));
  await T.call('Leave longer than the yearly limit (12 days) is refused', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: addDaysKey(today, 60), endDate: addDaysKey(today, 74) }, expect: '400' }, is(400));
  await T.call('My leaves show it Pending', 'GET', '/api/leaves/my', { ...s, expect: 'Pending' },
    r => (r.status === 200 && has(r.data, leaveId) && has(r.data, 'Pending') ? true : `got ${r.status}; leave/Pending missing`));
  await T.call('Admin sees it in all leaves', 'GET', '/api/leaves/all', { ...o, expect: 'has leave' },
    r => (r.status === 200 && has(r.data, leaveId) ? true : `got ${r.status}; leave missing`));
  if (leaveId) {
    const other = await tokenFor(ctx, 'ontime');
    await T.call('Another employee cannot approve it', 'PATCH', `/api/leaves/status/${leaveId}`, { token: other, as: 'ontime', body: { status: 'Approved' }, expect: '403' }, denied);
    await T.call('Employee cannot approve own leave', 'PATCH', `/api/leaves/status/${leaveId}`, { ...s, body: { status: 'Approved' }, expect: '403' }, denied);
    await T.call('Admin approves the leave', 'PATCH', `/api/leaves/status/${leaveId}`, { ...o, body: { status: 'Approved', remarks: 'ZZ Lab ok' }, expect: '200' }, is(200));
    await T.call('Employee sees it Approved', 'GET', '/api/leaves/my', { ...s, expect: 'Approved' },
      r => (r.status === 200 && has(r.data, 'Approved') ? true : `got ${r.status}; not Approved`));
    await T.call('Leave status filter = Approved', 'GET', '/api/leaves/status', { ...s, query: { status: 'Approved' }, expect: 'has leave' },
      r => (r.status === 200 && has(r.data, leaveId) ? true : `got ${r.status}; leave missing`));
    await expectDayStatus(ctx, 'std', today, 'LEAVE', 'approved leave shows in attendance', { fresh: true });
  }

  const apply2 = await T.call('Apply leave 5 days ahead', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: addDaysKey(today, 5), endDate: addDaysKey(today, 6) }, expect: '201' }, is(200, 201));
  const leave2 = idOf(apply2.data, 'data._id', 'leave._id', 'data.leave._id', '_id') || await findId('leaves', { user: oid(state.users.std.id), status: 'Pending' });
  if (leave2) {
    await T.call('Admin rejects it', 'PATCH', `/api/leaves/status/${leave2}`, { ...o, body: { status: 'Rejected', remarks: 'ZZ Lab reject' }, expect: '200' }, is(200));
    await T.call('Employee sees it Rejected', 'GET', '/api/leaves/my', { ...s, expect: 'Rejected' },
      r => (r.status === 200 && has(r.data, 'Rejected') ? true : `got ${r.status}; not Rejected`));
  }
  const apply3 = await T.call('Apply leave 10 days ahead', 'POST', '/api/leaves/apply', { ...s, body: { type: 'Casual', reason, startDate: addDaysKey(today, 10), endDate: addDaysKey(today, 10) }, expect: '201' }, is(200, 201));
  const leave3 = idOf(apply3.data, 'data._id', 'leave._id', 'data.leave._id', '_id') || await findId('leaves', { user: oid(state.users.std.id), status: 'Pending' });
  if (leave3) {
    await T.call('Employee cancels own pending leave', 'PATCH', `/api/leaves/${leave3}/cancel`, { ...s, body: { remarks: 'ZZ Lab cancel' }, expect: '200' }, is(200));
    await T.call('Employee sees it Cancelled', 'GET', '/api/leaves/my', { ...s, expect: 'Cancelled' },
      r => (r.status === 200 && has(r.data, 'Cancelled') ? true : `got ${r.status}; not Cancelled`));
  }
  await T.call('Leave balance', 'GET', '/api/leaves/balance', { ...s, expect: '200' }, is(200));
  await T.call('Leave stats', 'GET', '/api/leaves/stats', { ...o, expect: '200' }, is(200));
  await T.call('Leave calendar', 'GET', '/api/leaves/calendar', { ...o, expect: '200' }, is(200));

  // Holiday shows in attendance
  T.setModule('Holidays');
  const H = lastWeekdayBefore(today, 2);
  await T.call(`Admin adds holiday on ${H}`, 'POST', '/api/holidays/add', {
    ...o, body: { title: 'ZZ Lab Holiday', date: H, month: MONTH_NAMES[monthOfKey(H).month0], description: 'dummy' }, expect: '201',
  }, is(200, 201));
  await T.call('Holiday list has it', 'GET', '/api/holidays', { ...s, expect: 'has ZZ Lab Holiday' },
    r => (r.status === 200 && has(r.data, 'ZZ Lab Holiday') ? true : `got ${r.status}; holiday missing`));
  listCache.clear();
  await expectDayStatus(ctx, 'std', H, 'HOLIDAY', 'holiday shows in attendance', { fresh: true });
  const hackDate = addDaysKey(today, 20);
  await T.call('Employee cannot add a company holiday', 'POST', '/api/holidays/add', {
    ...s, body: { title: 'ZZ Hack Holiday', date: hackDate, month: MONTH_NAMES[monthOfKey(hackDate).month0], description: 'x' }, expect: '403',
  }, r => (denied(r) === true ? true : `got ${r.status}: an employee added a holiday for the whole company`));
  await T.call('Holiday with a wrong month value gives 400 (not 500)', 'POST', '/api/holidays/add', {
    ...o, body: { title: 'ZZ Bad Month', date: addDaysKey(today, 21), month: 'NotAMonth', description: 'x' }, expect: '400',
  }, is(400));
  const holId = await findId('holidays', { title: 'ZZ Lab Holiday', companyCode: state.companyCode });
  if (holId) {
    await T.call('Employee cannot delete a company holiday', 'DELETE', `/api/holidays/${holId}`, { ...s, expect: '403' },
      r => (denied(r) === true ? true : `got ${r.status}: an employee deleted a company holiday`));
  }
}

module.exports = { attendanceFlow, weekendFlow, leaveFlow };
