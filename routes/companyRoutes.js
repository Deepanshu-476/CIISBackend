const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");



router.post("/upload-logo", 
  (req, res, next) => {
    companyController.uploadLogo(req, res, (err) => {
      if (err) {
        let errMsg = err.message || 'Logo upload failed';
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          errMsg = 'Logo file size is too large. Max limit is 2MB.';
        }
        return res.status(400).json({
          success: false,
          message: errMsg
        });
      }
      next();
    });
  },
  companyController.uploadLogoHandler     
);


router.patch("/:id/logo", companyController.updateCompanyLogo);


router.post("/", companyController.createCompany);


router.get("/", companyController.getAllCompanies);


router.get("/code/:companyCode", companyController.getCompanyByCode);


router.get("/details/:identifier", companyController.getCompanyDetailsByIdentifier);


router.get("/validate-url/:identifier", companyController.validateCompanyUrl);


router.get("/:id/stats", companyController.getCompanyStats);


router.get("/:id/users", companyController.getCompanyUsers);


router.patch("/:id/access", companyController.updateCompanyAccess);


router.patch("/:id/subscription", companyController.renewCompanySubscription);


router.get("/:id", companyController.getCompanyById);


router.put("/:id", companyController.updateCompany);


router.patch("/:id/deactivate", companyController.deactivateCompany);


router.patch("/:id/activate", companyController.activateCompany);


router.get("/:id/dashboard-config", protect, companyController.getDashboardConfig);
router.put("/:id/dashboard-config", protect, companyController.updateDashboardConfig);

router.delete("/:id", companyController.deleteCompanyPermanently);
router.get('/test', (req, res) => {
  res.json({  
    status: 'healthy',
    service: 'Menu Access API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

module.exports = router;
