const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Company = require("../models/Company");
const User = require("../models/User");
const Department = require("../models/Department");
const JobRole = require("../models/JobRole");
const SalaryComponent = require("../models/SalaryComponent");
const SalaryStructure = require("../models/SalaryStructure");
const EmployeeSalary = require("../models/EmployeeSalary");

const apply = process.argv.includes("--apply");
const companyCode = String(process.argv.find(value => value.startsWith("--company=")) || "").split("=")[1];
if (!companyCode) throw new Error("Use --company=COMPANY_CODE and optionally --apply.");

const departmentPlans = {
  HR: { structureName: "HR Monthly Salary", structureCode: "HR-MONTHLY", gross: 28000 },
  IT_TEAM: { structureName: "IT Monthly Salary", structureCode: "IT-MONTHLY", gross: 30000 }
};

const round = value => Math.round(Number(value || 0) * 100) / 100;

async function ensureComponent(company, actor, definition) {
  let component = await SalaryComponent.findOne({ company, code: definition.code });
  if (component || !apply) return component || { _id: null, ...definition };
  component = await SalaryComponent.create({ company, createdBy: actor, updatedBy: actor, status: "active", ...definition });
  return component;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const company = await Company.findOne({ companyCode: companyCode.toUpperCase() }).select("_id companyName companyCode").lean();
  if (!company) throw new Error(`Company ${companyCode} was not found.`);
  const actor = await User.findOne({ company: company._id }).select("_id").lean();
  if (!actor) throw new Error("No company user is available as audit actor.");

  const maxSortOrder = await SalaryComponent.findOne({ company: company._id }).sort({ sortOrder: -1 }).select("sortOrder").lean();
  const basic = await SalaryComponent.findOne({ company: company._id, code: "BS", type: "earning" });
  const hra = await SalaryComponent.findOne({ company: company._id, code: "HRA", type: "earning" });
  if (!basic || !hra) throw new Error("Existing BS and HRA components are required.");
  const special = await ensureComponent(company._id, actor._id, { name: "Special Allowance", code: "SPL", type: "earning", sortOrder: Number(maxSortOrder?.sortOrder || 0) + 1, proRata: true, taxable: true, grossSalary: true });
  const employeePf = await ensureComponent(company._id, actor._id, { name: "Employee Provident Fund", code: "PFEE", type: "deduction", sortOrder: Number(maxSortOrder?.sortOrder || 0) + 2, proRata: true, taxable: false, grossSalary: false, pfWage: false });

  const summary = { company: company.companyName, mode: apply ? "APPLY" : "DRY RUN", componentsCreated: 0, structuresCreated: 0, assignmentsCreated: 0, departments: [] };
  if (apply) {
    summary.componentsCreated += special.createdAt && special.updatedAt && special.createdAt.getTime() === special.updatedAt.getTime() ? 1 : 0;
    summary.componentsCreated += employeePf.createdAt && employeePf.updatedAt && employeePf.createdAt.getTime() === employeePf.updatedAt.getTime() ? 1 : 0;
  } else {
    summary.componentsCreated = Number(!special._id) + Number(!employeePf._id);
  }

  for (const [departmentName, plan] of Object.entries(departmentPlans)) {
    const department = await Department.findOne({ company: company._id, name: departmentName }).select("_id name").lean();
    if (!department) { summary.departments.push({ department: departmentName, skipped: "Department not found" }); continue; }
    const users = await User.find({ company: company._id, department: department._id, isActive: true }).select("_id name employeeId jobRole dateOfJoining bankName accountNumber").lean();
    const assignedUserIds = new Set((await EmployeeSalary.find({ company: company._id, user: { $in: users.map(user => user._id) } }).select("user").lean()).map(row => String(row.user)));
    const missingUsers = users.filter(user => !assignedUserIds.has(String(user._id)));

    let structure = await SalaryStructure.findOne({ company: company._id, code: plan.structureCode });
    const basicAmount = round(plan.gross * 0.5);
    const hraAmount = round(plan.gross * 0.2);
    const specialAmount = round(plan.gross - basicAmount - hraAmount);
    const pfAmount = round(Math.min(basicAmount * 0.12, 1800));
    const rows = [
      { component: basic._id, calculationType: "manual", value: basicAmount, sortOrder: 1 },
      { component: hra._id, calculationType: "manual", value: hraAmount, sortOrder: 2 },
      { component: special._id, calculationType: "manual", value: specialAmount, sortOrder: 3 },
      { component: employeePf._id, calculationType: "manual", value: pfAmount, sortOrder: 4 }
    ];
    if (!structure && apply) {
      structure = await SalaryStructure.create({ company: company._id, name: plan.structureName, code: plan.structureCode, salaryType: "monthly", salaryInputType: "gross", effectiveFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1), description: `Reusable ${departmentName} payroll testing structure`, status: "active", components: rows, createdBy: actor._id, updatedBy: actor._id });
      summary.structuresCreated += 1;
    }

    const jobRoleIds = [...new Set(missingUsers.map(user => String(user.jobRole || "")).filter(mongoose.isValidObjectId))];
    const roles = await JobRole.find({ _id: { $in: jobRoleIds } }).select("_id name").lean();
    const roleMap = new Map(roles.map(role => [String(role._id), role.name]));
    if (apply && structure) {
      const componentRows = [
        { component: basic._id, name: basic.name, code: basic.code, type: "earning", calculationType: "manual", value: basicAmount, amount: basicAmount, annualAmount: basicAmount * 12, sortOrder: 1 },
        { component: hra._id, name: hra.name, code: hra.code, type: "earning", calculationType: "manual", value: hraAmount, amount: hraAmount, annualAmount: hraAmount * 12, sortOrder: 2 },
        { component: special._id, name: special.name, code: special.code, type: "earning", calculationType: "manual", value: specialAmount, amount: specialAmount, annualAmount: specialAmount * 12, sortOrder: 3 },
        { component: employeePf._id, name: employeePf.name, code: employeePf.code, type: "deduction", calculationType: "manual", value: pfAmount, amount: pfAmount, annualAmount: pfAmount * 12, sortOrder: 4 }
      ];
      for (const user of missingUsers) {
        await EmployeeSalary.create({ company: company._id, user: user._id, salaryStructure: structure._id, department: department.name, designation: roleMap.get(String(user.jobRole)) || "Employee", dateOfJoining: user.dateOfJoining, salaryType: "monthly", salaryInputType: "gross", currency: "INR", payFrequency: "Monthly", paymentMode: "Bank Transfer", bankAccount: user.bankName ? `${user.bankName} - ${user.accountNumber || ""}` : "", baseAmount: plan.gross, monthlyGross: plan.gross, monthlyNet: round(plan.gross - pfAmount), monthlyCTC: plan.gross, annualCTC: plan.gross * 12, totalEarnings: plan.gross, totalDeductions: pfAmount, effectiveFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1), status: "active", components: componentRows, notes: "Payroll testing assignment", createdBy: actor._id, updatedBy: actor._id });
        summary.assignmentsCreated += 1;
      }
    }
    summary.departments.push({ department: department.name, activeUsers: users.length, alreadyAssigned: users.length - missingUsers.length, assignmentsToCreate: missingUsers.length, structure: plan.structureCode, gross: plan.gross });
  }
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async error => { console.error(error); try { await mongoose.disconnect(); } catch {} process.exit(1); });
