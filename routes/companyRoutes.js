// routes/companyRoutes.js
const express = require("express");
const router = express.Router();

const companyController = require("../controllers/companyController");

// ✅ Create company
router.post("/", companyController.createCompany);

// ✅ Get all companies
router.get("/", companyController.getAllCompanies);

router.get("/code/:companyCode", companyController.getCompanyByCode);
router.get("/:id", companyController.getCompanyById);


// ✅ Update company
router.patch("/:id", companyController.updateCompany);

// ✅ Deactivate company (soft delete)
router.patch("/:id/deactivate", companyController.deactivateCompany);

// ✅ Activate company (optional)
router.patch("/:id/activate", companyController.activateCompany);

// ✅ Hard delete company (optional)
router.delete("/:id", companyController.deleteCompanyPermanently);

module.exports = router;
