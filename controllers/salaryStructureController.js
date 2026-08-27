const mongoose = require("mongoose");
const SalaryStructure = require("../models/SalaryStructure");
const SalaryComponent = require("../models/SalaryComponent");
const PayrollCounter = require("../models/PayrollCounter");

const getCompany = (req) => req.user?.company?._id || req.user?.company || req.user?.companyId;

const generateStructureCode = async (company) => {
  while (true) {
    const counter = await PayrollCounter.findOneAndUpdate(
      { company, key: "salary-structure" },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const code = `SAL-${String(counter.sequence).padStart(3, "0")}`;
    if (!(await SalaryStructure.exists({ company, code }))) return code;
  }
};

// Helper to resolve component ObjectIds reliably
const resolveStructureComponents = async (rawComponents, company, userId) => {
  const resolved = [];
  const existingComponents = await SalaryComponent.find({ company }).lean();
  const compCodeMap = new Map();
  const compIdMap = new Map();

  existingComponents.forEach(c => {
    compCodeMap.set(c.code.toUpperCase(), c._id);
    compIdMap.set(String(c._id), c._id);
  });

  for (let i = 0; i < rawComponents.length; i++) {
    const row = rawComponents[i];
    const compObj = row.component || {};
    const compIdOrCode = String(compObj._id || compObj.code || row.component || "").trim();
    const compCode = String(compObj.code || row.code || "").trim().toUpperCase();
    const compName = String(compObj.name || row.name || "").trim();

    let targetId = null;

    if (compIdMap.has(compIdOrCode)) {
      targetId = compIdMap.get(compIdOrCode);
    } else if (compCode && compCodeMap.has(compCode)) {
      targetId = compCodeMap.get(compCode);
    } else if (compCodeMap.has(compIdOrCode.toUpperCase())) {
      targetId = compCodeMap.get(compIdOrCode.toUpperCase());
    } else {
      // Create component if it doesn't exist
      const newCode = compCode || `COMP_${i + 1}`;
      const newName = compName || newCode;
      const created = await SalaryComponent.create({
        company,
        name: newName,
        code: newCode,
        type: compObj.type || row.type || "earning",
        sortOrder: row.sortOrder || i + 1,
        status: "active",
        createdBy: userId,
        updatedBy: userId
      });
      targetId = created._id;
      compCodeMap.set(newCode, targetId);
      compIdMap.set(String(targetId), targetId);
    }

    resolved.push({
      component: targetId,
      calculationType: row.calculationType || "manual",
      calculationBase: String(row.calculationBase || "").trim(),
      value: Number(row.value || 0),
      formula: String(row.formula || "").trim(),
      sortOrder: Number(row.sortOrder || i + 1)
    });
  }

  return resolved;
};

const ensureDefaultStructure = async (company, userId) => {
  const existing = await SalaryStructure.findOne({ company, code: "STD-GROSS" });
  if (existing) return;

  const components = await SalaryComponent.find({ company }).lean();
  if (!components.length) return;

  const compMap = new Map();
  components.forEach(c => compMap.set(c.code, c._id));

  const structureComponents = [
    { component: compMap.get("BASIC"), calculationType: "manual", value: 15000, sortOrder: 1 },
    { component: compMap.get("HRA"), calculationType: "percentage", calculationBase: "Basic Salary", value: 50, sortOrder: 2 },
    { component: compMap.get("CONV"), calculationType: "manual", value: 2000, sortOrder: 3 },
    { component: compMap.get("SPL"), calculationType: "formula", formula: "Gross - (Basic + HRA + CONV)", sortOrder: 4 },
    { component: compMap.get("EPF"), calculationType: "percentage", calculationBase: "PF Wage", value: 12, sortOrder: 5 },
    { component: compMap.get("ESI"), calculationType: "percentage", calculationBase: "ESI Wage", value: 0.75, sortOrder: 6 },
    { component: compMap.get("PT"), calculationType: "manual", value: 200, sortOrder: 7 },
  ].filter(r => r.component);

  if (structureComponents.length > 0) {
    await SalaryStructure.create({
      company,
      name: "Standard - Gross Based",
      code: "STD-GROSS",
      salaryType: "monthly",
      salaryInputType: "gross",
      effectiveFrom: new Date(),
      description: "Standard Gross salary structure template",
      status: "active",
      components: structureComponents,
      createdBy: userId,
      updatedBy: userId
    });
  }
};

const populate = (query) => query.populate("components.component", "name code type status");
const validateStructureOptions = (salaryType, salaryInputType, status) => {
  if (!["monthly", "annual"].includes(salaryType)) return "Invalid salary type.";
  if (!["gross", "ctc"].includes(salaryInputType)) return "Invalid salary input type.";
  if (!["active", "inactive"].includes(status)) return "Invalid salary structure status.";
  return null;
};

exports.list = async (req, res) => {
  try {
    const company = getCompany(req);
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });

    const structures = await populate(SalaryStructure.find({ company }).sort({ updatedAt: -1 })).lean();
    return res.json({ success: true, structures });
  } catch (error) {
    console.error("SalaryStructure list error:", error);
    return res.status(500).json({ success: false, message: "Unable to load salary structures." });
  }
};

exports.getById = async (req, res) => {
  try {
    const company = getCompany(req);
    if (!company || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid request." });
    const structure = await populate(SalaryStructure.findOne({ _id: req.params.id, company })).lean();
    if (!structure) return res.status(404).json({ success: false, message: "Salary structure not found." });
    return res.json({ success: true, structure });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to fetch salary structure." });
  }
};

exports.create = async (req, res) => {
  try {
    const company = getCompany(req);
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });

    const name = String(req.body.name || "").trim();
    const salaryType = req.body.salaryType || "monthly";
    const salaryInputType = req.body.salaryInputType || "gross";
    const requestedEffectiveFrom = req.body.effectiveFrom;
    const effectiveFrom = requestedEffectiveFrom ? new Date(requestedEffectiveFrom) : new Date();
    const description = String(req.body.description || "").trim();
    const status = req.body.status || "active";
    const rawComponents = Array.isArray(req.body.components) ? req.body.components : [];

    if (!name || Number.isNaN(effectiveFrom.getTime())) {
      return res.status(400).json({ success: false, message: "Structure name is required." });
    }
    if (!rawComponents.length) {
      return res.status(400).json({ success: false, message: "Please add at least one salary component." });
    }
    const optionError = validateStructureOptions(salaryType, salaryInputType, status);
    if (optionError) return res.status(400).json({ success: false, message: optionError });

    const defaultGross = Math.max(0, Number(req.body.defaultGross || req.body.grossSalary || 0));
    const userId = req.user?._id || req.user?.id;
    const resolvedComponents = await resolveStructureComponents(rawComponents, company, userId);
    const code = await generateStructureCode(company);

    const structure = await SalaryStructure.create({
      company,
      name,
      code,
      salaryType,
      salaryInputType,
      defaultGross,
      effectiveFrom,
      description,
      status,
      components: resolvedComponents,
      createdBy: userId,
      updatedBy: userId
    });

    const created = await populate(SalaryStructure.findById(structure._id)).lean();
    return res.status(201).json({ success: true, message: "Salary structure created successfully.", structure: created });
  } catch (error) {
    console.error("SalaryStructure create error:", error);
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "Structure code already exists." });
    return res.status(500).json({ success: false, message: "Unable to create salary structure." });
  }
};

exports.update = async (req, res) => {
  try {
    const company = getCompany(req);
    const { id } = req.params;
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });

    const name = String(req.body.name || "").trim();
    const salaryType = req.body.salaryType || "monthly";
    const salaryInputType = req.body.salaryInputType || "gross";
    const requestedEffectiveFrom = req.body.effectiveFrom;
    const description = String(req.body.description || "").trim();
    const status = req.body.status || "active";
    const rawComponents = Array.isArray(req.body.components) ? req.body.components : [];

    if (!name || (requestedEffectiveFrom && Number.isNaN(new Date(requestedEffectiveFrom).getTime()))) {
      return res.status(400).json({ success: false, message: "Structure name is required." });
    }
    if (!rawComponents.length) {
      return res.status(400).json({ success: false, message: "Please add at least one salary component." });
    }
    const optionError = validateStructureOptions(salaryType, salaryInputType, status);
    if (optionError) return res.status(400).json({ success: false, message: optionError });

    const userId = req.user?._id || req.user?.id;
    const resolvedComponents = await resolveStructureComponents(rawComponents, company, userId);

    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid salary structure." });
    const structure = await SalaryStructure.findOne({ _id: id, company });
    if (!structure) return res.status(404).json({ success: false, message: "Salary structure not found." });

    structure.name = name;
    structure.salaryType = salaryType;
    structure.salaryInputType = salaryInputType;
    structure.defaultGross = Math.max(0, Number(req.body.defaultGross || req.body.grossSalary || 0));
    if (requestedEffectiveFrom) structure.effectiveFrom = new Date(requestedEffectiveFrom);
    structure.description = description;
    structure.status = status;
    structure.components = resolvedComponents;
    structure.updatedBy = userId;

    await structure.save();
    const populated = await populate(SalaryStructure.findById(structure._id)).lean();

    return res.json({ success: true, message: "Salary structure updated successfully.", structure: populated });
  } catch (error) {
    console.error("SalaryStructure update error:", error);
    return res.status(500).json({ success: false, message: "Unable to update salary structure." });
  }
};

exports.remove = async (req, res) => {
  try {
    const company = getCompany(req);
    const { id } = req.params;
    if (!company) return res.status(400).json({ success: false, message: "Company is required." });

    let filter = { company };
    if (mongoose.isValidObjectId(id)) {
      filter._id = id;
    } else {
      filter.code = String(id).toUpperCase();
    }

    const structure = await SalaryStructure.findOne(filter).lean();
    if (!structure) return res.status(404).json({ success: false, message: "Salary structure not found." });
    const EmployeeSalary = require("../models/EmployeeSalary");
    const assignedSalary = await EmployeeSalary.findOne({ company, salaryStructure: structure._id, status: "active" }).select("_id").lean();
    if (assignedSalary) {
      return res.status(400).json({ success: false, message: `Cannot delete salary structure "${structure.name}" because it is assigned to an active employee.` });
    }
    await SalaryStructure.deleteOne({ _id: structure._id, company });
    return res.json({ success: true, message: "Salary structure deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to delete salary structure." });
  }
};
