const mongoose = require("mongoose");
const SalaryComponent = require("../models/SalaryComponent");

const getCompanyId = (req) => req.user?.company?._id || req.user?.company;
const booleanFields = ["proRata", "taxable", "grossSalary", "pfWage", "esiWage", "ptWage"];

const normalizePayload = (body = {}) => {
  const payload = {
    name: String(body.name || "").trim(),
    code: String(body.code || "").trim().toUpperCase(),
    type: body.type,
    sortOrder: Number(body.sortOrder),
    status: body.status || "active",
  };
  booleanFields.forEach((field) => { payload[field] = Boolean(body[field]); });
  return payload;
};

const validatePayload = (payload) => {
  if (!payload.name || !payload.code || !Number.isInteger(payload.sortOrder) || payload.sortOrder < 1) {
    return "Component name, code, and a valid sort order are required.";
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
    const component = await SalaryComponent.create({ ...payload, company, createdBy: req.user.id, updatedBy: req.user.id });
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
    const component = await SalaryComponent.findOneAndUpdate(
      { _id: req.params.id, company },
      { ...payload, updatedBy: req.user.id },
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
    const component = await SalaryComponent.findOneAndDelete({ _id: req.params.id, company });
    if (!component) return res.status(404).json({ success: false, message: "Salary component not found." });
    return res.json({ success: true, message: "Salary component deleted successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to delete salary component." });
  }
};
