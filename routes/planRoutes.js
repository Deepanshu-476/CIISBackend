const express = require("express");
const router = express.Router();
const Plan = require("../models/Plan");
const mongoose = require("mongoose");

const cleanStringArray = value => (
  Array.isArray(value)
    ? [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))]
    : []
);

const isValidObjectId = id => mongoose.Types.ObjectId.isValid(id);

const buildPlanPayload = body => {
  const name = String(body.name || "").trim();
  const price = Number(body.price);
  const durationDays = Number(body.durationDays);
  const description = String(body.description || "").trim();
  const features = cleanStringArray(body.features);
  const allowedPages = cleanStringArray(body.allowedPages);
  const allowedSuperAdminPages = cleanStringArray(body.allowedSuperAdminPages);

  return {
    name,
    price,
    durationDays,
    description,
    features,
    allowedPages,
    allowedSuperAdminPages,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
};

const populatePlanAudit = query => query
  .populate("createdBy", "name email")
  .populate("updatedBy", "name email");

const validatePlanPayload = payload => {
  const errors = [];
  if (!payload.name) errors.push("Plan name is required");
  if (!Number.isFinite(payload.price) || payload.price < 0) errors.push("Valid plan price is required");
  if (!Number.isFinite(payload.durationDays) || payload.durationDays < 1) errors.push("Valid plan duration is required");
  if (!payload.allowedPages.length) errors.push("Select at least one page for this plan");
  if (!payload.allowedSuperAdminPages.length) errors.push("Select at least one super admin page for this plan");
  return errors;
};

router.get("/", async (req, res) => {
  try {
    const query = req.query.includeInactive === "true" ? {} : { isActive: true };
    const plans = await populatePlanAudit(Plan.find(query).sort({ createdAt: -1 }));
    res.json({ success: true, count: plans.length, plans });
  } catch (error) {
    console.error("❌ Get plans error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch plans" });
  }
});

router.post("/", async (req, res) => {
  try {
    const payload = buildPlanPayload(req.body);
    const errors = validatePlanPayload(payload);
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    if (req.body.createdBy && isValidObjectId(req.body.createdBy)) {
      payload.createdBy = req.body.createdBy;
      payload.updatedBy = req.body.createdBy;
    }

    const createdPlan = await Plan.create(payload);
    const plan = await populatePlanAudit(Plan.findById(createdPlan._id));
    res.status(201).json({ success: true, message: "Plan created successfully", plan });
  } catch (error) {
    console.error("❌ Create plan error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Plan name already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to create plan" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid plan id" });
    }

    const payload = buildPlanPayload(req.body);
    const errors = validatePlanPayload(payload);
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    if (req.body.updatedBy && isValidObjectId(req.body.updatedBy)) {
      payload.updatedBy = req.body.updatedBy;
    }

    const plan = await populatePlanAudit(Plan.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    }));

    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }

    res.json({ success: true, message: "Plan updated successfully", plan });
  } catch (error) {
    console.error("❌ Update plan error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Plan name already exists" });
    }
    res.status(500).json({ success: false, message: "Failed to update plan" });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid plan id" });
    }

    const plan = await populatePlanAudit(Plan.findByIdAndUpdate(
      req.params.id,
      { isActive: Boolean(req.body.isActive) },
      { new: true, runValidators: true }
    ));

    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }

    res.json({ success: true, message: "Plan status updated successfully", plan });
  } catch (error) {
    console.error("❌ Update plan status error:", error);
    res.status(500).json({ success: false, message: "Failed to update plan status" });
  }
});

module.exports = router;
