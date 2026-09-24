const express = require("express");
const router = express.Router();
const Plan = require("../models/Plan");
const mongoose = require("mongoose");
const { protect, restrictTo, isSuperAdminUser } = require("../middleware/authMiddleware");

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
  return errors;
};

// GET /api/plans: Active plans are publicly readable (needed by prospective clients during registration).
// Inactive plans are only returned if includeInactive=true AND caller is authenticated SuperAdmin.
router.get("/", async (req, res) => {
  try {
    let canViewInactive = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        await new Promise((resolve) => {
          protect(req, res, () => {
            if (req.user && isSuperAdminUser(req.user)) {
              canViewInactive = true;
            }
            resolve();
          });
        });
      } catch {
        canViewInactive = false;
      }
    }

    const wantsInactive = req.query.includeInactive === "true";
    const query = (wantsInactive && canViewInactive) ? {} : { isActive: true };
    const plans = await populatePlanAudit(Plan.find(query).sort({ createdAt: -1 }));
    res.json({ success: true, count: plans.length, plans });
  } catch (error) {
    console.error("❌ Get plans error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch plans" });
  }
});

// Mutating endpoints strictly restricted to Platform SuperAdmin
router.post("/", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    const payload = buildPlanPayload(req.body);
    const errors = validatePlanPayload(payload);
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    payload.createdBy = req.user?._id || null;
    payload.updatedBy = req.user?._id || null;

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

router.put("/:id", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid plan id" });
    }

    const payload = buildPlanPayload(req.body);
    const errors = validatePlanPayload(payload);
    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    payload.updatedBy = req.user?._id || null;

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

router.patch("/:id/status", protect, restrictTo("super_admin"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid plan id" });
    }

    const plan = await populatePlanAudit(Plan.findByIdAndUpdate(
      req.params.id,
      { 
        isActive: Boolean(req.body.isActive),
        updatedBy: req.user?._id || null,
      },
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
