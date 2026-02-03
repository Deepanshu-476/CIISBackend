const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { validateRequest } = require("../middleware/validation");
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema
} = require("../validations/authValidation");

// ✅ Public routes
router.post("/register", validateRequest(registerSchema), authController.register);
router.post("/login", validateRequest(loginSchema), authController.login);
router.post("/forgot-password", validateRequest(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validateRequest(resetPasswordSchema), authController.resetPassword);
router.get("/verify-email/:token", authController.verifyEmail);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// ✅ Company-specific login route
router.post("/company/:companyCode/login", (req, res, next) => {
  console.log('Company login route hit:', {
    identifier: req.params.companyIdentifier,
    body: { email: req.body.email ? `${req.body.email.substring(0, 3)}...` : 'undefined' }
  });
  
  // Add company identifier to request body
  req.body.companyIdentifier = req.params.companyIdentifier;
  next();
}, validateRequest(loginSchema), authController.login);

module.exports = router;