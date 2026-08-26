const test = require("node:test");
const assert = require("node:assert/strict");
const { validateBulkEmployeeStatuses, applyBulkEmployeeTransition, deriveRunStatus } = require("../utils/payrollFlow");

test("bulk approval rejects an employee that skipped review", () => {
  assert.equal(validateBulkEmployeeStatuses("approve", [{ payrollStatus: "Calculated" }, { payrollStatus: "Reviewed" }]), "Every employee payroll must be Reviewed before bulk approval.");
});

test("bulk approval preserves an already locked employee", () => {
  const result = applyBulkEmployeeTransition("approve", [{ payrollStatus: "Locked" }, { payrollStatus: "Reviewed" }], "actor", new Date(0));
  assert.equal(result[0].payrollStatus, "Locked");
  assert.equal(result[1].payrollStatus, "Approved");
});

test("reopen removes payslip eligibility from every employee", () => {
  const result = applyBulkEmployeeTransition("reopen", [{ payrollStatus: "Approved" }, { payrollStatus: "Locked" }], "actor", new Date(0));
  assert.deepEqual(result.map(item => item.payrollStatus), ["Draft", "Draft"]);
});

test("run status follows individual employee states", () => {
  assert.equal(deriveRunStatus([{ payrollStatus: "Calculated" }, { payrollStatus: "Reviewed" }]), "Reviewed");
  assert.equal(deriveRunStatus([{ payrollStatus: "Approved" }, { payrollStatus: "Locked" }]), "Approved");
  assert.equal(deriveRunStatus([{ payrollStatus: "Locked" }, { payrollStatus: "Locked" }]), "Locked");
});
