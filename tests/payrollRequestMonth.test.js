const test = require("node:test");
const assert = require("node:assert/strict");

const payrollMonthFromRequest = req => String(req.query?.month || req.body?.month || "").trim();

test("payroll month is accepted from POST body", () => {
  assert.equal(payrollMonthFromRequest({ query: {}, body: { month: "2026-08" } }), "2026-08");
});

test("query month remains supported", () => {
  assert.equal(payrollMonthFromRequest({ query: { month: "2026-09" }, body: {} }), "2026-09");
});
