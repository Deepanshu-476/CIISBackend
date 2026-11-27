const express = require('express');
const router = express.Router();
const { protect, requirePlatformOwner } = require('../middleware/authMiddleware');
const adsConfig = require('../services/marketingAdsConfigService');

router.use(protect, requirePlatformOwner);

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
