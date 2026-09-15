const test = require("node:test");
const assert = require("node:assert/strict");

// Helper simulating the core salary calculation logic verified in employeeSalaryController
function calculateEmployeeSalary({
  assignedGross = 50000,
  daysInMonth = 30,
  salaryDaysBasis = "fixed30",
  workingDays = 22,
  presentDays = 0,
  halfDayDays = 0,
  paidLeaveDays = 0,
  unpaidLeaveDays = 0,
  uninformedLeaveDays = 0,
  actualAbsentDays = 0,
  pendingDays = 0,
  paidWeekOffDays = 0,
  paidHolidayDays = 0,
  approvedFullDayCount = 0,
  totalOvertimeMinutes = 0,
  sandwichRuleEnabled = false,
  componentDeductions = 2000
}) {
  const hasVerifiedWork = (presentDays > 0 || paidLeaveDays > 0 || approvedFullDayCount > 0);
  const effectivePresentDays = presentDays + approvedFullDayCount;
  
  const verifiedPayableDays = hasVerifiedWork
    ? Math.max(0, effectivePresentDays + paidLeaveDays + paidWeekOffDays + paidHolidayDays)
    : 0;

  const divisorDays = salaryDaysBasis === "fixed30" ? 30 : salaryDaysBasis === "fixed31" ? 31 : salaryDaysBasis === "fixed26" ? 26 : daysInMonth;
  const effectivePayableDays = Math.min(divisorDays, verifiedPayableDays);
  const ratio = divisorDays > 0 ? Math.min(1, effectivePayableDays / divisorDays) : 0;

  const dailyWage = divisorDays > 0 ? (assignedGross / divisorDays) : 0;
  const hourlyWage = dailyWage > 0 ? (dailyWage / 9) : 0;
  const hourlyOvertimePay = Math.round(((totalOvertimeMinutes / 60) * hourlyWage) * 100) / 100;
  const fullDayOvertimePay = Math.round((approvedFullDayCount * dailyWage) * 100) / 100;
  const overtimePay = Math.round((hourlyOvertimePay + fullDayOvertimePay) * 100) / 100;

  const unpaidDays = Math.max(0, divisorDays - effectivePayableDays);
  const attendanceDeduction = divisorDays > 0
    ? Math.round((assignedGross * unpaidDays / divisorDays) * 100) / 100
    : 0;

  const finalPayableGross = Math.round(Math.max(0, (assignedGross - attendanceDeduction) + overtimePay) * 100) / 100;
  const finalMonthlyGross = finalPayableGross;
  const salaryDeductions = Math.min(finalPayableGross, Math.round(componentDeductions * (effectivePayableDays > 0 ? ratio : 0) * 100) / 100);
  const finalMonthlyNet = Math.round(Math.max(0, finalPayableGross - salaryDeductions) * 100) / 100;

  return {
    assignedGross,
    payableDays: verifiedPayableDays,
    effectivePayableDays,
    attendanceDeduction,
    monthlyGross: finalMonthlyGross,
    payableGross: finalPayableGross,
    salaryDeductions,
    monthlyNet: finalMonthlyNet,
    earnedTillDateGross: finalPayableGross,
    earnedTillDateNet: finalMonthlyNet
  };
}

test("zero present days and pending attendance results in 0 verified payable days and 0 salary", () => {
  const result = calculateEmployeeSalary({
    assignedGross: 60000,
    presentDays: 0,
    paidLeaveDays: 0,
    pendingDays: 22,
    paidWeekOffDays: 0,
    paidHolidayDays: 0
  });

  assert.equal(result.payableDays, 0);
  assert.equal(result.effectivePayableDays, 0);
  assert.equal(result.monthlyGross, 0);
  assert.equal(result.payableGross, 0);
  assert.equal(result.monthlyNet, 0);
  assert.equal(result.earnedTillDateGross, 0);
  assert.equal(result.earnedTillDateNet, 0);
  assert.equal(result.assignedGross, 60000);
  assert.equal(result.attendanceDeduction, 60000);
});

test("elapsed calendar dates without verified attendance do not award salary", () => {
  // Even if 15 dates elapsed, with 0 present and 12 pending, earned salary must be 0
  const result = calculateEmployeeSalary({
    assignedGross: 45000,
    presentDays: 0,
    pendingDays: 12,
    paidWeekOffDays: 0
  });

  assert.equal(result.earnedTillDateGross, 0);
  assert.equal(result.earnedTillDateNet, 0);
  assert.equal(result.monthlyGross, 0);
  assert.equal(result.assignedGross, 45000);
});

test("full month verified attendance awards 100% full assigned salary", () => {
  const result = calculateEmployeeSalary({
    assignedGross: 60000,
    presentDays: 22,
    paidWeekOffDays: 8,
    paidHolidayDays: 0,
    componentDeductions: 2000
  });

  assert.equal(result.payableDays, 30);
  assert.equal(result.effectivePayableDays, 30);
  assert.equal(result.attendanceDeduction, 0);
  assert.equal(result.monthlyGross, 60000);
  assert.equal(result.salaryDeductions, 2000);
  assert.equal(result.monthlyNet, 58000);
  assert.equal(result.assignedGross, 60000);
});

test("partial attendance calculates strictly on verified days and prorates salary", () => {
  // 6 present days + 1 eligible weekly off = 7 verified payable days out of 30
  const result = calculateEmployeeSalary({
    assignedGross: 30000,
    presentDays: 6,
    paidWeekOffDays: 1,
    pendingDays: 16,
    componentDeductions: 1000
  });

  assert.equal(result.payableDays, 7);
  assert.equal(result.effectivePayableDays, 7);
  // 7 / 30 * 30000 = 7000
  assert.equal(result.monthlyGross, 7000);
  assert.equal(result.payableGross, 7000);
  // Deduction prorated: 1000 * (7/30) = 233.33
  assert.equal(result.salaryDeductions, 233.33);
  assert.equal(result.monthlyNet, 7000 - 233.33);
  assert.equal(result.assignedGross, 30000);
});

test("half day attendance counts as 0.5 verified present day", () => {
  const result = calculateEmployeeSalary({
    assignedGross: 30000,
    presentDays: 0.5,
    halfDayDays: 1,
    paidWeekOffDays: 0,
    pendingDays: 21,
    componentDeductions: 0
  });

  assert.equal(result.payableDays, 0.5);
  // 0.5 / 30 * 30000 = 500
  assert.equal(result.monthlyGross, 500);
  assert.equal(result.monthlyNet, 500);
  assert.equal(result.assignedGross, 30000);
});

