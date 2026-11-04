const { tokenFor } = require('../auth');
const { istKey } = require('../time');
const { is, denied, has, idOf, findId, oid, rowsOf } = require('./helpers');

// Previous month (YYYY-MM): a full month whose attendance already exists.
const previousMonth = () => {
  const [y, m] = istKey().split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}`;
};

async function payrollFlow(ctx) {
  const { T, state } = ctx;
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const std = { token: await tokenFor(ctx, 'std'), as: 'std' };
  const month = previousMonth();

  // ---------- Components ----------
  T.setModule('Payroll: Salary components');
  await T.call('Employee cannot open salary components', 'GET', '/api/salary-components', { ...std, expect: '403' }, denied);
  await T.call('Owner lists salary components', 'GET', '/api/salary-components', { ...o, expect: '200' }, is(200));
  const compName = `ZZ Allowance ${Date.now() % 100000}`;
  await T.call('Component with bad type refused', 'POST', '/api/salary-components', { ...o, body: { name: 'ZZ bad', type: 'gift' }, expect: '400' }, is(400));
  await T.call('Component without name refused', 'POST', '/api/salary-components', { ...o, body: { name: '', type: 'earning' }, expect: '400' }, is(400));
  await T.call('Employee cannot add a component', 'POST', '/api/salary-components', { ...std, body: { name: 'ZZ hack', type: 'earning' }, expect: '403' }, denied);
  const c = await T.call('Add earning component', 'POST', '/api/salary-components', { ...o, body: { name: compName, type: 'earning', status: 'active' }, expect: '201' }, is(200, 201));
  const compId = idOf(c.data, 'component._id', 'data._id', '_id') || await findId('salarycomponents', { name: compName });
  if (compId) {
    await T.call('Rename component', 'PUT', `/api/salary-components/${compId}`, { ...o, body: { name: `${compName} B`, type: 'earning', status: 'active' }, expect: '200' }, is(200));
    await T.call('Delete component', 'DELETE', `/api/salary-components/${compId}`, { ...o, expect: '200' }, is(200, 204));
  }

  // ---------- Structures ----------
  T.setModule('Payroll: Salary structures');
  const compIds = {};
  for (const [key, name, type] of [['basic', 'ZZ Basic', 'earning'], ['special', 'ZZ Special', 'earning'], ['pt', 'ZZ Prof Tax', 'deduction']]) {
    const r = await T.call(`Add ${type} component "${name}"`, 'POST', '/api/salary-components', { ...o, body: { name, type, status: 'active', grossSalary: type === 'earning', taxable: type === 'earning' }, expect: '201' }, is(200, 201));
    compIds[key] = idOf(r.data, 'component._id', 'data._id', '_id') || await findId('salarycomponents', { name });
  }
  await T.call('Structure without components refused', 'POST', '/api/salary-structures', { ...o, body: { name: 'ZZ empty', components: [] }, expect: '400' }, is(400));
  await T.call('Employee cannot open structures', 'GET', '/api/salary-structures', { ...std, expect: '403' }, denied);
  const structName = `ZZ Structure ${Date.now() % 100000}`;
  const cs = await T.call('Create structure: Basic 20,000 + Special 10,000 − PT 200', 'POST', '/api/salary-structures', {
    ...o, expect: '201',
    body: {
      name: structName, salaryType: 'monthly', salaryInputType: 'gross', defaultGross: 30000, effectiveFrom: '2025-01-01',
      components: [
        { component: compIds.basic, calculationType: 'manual', value: 20000, sortOrder: 1 },
        { component: compIds.special, calculationType: 'manual', value: 10000, sortOrder: 2 },
        { component: compIds.pt, calculationType: 'manual', value: 200, sortOrder: 3 },
      ],
    },
  }, is(200, 201));
  const structure = cs.data?.structure || (await ctx.db.collection('salarystructures').findOne({ name: structName }));
  await T.call('Structure list has it', 'GET', '/api/salary-structures', { ...o, expect: 'has structure' },
    r => (r.status === 200 && has(r.data, structName) ? true : `got ${r.status}; structure missing`));
  if (structure?._id) {
    await T.call('Update structure description', 'PUT', `/api/salary-structures/${structure._id}`, {
      ...o, body: { name: structName, salaryType: 'monthly', salaryInputType: 'gross', description: 'ZZ updated', components: (structure.components || []).map(row => ({ ...row, component: row.component?._id || row.component })) }, expect: '200',
    }, is(200));
  }
  if (!structure?._id) return T.skip('Payroll salary & run', 'No salary structure available');

  // ---------- Employee salary ----------
  T.setModule('Payroll: Employee salary');
  const uid = state.users.std.id;
  const salaryBody = { user: uid, salaryStructure: structure._id, baseAmount: 30000, effectiveFrom: '2025-01-01', designation: 'ZZ Tester' };
  await T.call('Salary without employee refused', 'POST', '/api/employee-salaries', { ...o, body: { ...salaryBody, user: '' }, expect: '400' }, is(400));
  await T.call('Salary with negative amount refused', 'POST', '/api/employee-salaries', { ...o, body: { ...salaryBody, baseAmount: -5 }, expect: '400' }, is(400));
  await T.call('Employee cannot assign salary', 'POST', '/api/employee-salaries', { ...std, body: salaryBody, expect: '403' }, denied);
  const sa = await T.call('Assign ₹30,000 gross salary to std', 'POST', '/api/employee-salaries', { ...o, body: salaryBody, expect: '201' }, is(200, 201, 409));
  const salaryId = idOf(sa.data, 'salary._id', 'data._id', 'employeeSalary._id') || await findId('employeesalaries', { user: oid(uid) });
  await T.call('Salary list has std', 'GET', '/api/employee-salaries', { ...o, expect: 'has std' }, r => (r.status === 200 && has(r.data, uid) ? true : `got ${r.status}; std missing`));
  await T.call('Salary of std by user', 'GET', `/api/employee-salaries/user/${uid}`, { ...o, expect: '200' }, is(200));
  await T.call('Another employee cannot read std salary', 'GET', `/api/employee-salaries/user/${uid}`, { token: await tokenFor(ctx, 'ontime'), as: 'ontime', expect: '403' }, denied);
  if (salaryId) await T.call('Open salary record', 'GET', `/api/employee-salaries/${salaryId}`, { ...o, expect: '200' }, is(200));

  // ---------- Payroll run ----------
  T.setModule(`Payroll: Run for ${month}`);
  await T.call('Payroll preview', 'GET', '/api/employee-salaries/payroll-preview', { ...o, query: { month }, expect: '200' }, is(200));
  await T.call('Month 13 is refused', 'POST', '/api/employee-salaries/payroll-run/generate', { ...o, body: { month: '2026-13' }, expect: '400' },
    r => (r.status === 400 ? true : `got ${r.status}: a payroll run was saved for month "2026-13"`));
  await T.call('Employee cannot generate payroll', 'POST', '/api/employee-salaries/payroll-run/generate', { ...std, body: { month }, expect: '403' }, denied);
  await T.call('Generate payroll', 'POST', '/api/employee-salaries/payroll-run/generate', { ...o, body: { month }, expect: '200' }, is(200, 201));
  await T.call('Payroll run includes std', 'GET', '/api/employee-salaries/payroll-run', { ...o, query: { month }, expect: 'has std' },
    r => (r.status === 200 && has(r.data, uid) ? true : `got ${r.status}; std not in run`));
  await T.call('Approve before review refused', 'PATCH', '/api/employee-salaries/payroll-run/status', { ...o, body: { month, action: 'approve' }, expect: '409' }, is(409));
  await T.call('Review payroll', 'PATCH', '/api/employee-salaries/payroll-run/status', { ...o, body: { month, action: 'review' }, expect: '200' }, is(200));
  await T.call('No payslip before approval', 'GET', '/api/employee-salaries/payroll-payslips', { ...o, query: { month }, expect: 'no std' },
    r => (r.status === 404 || (r.status === 200 && !has(r.data, uid)) ? true : `got ${r.status}; payslip visible before approval`));
  await T.call('Approve payroll', 'PATCH', '/api/employee-salaries/payroll-run/status', { ...o, body: { month, action: 'approve' }, expect: '200' }, is(200));
  await T.call('Payslip available after approval', 'GET', '/api/employee-salaries/payroll-payslips', { ...o, query: { month }, expect: 'has std' },
    r => (r.status === 200 && has(r.data, uid) ? true : `got ${r.status}; payslip missing`));
  await T.call('Lock payroll', 'PATCH', '/api/employee-salaries/payroll-run/status', { ...o, body: { month, action: 'lock' }, expect: '200' }, is(200));
  await T.call('Locked payroll cannot be regenerated', 'POST', '/api/employee-salaries/payroll-run/generate', { ...o, body: { month }, expect: '409' }, is(409));
  await T.call('Reopen without reason refused', 'PATCH', '/api/employee-salaries/payroll-run/status', { ...o, body: { month, action: 'reopen' }, expect: '400' }, is(400));
  await T.call('Reopen with reason', 'PATCH', '/api/employee-salaries/payroll-run/status', { ...o, body: { month, action: 'reopen', reason: 'ZZ Lab reopen test' }, expect: '200' }, is(200));
  await T.call('Payslip history (std)', 'GET', '/api/employee-salaries/payroll-payslips/history', { ...std, query: { userId: uid }, expect: '200/403' },
    r => ([200, 403].includes(r.status) ? true : `got ${r.status}`));
}

module.exports = { payrollFlow, previousMonth };
