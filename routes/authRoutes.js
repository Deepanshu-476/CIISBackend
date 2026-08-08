const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const authController = require("../controllers/authController");

const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Please try again later.",
  },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again later.",
  },
});


router.post("/register", authAttemptLimiter, authController.register);
router.post("/login", authAttemptLimiter, authController.login); 
router.post("/forgot-password", passwordResetLimiter, authController.forgotPassword);
router.post("/verify-reset-otp", passwordResetLimiter, authController.verifyPasswordResetOTP);
router.post("/reset-password", passwordResetLimiter, authController.resetPassword);   
router.get("/verify-email/:token", authController.verifyEmail);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout); 
 
 
router.post("/verify-login-otp", otpLimiter, authController.verifyLoginOTP);         
router.post("/resend-login-otp", otpLimiter, authController.resendLoginOTP); 


router.post("/superadmin/login", authAttemptLimiter, authController.superAdminLogin);
router.post("/superadmin/verify-otp", otpLimiter, authController.verifySuperAdminOTP);
router.post("/superadmin/resend-otp", otpLimiter, authController.resendSuperAdminOTP);
router.post("/superadmin/forgot-password", passwordResetLimiter, authController.requestSuperAdminPasswordReset);
router.post("/superadmin/verify-reset-otp", passwordResetLimiter, authController.verifySuperAdminResetOTP);
router.post("/superadmin/reset-password", passwordResetLimiter, authController.resetSuperAdminPassword);


router.post("/company/:companyCode/login", authAttemptLimiter, authController.companyLoginRoute);
router.post("/company-login/:companyCode", authAttemptLimiter, authController.companyLogin);
router.post("/company/:companyCode/verify-otp", otpLimiter, authController.verifyLoginOTP);
router.post("/company/:companyCode/resend-otp", otpLimiter, authController.resendLoginOTP);
router.get("/company/:identifier", authController.getCompanyDetailsByIdentifier);


router.get("/test", authController.testAPI);

module.exports = router;
