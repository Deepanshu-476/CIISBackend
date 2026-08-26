const BULK_ALLOWED_EMPLOYEE_STATUSES = {
  review: ["Calculated"],
  approve: ["Reviewed", "Approved", "Locked"],
  lock: ["Approved", "Locked"]
};

const validateBulkEmployeeStatuses = (action, employees = []) => {
  const allowed = BULK_ALLOWED_EMPLOYEE_STATUSES[action];
  if (!allowed) return null;
  const invalid = employees.some(employee => !allowed.includes(employee.payrollStatus || "Calculated"));
  if (!invalid) return null;
  if (action === "review") return "All employee payrolls must be Calculated before bulk review.";
  if (action === "approve") return "Every employee payroll must be Reviewed before bulk approval.";
  return "Every employee payroll must be Approved before bulk lock.";
};

const applyBulkEmployeeTransition = (action, employees = [], actor, changedAt = new Date()) => employees.map(employee => {
  if (action === "review") return { ...employee, payrollStatus: "Reviewed", reviewedAt: changedAt, reviewedBy: actor };
  if (action === "approve") return employee.payrollStatus === "Locked" ? employee : { ...employee, payrollStatus: "Approved", approvedAt: changedAt, approvedBy: actor };
  if (action === "lock") return { ...employee, payrollStatus: "Locked", lockedAt: changedAt, lockedBy: actor };
  if (action === "sendback") return { ...employee, payrollStatus: "Calculated", reviewedAt: null, reviewedBy: null, approvedAt: null, approvedBy: null, lockedAt: null, lockedBy: null };
  if (action === "reopen") return { ...employee, payrollStatus: "Draft", reviewedAt: null, reviewedBy: null, approvedAt: null, approvedBy: null, lockedAt: null, lockedBy: null };
  return employee;
});

const deriveRunStatus = (employees = []) => {
  if (employees.length && employees.every(employee => employee.payrollStatus === "Locked")) return "Locked";
  if (employees.length && employees.every(employee => ["Approved", "Locked"].includes(employee.payrollStatus))) return "Approved";
  if (employees.some(employee => ["Reviewed", "Approved", "Locked"].includes(employee.payrollStatus))) return "Reviewed";
  return "Calculated";
};

module.exports = { validateBulkEmployeeStatuses, applyBulkEmployeeTransition, deriveRunStatus };
