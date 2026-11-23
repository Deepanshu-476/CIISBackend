const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const adsConfig = require('../services/marketingAdsConfigService');

const OWNER_SUPERADMIN_EMAIL = "ashutoshrai130@gmail.com";

const requireOwnerSuperAdmin = (req, res, next) => {
  const email = String(req.user?.email || "").trim().toLowerCase();
  const jobRole = String(req.user?.jobRole || "").trim().toLowerCase();
  const companyRole = String(req.user?.companyRole || "").trim().toLowerCase();

  if (
    email === OWNER_SUPERADMIN_EMAIL ||
    jobRole === "super_admin" ||
    jobRole === "superadmin" ||
    companyRole === "superadmin"
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Only SuperAdmin can manage Marketing Ads settings",
  });
};

router.use(protect, requireOwnerSuperAdmin);

router.get('/', async (req, res) => {
  try {
    const config = await adsConfig.getPublicConfig();
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error fetching Marketing Ads settings:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load settings' });
  }
});

router.put('/', async (req, res) => {
  try {
    const config = await adsConfig.updateConfig(req.body, req.user?._id);
    res.json({ success: true, message: 'Marketing Ads settings saved successfully', config });
  } catch (error) {
    console.error('Error updating Marketing Ads settings:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to save settings' });
  }
});

module.exports = router;
