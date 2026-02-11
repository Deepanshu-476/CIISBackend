// routes/companyRoutes.js
const express = require("express");
const router = express.Router();

const companyController = require("../controllers/companyController");

// ✅ LOGO UPLOAD ROUTE
router.post("/upload-logo", 
  companyController.uploadLogo,           // Multer middleware for file upload
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

module.exports = router;