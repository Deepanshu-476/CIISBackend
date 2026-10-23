const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const dashboardOverviewController = require("../controllers/dashboardOverviewController");

// Get live aggregated data for all 19 dynamic overview sections (authenticated)
router.get("/data", protect, dashboardOverviewController.getDynamicDashboardOverviewData);
router.get("/data/:companyId", protect, dashboardOverviewController.getDynamicDashboardOverviewData);

// Company listing for preview selector
router.get("/companies", protect, dashboardOverviewController.getAvailableCompaniesForPreview);

// Configuration read and update
router.get("/config", protect, dashboardOverviewController.getDashboardConfiguration);
router.get("/config/:companyId", protect, dashboardOverviewController.getDashboardConfiguration);
router.put("/config", protect, dashboardOverviewController.updateDashboardConfiguration);
router.put("/config/:companyId", protect, dashboardOverviewController.updateDashboardConfiguration);

module.exports = router;
