const mongoose = require('mongoose');
const { login, tokenFor } = require('../auth');
const { writeState, LAB_EMAIL_DOMAIN, LAB_PASSWORD } = require('../data');
const { minutesNowIst, hhmm } = require('../time');
const { is, denied, rejected, has, idOf, findId, rowsOf, messageOf } = require('./helpers');

// Dummy employees. Each one exists for a specific scenario.
const EMPLOYEES = [
  { key: 'ontime', name: 'ZZ Emp OnTime', shift: 'ONTIME', dept: 'main', note: 'clocks in inside the grace time → PRESENT' },
  { key: 'late', name: 'ZZ Emp Late', shift: 'LATE', dept: 'main', note: 'clocks in after grace → LATE' },
  { key: 'half', name: 'ZZ Emp HalfDay', shift: 'HALF', dept: 'main', note: 'clocks in 2.5 h after shift start → HALF DAY' },
  { key: 'early', name: 'ZZ Emp TooEarly', shift: 'EARLY', dept: 'main', note: 'tries to clock in before the early window → refused' },
  { key: 'std', name: 'ZZ Emp Standard', shift: 'STD', dept: 'main', note: '09:00–18:00 shift: leave, manual attendance, tasks' },
  { key: 'weekend', name: 'ZZ Emp Weekend', shift: 'STD', dept: 'weekend', note: '5-day week: Saturday/Sunday work + overtime' },
];

const STD_SHIFT = {
  shiftStart: '09:00', shiftEnd: '18:00', earlyClockInStart: '08:30', lateGraceLimit: '09:10',
  shortLeaveEarlyLimit: '17:30', halfDayEarlyLimit: '14:00',
};

// Shift windows built around "now" so the real clock-in API gives a known result.
// Valid between 03:05 and 21:20 India time.
const LIVE_WINDOW = { from: 185, to: 1280 };
const liveShifts = () => {
  const m = minutesNowIst();
  const mk = (start, end, early, grace) => ({
    shiftStart: hhmm(start), shiftEnd: hhmm(end), earlyClockInStart: hhmm(early), lateGraceLimit: hhmm(grace),
    shortLeaveEarlyLimit: hhmm(end - 5), halfDayEarlyLimit: hhmm(start + 30),
  });
  return {
    ONTIME: mk(m - 5, m + 60, m - 30, m + 10),
    LATE: mk(m - 30, m + 60, m - 60, m - 20),
    HALF: mk(m - 150, m + 60, m - 180, m - 140),
    EARLY: mk(m + 90, m + 150, m + 60, m + 100),
  };
};
const inLiveWindow = () => {
  const m = minutesNowIst();
  return m >= LIVE_WINDOW.from && m <= LIVE_WINDOW.to;
};

const buildShiftList = (state) => {
  const live = liveShifts();
  const ids = state.shiftIds;
  return [
    { shiftId: ids.ONTIME, shiftName: 'ZZ Live On-time', shiftType: 'custom', ...live.ONTIME },
    { shiftId: ids.LATE, shiftName: 'ZZ Live Late', shiftType: 'custom', ...live.LATE },
    { shiftId: ids.HALF, shiftName: 'ZZ Live Half-day', shiftType: 'custom', ...live.HALF },
    { shiftId: ids.EARLY, shiftName: 'ZZ Live Too-early', shiftType: 'custom', ...live.EARLY },
    { shiftId: ids.STD, shiftName: 'ZZ Standard 9-6', shiftType: 'general', ...STD_SHIFT },
  ];
};

async function authFlow(ctx) {
  const { T, state } = ctx;
  T.setModule('Auth & Login');
  const loginPath = `/api/auth/company/${state.companyCode}/login`;
  const owner = state.users.owner;

  await T.call('Company details by code (login screen)', 'GET', `/api/auth/company/${state.companyCode}`, { as: 'guest', expect: '200' }, is(200));
  await T.call('Login with wrong password is refused', 'POST', loginPath, {
    body: { email: owner.email, password: 'wrong-password-1' }, expect: '401', as: 'guest',
  }, r => (r.status === 401 ? true : r.status === 429 ? { warn: 'rate limited' } : `expected 401, got ${r.status}`));
  await T.call('Login with wrong company code is refused', 'POST', `/api/auth/company/ZZNOPE${Date.now() % 1000}/login`, {
    body: { email: owner.email, password: owner.password }, expect: '404', as: 'guest',
  }, r => (r.status === 404 ? true : r.status === 429 ? { warn: 'rate limited' } : `expected 404, got ${r.status}`));
  await T.call('Login with unknown email is refused', 'POST', loginPath, {
    body: { email: `nobody@${LAB_EMAIL_DOMAIN}`, password: 'x12345678' }, expect: '401', as: 'guest',
  }, r => (r.status === 401 ? true : r.status === 429 ? { warn: 'rate limited' } : `expected 401, got ${r.status}`));
  // a good login after the bad one also resets the failed-attempt counter
  await login(ctx, 'owner', { name: 'Owner login (correct password)' });

  const token = await tokenFor(ctx, 'owner');
  await T.call('Protected API without token → 401', 'GET', '/api/users/me', { as: 'guest', expect: '401' }, is(401));
  await T.call('Protected API with a fake token → 401', 'GET', '/api/users/me', { token: 'abc.def.ghi', as: 'guest', expect: '401' }, is(401));
  await T.call('Get my profile (owner)', 'GET', '/api/users/me', { token, as: 'owner', expect: '200, own email' },
    r => (r.status === 200 && has(r.data, owner.email) ? true : `got ${r.status}: ${messageOf(r)}`));
  if (owner.refreshToken) {
    await T.call('Refresh token gives a new access token', 'POST', '/api/auth/refresh', {
      body: { refreshToken: owner.refreshToken }, as: 'owner', expect: '200 + token',
    }, r => (r.status === 200 && (r.data?.token || r.data?.accessToken) ? true : `got ${r.status}: ${messageOf(r)}`));
  } else {
    T.skip('Refresh token gives a new access token', 'Login did not return a refresh token');
  }
}

async function setupFlow(ctx) {
  const { T, state, save } = ctx;
  T.setModule('Setup: Departments, Job roles, Employees');
  const owner = await tokenFor(ctx, 'owner');
  const o = { token: owner, as: 'owner' };

  // ---- Departments (created once, then reused) ----
  state.depts = state.depts || {};
  const makeDept = async (key, name, workingDays) => {
    if (state.depts[key]) return;
    const r = await T.call(`Create department "${name}" (${workingDays}-day week)`, 'POST', '/api/departments', {
      ...o, body: { name, description: 'ZZ Lab dummy', workingDays }, expect: '201',
    }, is(200, 201));
    state.depts[key] = idOf(r.data, 'data._id', 'department._id', 'data.department._id', '_id')
      || await findId('departments', { companyCode: state.companyCode, name });
    save();
  };
  await makeDept('main', 'ZZ Main Dept', 7);
  await makeDept('weekend', 'ZZ Weekend Dept', 5);

  // A throwaway department every run: create → duplicate refused → update → delete
  const tmpName = `ZZ Temp Dept ${Date.now() % 100000}`;
  const tmp = await T.call('Create a temporary department', 'POST', '/api/departments', { ...o, body: { name: tmpName, workingDays: 6 }, expect: '201' }, is(200, 201));
  const tmpId = idOf(tmp.data, 'data._id', 'department._id', 'data.department._id', '_id') || await findId('departments', { companyCode: state.companyCode, name: tmpName });
  await T.call('Duplicate department name is refused', 'POST', '/api/departments', { ...o, body: { name: tmpName, workingDays: 6 }, expect: '4xx' }, rejected);
  if (tmpId) {
    await T.call('Update department working days', 'PUT', `/api/departments/${tmpId}`, { ...o, body: { name: tmpName, workingDays: 5 }, expect: '200' }, is(200));
    await T.call('Delete the temporary department', 'DELETE', `/api/departments/${tmpId}`, { ...o, expect: '200' }, is(200, 204));
  }
  await T.call('List departments', 'GET', '/api/departments', { ...o, expect: '200, has ZZ Main Dept' },
    r => (r.status === 200 && has(r.data, 'ZZ Main Dept') ? true : `got ${r.status}, ZZ Main Dept missing`));

  // ---- Job roles with shifts ----
  state.shiftIds = state.shiftIds || {
    ONTIME: new mongoose.Types.ObjectId().toString(),
    LATE: new mongoose.Types.ObjectId().toString(),
    HALF: new mongoose.Types.ObjectId().toString(),
    EARLY: new mongoose.Types.ObjectId().toString(),
    STD: new mongoose.Types.ObjectId().toString(),
  };
  state.jobRoles = state.jobRoles || {};
  const shifts = buildShiftList(state);
  if (!state.jobRoles.main) {
    const r = await T.call('Create job role "ZZ Staff" with 5 shifts', 'POST', '/api/job-roles', {
      ...o, body: { name: 'ZZ Staff', description: 'ZZ Lab', department: state.depts.main, shifts }, expect: '201',
    }, is(200, 201));
    state.jobRoles.main = idOf(r.data, 'data._id', 'jobRole._id', 'data.jobRole._id', '_id') || await findId('jobroles', { companyCode: state.companyCode, name: 'ZZ Staff' });
    save();
  } else {
    await T.call('Update job role shifts to match the current time', 'PUT', `/api/job-roles/${state.jobRoles.main}`, {
      ...o, body: { name: 'ZZ Staff', department: state.depts.main, shifts }, expect: '200',
    }, is(200));
  }
  if (!state.jobRoles.weekend) {
    const r = await T.call('Create job role "ZZ Weekend Staff"', 'POST', '/api/job-roles', {
      ...o, body: { name: 'ZZ Weekend Staff', department: state.depts.weekend, shifts: [shifts[4]] }, expect: '201',
    }, is(200, 201));
    state.jobRoles.weekend = idOf(r.data, 'data._id', 'jobRole._id', 'data.jobRole._id', '_id') || await findId('jobroles', { companyCode: state.companyCode, name: 'ZZ Weekend Staff' });
    save();
  }
  await T.call('Job role keeps all 5 shifts', 'GET', `/api/job-roles/department/${state.depts.main}`, { ...o, expect: '200, 5 shifts' },
    r => (r.status === 200 && Object.values(state.shiftIds).every(id => has(r.data, id)) ? true : `got ${r.status}; not all shift ids returned`));

  // ---- Employees (created once through the real "add employee" API) ----
  let createdNow = 0;
  for (const e of EMPLOYEES) {
    if (state.users[e.key]) continue;
    createdNow += 1;
    const lower = state.companyCode.toLowerCase();
    const email = `${e.key}.${lower}@${LAB_EMAIL_DOMAIN}`;
    const shiftId = state.shiftIds[e.shift];
    const shiftName = shifts.find(s => s.shiftId === shiftId)?.shiftName;
    const r = await T.call(`Add employee ${e.name}`, 'POST', '/api/auth/register', {
      ...o,
      expect: '201',
      body: {
        name: e.name, email, password: LAB_PASSWORD, phone: `8${Date.now().toString().slice(-9)}`,
        department: state.depts[e.dept], jobRole: state.jobRoles[e.dept], shiftId, shiftName, shiftType: 'custom',
        company: state.companyId, companyCode: state.companyCode, companyRole: 'employee',
        registrationSource: 'admin', employeeType: 'office', dateOfJoining: '2025-01-01',
      },
    }, is(200, 201));
    const id = idOf(r.data, 'user._id', 'data.user._id', 'user.id', 'data._id') || await findId('users', { email });
    if (!id) continue;
    state.users[e.key] = { id, email, name: e.name, password: LAB_PASSWORD, note: e.note };
    save();
  }
  const lower = state.companyCode.toLowerCase();
  if (createdNow) {
    T.skip('Adding the same email twice is refused', 'Runs from the 2nd test run (keeps the first run inside the 20-per-15-min login limit)');
  } else {
    await T.call('Adding the same email twice is refused', 'POST', '/api/auth/register', {
      ...o, expect: '4xx',
      body: {
        name: 'Dup', email: `std.${lower}@${LAB_EMAIL_DOMAIN}`, password: LAB_PASSWORD, department: state.depts.main,
        jobRole: state.jobRoles.main, shiftId: state.shiftIds.STD, company: state.companyId, companyCode: state.companyCode, companyRole: 'employee',
      },
    }, rejected);
  }
  await T.call('Company user list shows all dummy employees', 'GET', '/api/users/company-users', { ...o, expect: '200, 6 employees' },
    r => {
      if (r.status !== 200) return `got ${r.status}`;
      const missing = EMPLOYEES.filter(e => state.users[e.key] && !has(r.data, state.users[e.key].email)).map(e => e.key);
      return missing.length ? `missing: ${missing.join(', ')}` : true;
    });

  // First login of each employee (tokens are reused by later runs)
  for (const e of EMPLOYEES) {
    if (state.users[e.key]) await tokenFor(ctx, e.key);
  }
  if (state.users.std) {
    await T.call('Employee sees own profile', 'GET', '/api/users/me', { token: state.users.std.token, as: 'std', expect: '200' },
      r => (r.status === 200 && has(r.data, state.users.std.email) ? true : `got ${r.status}`));
    await T.call('Employee cannot add employees', 'POST', '/api/auth/register', {
      token: state.users.std.token, as: 'std', expect: '403',
      body: {
        name: 'ZZ Hack', email: `hack.${lower}@${LAB_EMAIL_DOMAIN}`, password: LAB_PASSWORD, department: state.depts.main,
        jobRole: state.jobRoles.main, shiftId: state.shiftIds.STD, company: state.companyId, companyCode: state.companyCode, companyRole: 'owner',
      },
    }, denied);
  }
  if (state.users.std) {
    await T.call('Employee cannot create a job role', 'POST', '/api/job-roles', {
      token: state.users.std.token, as: 'std', body: { name: `ZZ Hack Role ${Date.now() % 100000}`, department: state.depts.main, shifts: [shifts[4]] }, expect: '403',
    }, denied);
  }

  // Security: the add-employee API must check who is calling
  await T.call('Add employee with a FAKE token is refused', 'POST', '/api/auth/register', {
    token: 'not-a-real-token', as: 'fake token', expect: '401/403',
    body: {
      name: 'ZZ Fake Owner', email: `fake${Date.now() % 100000}.${lower}@${LAB_EMAIL_DOMAIN}`, password: LAB_PASSWORD,
      department: state.depts.main, jobRole: state.jobRoles.main, shiftId: state.shiftIds.STD,
      company: state.companyId, companyCode: state.companyCode, companyRole: 'owner',
    },
  }, r => (denied(r) === true ? true : `got ${r.status}: an active "owner" login was created without a real login token`));

  // ---- Leave type + leave policy (created once) ----
  T.setModule('Setup: Leave type & policy');
  if (!state.leavePolicy) {
    await T.call('Create leave type "Casual"', 'POST', '/api/leave-types', { ...o, body: { name: 'Casual' }, expect: '201' }, is(200, 201, 409));
    const lp = await T.call('Create leave policy Casual — 12 days/year for ZZ Staff', 'POST', '/api/leave-policies', {
      ...o, expect: '201',
      body: { policyName: 'ZZ Casual Policy', departments: [state.depts.main], jobRoles: [state.jobRoles.main], leaveType: 'Casual', payType: 'Paid', entitledDays: 12 },
    }, is(200, 201));
    state.leavePolicy = idOf(lp.data, 'leavePolicy._id', 'data._id') || await findId('leavepolicies', { policyName: 'ZZ Casual Policy', companyCode: state.companyCode });
    save();
  }
  await T.call('Policy without job role is refused', 'POST', '/api/leave-policies', {
    ...o, body: { policyName: 'ZZ Bad Policy', departments: [state.depts.main], jobRoles: [], leaveType: 'Casual' }, expect: '400',
  }, is(400));
  await T.call('Employee cannot create a leave policy', 'POST', '/api/leave-policies', {
    token: state.users.std?.token, as: 'std', body: { policyName: 'ZZ Hack Policy', departments: [state.depts.main], jobRoles: [state.jobRoles.main], leaveType: 'Casual', entitledDays: 99 }, expect: '403',
  }, denied);
  await T.call('Employee sees applicable leave policies', 'GET', '/api/leave-policies/applicable', { token: state.users.std?.token, as: 'std', expect: 'has Casual' },
    r => (r.status === 200 && has(r.data, 'Casual') ? true : `got ${r.status}; Casual policy not listed`));
  writeState(state);
}

module.exports = { authFlow, setupFlow, EMPLOYEES, STD_SHIFT, inLiveWindow, liveShifts, LIVE_WINDOW };
