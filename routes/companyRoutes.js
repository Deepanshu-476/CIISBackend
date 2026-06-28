const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const multer = require("multer");

// ✅ LOGO UPLOAD ROUTE - Using multer middleware with error handling
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
  companyController.uploadLogoHandler     // Handle logo upload
);

// ✅ UPDATE COMPANY LOGO (via URL)
router.patch("/:id/logo", companyController.updateCompanyLogo);

// ✅ CREATE COMPANY
router.post("/", companyController.createCompany);

// ✅ GET ALL COMPANIES
router.get("/", companyController.getAllCompanies);

// ✅ GET COMPANY BY CODE
router.get("/code/:companyCode", companyController.getCompanyByCode);

// ✅ GET COMPANY DETAILS BY IDENTIFIER (for login page)
router.get("/details/:identifier", companyController.getCompanyDetailsByIdentifier);

// ✅ VALIDATE COMPANY URL
router.get("/validate-url/:identifier", companyController.validateCompanyUrl);

// ✅ GET COMPANY STATS
router.get("/:id/stats", companyController.getCompanyStats);

// ✅ GET COMPANY USERS
router.get("/:id/users", companyController.getCompanyUsers);

// ✅ UPDATE COMPANY PAGE ACCESS / ACTIVATION
router.patch("/:id/access", companyController.updateCompanyAccess);

// ✅ RENEW COMPANY SUBSCRIPTION / PAYMENT
router.patch("/:id/subscription", companyController.renewCompanySubscription);

// ✅ GET COMPANY BY ID
router.get("/:id", companyController.getCompanyById);

// ✅ UPDATE COMPANY
router.put("/:id", companyController.updateCompany);

// ✅ DEACTIVATE COMPANY (soft delete)
router.patch("/:id/deactivate", companyController.deactivateCompany);

// ✅ ACTIVATE COMPANY
router.patch("/:id/activate", companyController.activateCompany);

// ✅ HARD DELETE COMPANY
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
