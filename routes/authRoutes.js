const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const router = express.Router();
const authController = require("../controllers/authController");

const registerDocumentDir = path.join(__dirname, "../uploads/employee-documents");
fs.mkdirSync(registerDocumentDir, { recursive: true });

const registerDocumentUpload = multer({  
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, registerDocumentDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimetype = String(file.mimetype || "");
    if (mimetype.startsWith("image/") || mimetype === "application/pdf") return cb(null, true);
    const error = new Error("Only image or PDF files are allowed for registration documents");
    error.code = "INVALID_FILE_TYPE";
    cb(error);
  }
}).fields([
  { name: "aadharFront", maxCount: 1 },
  { name: "aadharBack", maxCount: 1 },
  { name: "panFront", maxCount: 1 },
  { name: "panBack", maxCount: 1 },
  { name: "bankStatement", maxCount: 1 },
  { name: "experienceLetter", maxCount: 1 },
  { name: "salarySlip", maxCount: 1 },
  { name: "additionalDocument", maxCount: 1 }
]);

const handleRegisterDocumentUpload = (req, res, next) => {
  registerDocumentUpload(req, res, error => {
    if (!error) return next();
    const message = error?.code === "LIMIT_FILE_SIZE"
      ? "Document file is too large. Maximum file size is 10 MB."
      : error?.message || "Document upload failed";
    return res.status(400).json({
      success: false,
      message,
      code: error?.code || "UPLOAD_ERROR"
    });
  });
};

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


router.post("/register", authAttemptLimiter, handleRegisterDocumentUpload, authController.register);
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
