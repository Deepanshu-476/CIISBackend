const express = require('express');
const router = express.Router();

console.log("🟢 assetRoutes.js file loaded");

// DEBUG: Check imports
console.log("🔍 Checking imports...");

const { protect } = require('../middleware/authMiddleware');
const checkCompanyAccess = require('../middleware/companyAuth');


let controllers;
try {
  controllers = require('../controllers/assetController');
  console.log("✅ Controllers imported successfully. Available:", Object.keys(controllers));
} catch (err) {
  console.error("❌ Failed to import controllers:", err.message);
}

const {
  getAssets,
  getAssetById,
  createAsset,
  updateAsset,
  deleteAsset,
  bulkDeleteAssets,
  assignAsset,
  returnAsset,
  scheduleMaintenance,
  completeMaintenance,
  getAssetHistory,
  getAssetStats
} = controllers || {};

// Simple test route - NO MIDDLEWARE
router.get('/ping', (req, res) => {
  res.json({ message: 'pong', time: new Date().toISOString() });
});

// AGAR middleware available hai tabhi use karo
router.use(protect);
router.use(checkCompanyAccess);
console.log("protect type:", typeof protect);
console.log("checkCompanyAccess type:", typeof checkCompanyAccess);


// Statistics route - with null check
if (getAssetStats) {
  router.get('/stats', getAssetStats);
  console.log("✅ /stats route registered");
} else {
  router.get('/stats', (req, res) => res.json({ message: 'stats route - controller missing' }));
}

// Bulk operations
if (bulkDeleteAssets) {
  router.post('/bulk-delete', bulkDeleteAssets);
  console.log("✅ /bulk-delete route registered");
}

// Assignment and maintenance routes
if (assignAsset) router.post('/assign', assignAsset);
if (returnAsset) router.post('/:id/return', returnAsset);
if (scheduleMaintenance) router.post('/:id/maintenance', scheduleMaintenance);
if (completeMaintenance) router.put('/:id/maintenance/:maintenanceId/complete', completeMaintenance);
if (getAssetHistory) router.get('/:id/history', getAssetHistory);

// CRUD operations
if (getAssets) router.get('/', getAssets);
if (createAsset) router.post('/', createAsset);
if (getAssetById) router.get('/:id', getAssetById);
if (updateAsset) router.put('/:id', updateAsset);
if (deleteAsset) router.delete('/:id', deleteAsset);

console.log("✅ assetRoutes.js setup complete");

module.exports = router;