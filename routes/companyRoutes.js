// routes/companyRoutes.js
const express = require("express");
const router = express.Router();

const companyController = require("../controllers/companyController");

// ✅ Create company
router.post("/", companyController.createCompany);

// ✅ Get all companies
router.get("/", companyController.getAllCompanies);

// ✅ Get company by code
router.get("/code/:companyCode", companyController.getCompanyByCode);

// ✅ Get company details by identifier (for login page)
router.get("/details/:identifier", companyController.getCompanyDetailsByIdentifier);

// ✅ Validate company URL
router.get("/validate-url/:identifier", companyController.validateCompanyUrl);

// ✅ Get company stats
router.get("/:id/stats", companyController.getCompanyStats);

// ✅ Get company users
router.get("/:id/users", companyController.getCompanyUsers);

// ✅ Get company by ID
router.get("/:id", companyController.getCompanyById);

// ✅ Update company
router.patch("/:id", companyController.updateCompany);

// ✅ Deactivate company (soft delete)
router.patch("/:id/deactivate", companyController.deactivateCompany);

// ✅ Activate company
router.patch("/:id/activate", companyController.activateCompany);

// ✅ Hard delete company
router.delete("/:id", companyController.deleteCompanyPermanently);

module.exports = router;