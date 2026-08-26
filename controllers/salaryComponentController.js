const mongoose = require("mongoose");
const SalaryComponent = require("../models/SalaryComponent");

const getCompanyId = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;
const booleanFields = ["proRata", "taxable", "grossSalary", "pfWage", "esiWage", "ptWage"];

const codeFromName = (name) => {
  const words = String(name || "").toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (!words.length) return "COMP";
  if (words.length === 1) return words[0].slice(0, 8);
  return words.map(word => word[0]).join("").slice(0, 8);
};

const generateUniqueCode = async (company, name) => {
  const base = codeFromName(name);
  let code = base;
  let suffix = 2;
  while (await SalaryComponent.exists({ company, code })) {
    const suffixText = `_${suffix++}`;
    code = `${base.slice(0, 30 - suffixText.length)}${suffixText}`;
  }
  return code;
};

const defaultSalaryComponents = [
  {
    name: "Basic Salary",
    code: "BASIC",
    type: "earning",
    sortOrder: 1,
    status: "active",
    proRata: true,
    taxable: true,
    grossSalary: true,
    pfWage: true,
    esiWage: true,
    ptWage: true
  },
  {
    name: "House Rent Allowance",
    code: "HRA",
    type: "earning",
    sortOrder: 2,
    status: "active",
    proRata: true,
    taxable: true,
    grossSalary: true,
    pfWage: false,
    esiWage: true,
    ptWage: true
  },
  {
    name: "Conveyance Allowance",
    code: "CONV",
    type: "earning",
    sortOrder: 3,
    status: "active",
    proRata: true,
    taxable: true,
    grossSalary: true,
    pfWage: false,
    esiWage: false,
    ptWage: false
  },
  {
    name: "Special Allowance",
    code: "SPL",
    type: "earning",
    sortOrder: 4,
    status: "active",
    proRata: true,
    taxable: true,
    grossSalary: true,
    pfWage: true,
    esiWage: true,
    ptWage: true
  },
  {
    name: "Employee Provident Fund",
    code: "EPF",
    type: "deduction",
    sortOrder: 5,
    status: "active",
    proRata: false,
    taxable: false,
    grossSalary: false,
    pfWage: false,
    esiWage: false,
    ptWage: false
  },
  {
    name: "Employee State Insurance",
    code: "ESI",
    type: "deduction",
    sortOrder: 6,
    status: "active",
    proRata: false,
    taxable: false,
    grossSalary: false,
    pfWage: false,
    esiWage: false,
    ptWage: false
  },
  {
    name: "Professional Tax",
    code: "PT",
    type: "deduction",
    sortOrder: 7,
    status: "active",
    proRata: false,
    taxable: false,
    grossSalary: false,
    pfWage: false,
    esiWage: false,
    ptWage: false
  }
];

const ensureDefaultComponents = async (company, userId) => {
  for (const item of defaultSalaryComponents) {
    const exists = await SalaryComponent.findOne({ company, code: item.code });
    if (!exists) {
      await SalaryComponent.create({
        ...item,
        company,
        createdBy: userId,
        updatedBy: userId
      });
    }
  }
};

const normalizePayload = (body = {}) => {
  const payload = {
    name: String(body.name || "").trim(),
    type: body.type,
    sortOrder: Number(body.sortOrder),
    status: body.status || "active",
  };
  booleanFields.forEach((field) => { payload[field] = Boolean(body[field]); });
  return payload;
};

const validatePayload = (payload) => {
  if (!payload.name || !Number.isInteger(payload.sortOrder) || payload.sortOrder < 1) {
    return "Component name and a valid sort order are required.";
  }
  if (!["earning", "deduction"].includes(payload.type)) return "Invalid component type.";
  if (!["active", "inactive"].includes(payload.status)) return "Invalid component status.";
  return null;
};

exports.list = async (req, res) => {
  try {
    const company = getCompanyId(req);
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });

    const components = await SalaryComponent.find({ company }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    return res.json({ success: true, components });
  } catch (error) {
    console.error("SalaryComponent list error:", error);
    return res.status(500).json({ success: false, message: "Unable to load salary components." });
  }
};

exports.create = async (req, res) => {
  try {
    const company = getCompanyId(req);
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });
    const payload = normalizePayload(req.body);
    const validationError = validatePayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const userId = req.user?._id || req.user?.id;
    payload.code = await generateUniqueCode(company, payload.name);
    const component = await SalaryComponent.create({ ...payload, company, createdBy: userId, updatedBy: userId });
    return res.status(201).json({ success: true, message: "Salary component created successfully.", component });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This component code is already in use." });
    return res.status(500).json({ success: false, message: "Unable to create salary component." });
  }
};

exports.update = async (req, res) => {
  try {
    const company = getCompanyId(req);
    if (!company || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid request." });
    const payload = normalizePayload(req.body);
    const validationError = validatePayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const userId = req.user?._id || req.user?.id;
    const existingComponent = await SalaryComponent.findOne({ _id: req.params.id, company }).lean();
    if (!existingComponent) return res.status(404).json({ success: false, message: "Salary component not found." });
    if (existingComponent.type !== payload.type) {
      const SalaryStructure = require("../models/SalaryStructure");
      const inUse = await SalaryStructure.findOne({ company, "components.component": req.params.id }).select("name code").lean();
      if (inUse) return res.status(400).json({ success: false, message: `Component type cannot be changed because it is used in salary structure "${inUse.name}" (${inUse.code}).` });
    }
    const component = await SalaryComponent.findOneAndUpdate(
      { _id: req.params.id, company },
      { ...payload, updatedBy: userId },
      { new: true, runValidators: true }
    );
    if (!component) return res.status(404).json({ success: false, message: "Salary component not found." });
    return res.json({ success: true, message: "Salary component updated successfully.", component });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This component code is already in use." });
    return res.status(500).json({ success: false, message: "Unable to update salary component." });
  }
};

exports.remove = async (req, res) => {
  try {
    const company = getCompanyId(req);
    if (!company || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid request." });
    const SalaryStructure = require("../models/SalaryStructure");
    const inUse = await SalaryStructure.findOne({ company, "components.component": req.params.id }).lean();
    if (inUse) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete this component because it is used in salary structure "${inUse.name}" (${inUse.code}).`
      });
    }
    const component = await SalaryComponent.findOneAndDelete({ _id: req.params.id, company });
    if (!component) return res.status(404).json({ success: false, message: "Salary component not found." });
    return res.json({ success: true, message: "Salary component deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to delete salary component." });
  }
};
