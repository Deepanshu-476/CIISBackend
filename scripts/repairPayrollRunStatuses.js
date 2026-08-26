const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Company = require("../models/Company");
const PayrollRun = require("../models/PayrollRun");

const apply = process.argv.includes("--apply");
const companyCode = String(process.argv.find(value => value.startsWith("--company=")) || "").split("=")[1];
if (!companyCode) throw new Error("Use --company=COMPANY_CODE and optionally --apply.");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const company = await Company.findOne({ companyCode: companyCode.toUpperCase() }).select("_id companyCode").lean();
  if (!company) throw new Error("Company not found.");
  const runs = await PayrollRun.find({ company: company._id });
  const repairs = [];
  for (const run of runs) {
    if (run.status !== "Draft") continue;
    const incompatible = (run.employees || []).filter(employee => ["Reviewed", "Approved", "Locked"].includes(employee.payrollStatus));
    if (!incompatible.length) continue;
    repairs.push({ month: run.month, employeesReset: incompatible.length });
    if (!apply) continue;
    run.employees = run.employees.map(employee => ({ ...employee, payrollStatus: "Draft", reviewedAt: null, reviewedBy: null, approvedAt: null, approvedBy: null, lockedAt: null, lockedBy: null }));
    run.reviewedAt = null; run.reviewedBy = null; run.approvedAt = null; run.approvedBy = null; run.lockedAt = null; run.lockedBy = null;
    run.auditLog.push({ action: "Repair Reopened Payroll Status", fromStatus: "Draft", toStatus: "Draft", reason: "Reset stale employee approval states after payroll reopen.", performedByName: "System payroll integrity repair" });
    await run.save();
  }
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN", company: company.companyCode, repairs }, null, 2));
  await mongoose.disconnect();
}
main().catch(async error => { console.error(error); try { await mongoose.disconnect(); } catch {} process.exit(1); });
