const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// ==================== PUBLIC ROUTES ====================
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/verify-email/:token", authController.verifyEmail);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// ==================== OTP VERIFICATION ROUTES ====================
router.post("/verify-login-otp", authController.verifyLoginOTP);
router.post("/resend-login-otp", authController.resendLoginOTP);

// ==================== SUPER ADMIN ROUTES ====================
router.post("/superadmin/login", authController.login);
router.post("/superadmin/verify-otp", authController.verifyLoginOTP);
router.post("/superadmin/resend-otp", authController.resendLoginOTP);

// ==================== COMPANY-SPECIFIC ROUTES ====================
router.post("/company/:companyCode/login", authController.companyLoginRoute);
router.post("/company-login/:companyCode", authController.companyLogin);
router.post("/company/:companyCode/verify-otp", authController.verifyLoginOTP);
router.post("/company/:companyCode/resend-otp", authController.resendLoginOTP);
router.get("/company/:identifier", authController.getCompanyDetailsByIdentifier);

// ==================== TEST ROUTE ====================
router.get("/test", authController.testAPI);

module.exports = router;