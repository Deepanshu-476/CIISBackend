const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Company = require("../models/Company");
const EmployeeSalary = require("../models/EmployeeSalary");
const SalaryStructure = require("../models/SalaryStructure");
const SalaryComponent = require("../models/SalaryComponent");
const PayrollRun = require("../models/PayrollRun");

const companyCode = String(process.argv.find(value => value.startsWith("--company=")) || "").split("=")[1];
if (!companyCode) throw new Error("Use --company=COMPANY_CODE.");
const round = value => Math.round(Number(value || 0) * 100) / 100;
const employeeKey = employee => String(employee?.user?._id || employee?.user || employee?._id || "");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const company = await Company.findOne({ companyCode: companyCode.toUpperCase() }).select("_id companyCode").lean();
  if (!company) throw new Error("Company not found.");

  const assignments = await EmployeeSalary.find({ company: company._id, status: "active" }).select("user salaryStructure components").lean();
  const structureIds = [...new Set(assignments.map(item => String(item.salaryStructure || "")).filter(mongoose.isValidObjectId))];
  const componentIds = [...new Set(assignments.flatMap(item => item.components || []).map(item => String(item.component || "")).filter(mongoose.isValidObjectId))];
  const existingStructures = new Set((await SalaryStructure.find({ company: company._id, _id: { $in: structureIds } }).select("_id").lean()).map(item => String(item._id)));
  const existingComponents = new Set((await SalaryComponent.find({ company: company._id, _id: { $in: componentIds } }).select("_id").lean()).map(item => String(item._id)));

  const runs = await PayrollRun.find({ company: company._id }).select("month status employees totals").lean();
  const runIssues = [];
  for (const run of runs) {
    const statuses = [...new Set((run.employees || []).map(item => item.payrollStatus || "Missing"))];
    const computed = (run.employees || []).reduce((total, employee) => ({
      employees: total.employees + 1,
      earnings: round(total.earnings + Number(employee.monthlyGross || 0)),
      deductions: round(total.deductions + Number(employee.totalDeductions || 0) + Number(employee.adjustmentDeductions || 0)),
      net: round(total.net + Number(employee.monthlyNet || 0))
    }), { employees: 0, earnings: 0, deductions: 0, net: 0 });
    const totalMismatch = ["employees", "earnings", "deductions", "net"].some(key => round(run.totals?.[key]) !== round(computed[key]));
    const incompatible = (run.status === "Locked" && statuses.some(status => status !== "Locked"))
      || (run.status === "Approved" && statuses.some(status => !["Approved", "Locked"].includes(status)))
      || (["Draft", "Calculated"].includes(run.status) && statuses.some(status => ["Approved", "Locked"].includes(status)));
    if (totalMismatch || incompatible) runIssues.push({ month: run.month, runStatus: run.status, employeeStatuses: statuses, totalMismatch, incompatible });
  }

  console.log(JSON.stringify({
    company: company.companyCode,
    activeAssignments: assignments.length,
    assignmentsWithMissingStructure: assignments.filter(item => !existingStructures.has(String(item.salaryStructure))).length,
    assignmentsWithMissingComponents: assignments.filter(item => (item.components || []).some(component => !existingComponents.has(String(component.component)))).length,
    payrollRuns: runs.length,
    payrollRunIssues: runIssues
  }, null, 2));
  await mongoose.disconnect();
}

main().catch(async error => { console.error(error); try { await mongoose.disconnect(); } catch {} process.exit(1); });
