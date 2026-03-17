const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getCompanyAssets,
  createCompanyAsset,
  updateAssetStatus,
  deleteCompanyAsset
} = require('../controllers/companyAssetController');

// Debug middleware for this router
router.use((req, res, next) => {
  console.log(`📍 CompanyAsset Route: ${req.method} ${req.originalUrl}`);
  next();
});

// Protect all routes
router.use(protect);

// Company asset routes
router.route('/')
  .get(getCompanyAssets)
  .post(createCompanyAsset);

// Status update route
router.route('/:id/status')
  .put(updateAssetStatus);

router.route('/:id')
  .delete(deleteCompanyAsset);

module.exports = router;