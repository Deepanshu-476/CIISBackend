const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// ✅ Public routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/verify-email/:token", authController.verifyEmail);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// ✅ Company-specific login route
router.post("/company/:companyCode/login", authController.companyLoginRoute);

// ✅ Direct company login
router.post("/company-login/:companyCode", authController.companyLogin);

// ✅ Get company details
router.get("/company/:identifier", authController.getCompanyDetailsByIdentifier);

// ✅ Test API
router.get("/test", authController.testAPI);

module.exports = router;
