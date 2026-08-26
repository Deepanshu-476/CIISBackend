const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const Company = require("../models/Company");
const User = require("../models/User");
const SalaryComponent = require("../models/SalaryComponent");
const SalaryStructure = require("../models/SalaryStructure");
const EmployeeSalary = require("../models/EmployeeSalary");

const apply = process.argv.includes("--apply");
const companyCode = String(process.argv.find(value => value.startsWith("--company=")) || "").split("=")[1];
if (!companyCode) throw new Error("Use --company=COMPANY_CODE and optionally --apply.");

const targetEmployeeIds = ["EMP177073972770548", "EMP1770740061405394"];

async function ensureComponent(company, actor, definition) {
  let component = await SalaryComponent.findOne({ company, code: definition.code });
  if (component && component.type !== definition.type) {
    throw new Error(`Component ${definition.code} exists with type ${component.type}; expected ${definition.type}.`);
  }
  if (!component && apply) {
    component = await SalaryComponent.create({
      company,
      ...definition,
      status: "active",
      createdBy: actor,
      updatedBy: actor
    });
  }
  return component;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const company = await Company.findOne({ companyCode: companyCode.toUpperCase() })
    .select("_id companyCode companyName")
    .lean();
  if (!company) throw new Error(`Company ${companyCode} was not found.`);

  const users = await User.find({ company: company._id, employeeId: { $in: targetEmployeeIds } })
    .select("_id name employeeId")
    .lean();
  if (users.length !== targetEmployeeIds.length) throw new Error("One or more target employees were not found.");

  const assignments = await EmployeeSalary.find({
    company: company._id,
    user: { $in: users.map(user => user._id) },
    status: "active"
  });
  if (assignments.length !== targetEmployeeIds.length) throw new Error("One or more active salary assignments were not found.");

  const existingStructureIds = new Set((await SalaryStructure.find({
    company: company._id,
    _id: { $in: assignments.map(row => row.salaryStructure) }
  }).select("_id").lean()).map(row => String(row._id)));

  const brokenAssignments = assignments.filter(row => !existingStructureIds.has(String(row.salaryStructure)));
  for (const assignment of brokenAssignments) {
    if (Number(assignment.monthlyGross) !== 12000 || Number(assignment.totalDeductions) !== 1000) {
      throw new Error(`Unexpected salary values on assignment ${assignment._id}; repair stopped.`);
    }
  }

  const actor = await User.findOne({ company: company._id }).select("_id").lean();
  const lastComponent = await SalaryComponent.findOne({ company: company._id }).sort({ sortOrder: -1 }).select("sortOrder").lean();
  let nextOrder = Number(lastComponent?.sortOrder || 0) + 1;

  const basic = await SalaryComponent.findOne({ company: company._id, code: "BS", type: "earning" });
  const hra = await SalaryComponent.findOne({ company: company._id, code: "HRA", type: "earning" });
  const conveyance = await ensureComponent(company._id, actor._id, {
    name: "Conveyance Allowance", code: "CONV", type: "earning", sortOrder: nextOrder++,
    proRata: true, taxable: true, grossSalary: true
  });
  const pf = await ensureComponent(company._id, actor._id, {
    name: "Employee Provident Fund", code: "PFEE", type: "deduction", sortOrder: nextOrder++,
    proRata: true, taxable: false, grossSalary: false, pfWage: false
  });
  if (!basic || !hra) throw new Error("Required BS/HRA earning masters are missing.");

  let structure = await SalaryStructure.findOne({ company: company._id, code: "MONTHLY-12K" });
  if (!structure && apply) {
    structure = await SalaryStructure.create({
      company: company._id,
      name: "Standard Monthly Salary 12K",
      code: "MONTHLY-12K",
      salaryType: "monthly",
      salaryInputType: "gross",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      description: "Recovered reusable structure for legacy 12K salary assignments",
      status: "active",
      components: [
        { component: basic._id, calculationType: "manual", value: 8000, sortOrder: 1 },
        { component: hra._id, calculationType: "manual", value: 2000, sortOrder: 2 },
        { component: conveyance?._id, calculationType: "manual", value: 2000, sortOrder: 3 },
        { component: pf?._id, calculationType: "manual", value: 1000, sortOrder: 4 }
      ],
      createdBy: actor._id,
      updatedBy: actor._id
    });
  }

  const userById = new Map(users.map(user => [String(user._id), user]));
  const result = {
    mode: apply ? "APPLY" : "DRY RUN",
    company: company.companyCode,
    brokenAssignments: brokenAssignments.map(row => ({
      employee: userById.get(String(row.user))?.name,
      employeeId: userById.get(String(row.user))?.employeeId,
      gross: row.monthlyGross,
      deductions: row.totalDeductions
    })),
    structure: structure?.code || "MONTHLY-12K (to create)",
    repaired: 0
  };

  if (apply && structure) {
    const masterByLegacyCode = new Map([
      ["BASIC", basic], ["BS", basic], ["HRA", hra], ["CONV", conveyance], ["EPF", pf], ["PFEE", pf]
    ]);
    for (const assignment of brokenAssignments) {
      assignment.salaryStructure = structure._id;
      assignment.components = assignment.components.map((row, index) => {
        const master = masterByLegacyCode.get(String(row.code || "").toUpperCase());
        if (!master) throw new Error(`No valid master mapping for component ${row.code}.`);
        return {
          ...row.toObject(), component: master._id, name: master.name, code: master.code,
          type: master.type, sortOrder: index + 1
        };
      });
      assignment.updatedBy = actor._id;
      await assignment.save();
      result.repaired += 1;
    }
  }

  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
