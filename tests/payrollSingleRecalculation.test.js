const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/employeeSalaryController');
const PayrollRun = require('../models/PayrollRun');

const request = { user: { company: 'company', name: 'Tester' }, query: {}, body: { month: '2026-09', employeeId: 'pawan' } };
async function recalculate(t, run) {
  t.mock.method(PayrollRun, 'findOne', async () => run);
  t.mock.method(controller, 'payrollPreview', async (req, res) => res.json({ success: true, employees: [{ user: { _id: 'pawan', name: 'Pawan' }, monthlyGross: 15000, totalDeductions: 0, payrollStatus: 'Calculated' }] }));
  let status = 200, body;
  await controller.recalculateSingleEmployee(request, { status(code) { status = code; return this; }, json(value) { body = value; } });
  return { status, body };
}

test('recalculates an editable employee when another employee is released, preserving other rows and adjustments', async t => {
  const released = { user: 'other', payrollStatus: 'Released', monthlyGross: 20000, monthlyNet: 20000 };
  let saved = false;
  const run = { status: 'Reviewed', employees: [released, { user: 'pawan', payrollStatus: 'Calculated', monthlyGross: 10000, adjustments: [{ amount: 500, reason: 'Fine' }] }], auditLog: [], async save() { saved = true; }, toObject() { return this; } };
  const result = await recalculate(t, run);
  assert.equal(result.status, 200);
  assert.equal(saved, true);
  assert.equal(run.employees[0], released);
  assert.equal(run.employees[1].monthlyGross, 15000);
  assert.equal(run.employees[1].monthlyNet, 14500);
  assert.equal(run.totals.earnings, 35000);
  assert.equal(run.auditLog[0].employeeId, 'pawan');
});

for (const status of ['Released', 'Approved', 'Locked']) {
  test(`rejects recalculation of a ${status} employee in a mixed run`, async t => {
    const result = await recalculate(t, { status: 'Reviewed', employees: [{ user: 'pawan', payrollStatus: status }] });
    assert.equal(result.status, 409);
    assert.equal(controller.payrollPreview.mock.callCount(), 0);
  });
  test(`rejects recalculation when the entire run is ${status}`, async t => {
    const result = await recalculate(t, { status, employees: [{ user: 'pawan', payrollStatus: 'Calculated' }] });
    assert.equal(result.status, 409);
    assert.equal(controller.payrollPreview.mock.callCount(), 0);
  });
}
