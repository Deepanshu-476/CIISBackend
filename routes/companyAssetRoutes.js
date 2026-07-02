const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getCompanyAssets,
  createCompanyAsset,
  deleteCompanyAsset
} = require('../controllers/companyAssetController');


router.use((req, res, next) => { 
  void 0;
  next();
});


router.use(protect);


router.route('/')
  .get(getCompanyAssets)
  .post(createCompanyAsset);


router.route('/:id')
  .delete(deleteCompanyAsset);

module.exports = router;