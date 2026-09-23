const test = require("node:test");
const assert = require("node:assert/strict");
const { salarySnapshotForMonth } = require("../utils/payrollSalarySnapshot");

const assignment = {
  user: { _id: "employee-1", name: "Employee" },
  monthlyGross: 40000,
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  salaryStructure: { _id: "new", name: "September Structure" },
  components: [{ name: "Basic", amount: 40000 }],
  history: [{ salaryStructure: "old", salaryStructureName: "August Structure", monthlyGross: 30000, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: new Date("2026-09-01T00:00:00.000Z"), components: [{ name: "Basic", amount: 30000 }] }]
};

test("August payroll uses August salary after a September revision", () => {
  const snapshot = salarySnapshotForMonth(assignment, "2026-08");
  assert.equal(snapshot.monthlyGross, 30000);
  assert.equal(snapshot.salaryStructure.name, "August Structure");
  assert.equal(snapshot.user.name, "Employee");
});

test("September payroll uses current September salary", () => {
  const snapshot = salarySnapshotForMonth(assignment, "2026-09");
  assert.equal(snapshot.monthlyGross, 40000);
  assert.equal(snapshot.salaryStructure.name, "September Structure");
});

test("employee is excluded before first salary effective month", () => {
  assert.equal(salarySnapshotForMonth(assignment, "2026-07"), null);
});

test("same-date salary reassignment uses the current salary, not archived salary", () => {
  const revised = {
    ...assignment,
    monthlyGross: 15000,
    history: [{ ...assignment.history[0], monthlyGross: 10000, effectiveFrom: assignment.effectiveFrom }]
  };
  const snapshot = salarySnapshotForMonth(revised, "2026-09");
  assert.equal(snapshot, revised);
  assert.equal(snapshot.monthlyGross, 15000);
  assert.equal(snapshot.salaryStructure.name, "September Structure");
});

test("a future revision retains the newest historical salary for tied effective dates", () => {
  const history = [
    { ...assignment.history[0], monthlyGross: 10000 },
    { ...assignment.history[0], monthlyGross: 15000 }
  ];
  const revised = { ...assignment, history };
  assert.equal(salarySnapshotForMonth(revised, "2026-08").monthlyGross, 15000);
  assert.equal(salarySnapshotForMonth(revised, "2026-09").monthlyGross, 40000);
  assert.equal(history[0].monthlyGross, 10000);
});
