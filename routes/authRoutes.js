const express = require("express");
const router = express.Router();

const {
  register,
  login,
  forgotPassword,
  resetPassword,
  changePassword // ✅ Add this controller
} = require("../controllers/authController");

const { validateRequest } = require("../middleware/validation");
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema // ✅ Add schema if using validation
} = require("../validations/authValidation");

// ✅ Rate limiting to prevent brute force attacks
const rateLimit = require("express-rate-limit");
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: "Too many requests from this IP, please try again later"
});

// ✅ Apply rate limiting only to critical endpoints
router.use(["/register", "/login", "/forgot-password"], authLimiter);

// ✅ Auth routes
router.post("/register", validateRequest(registerSchema), register);
router.post("/login", validateRequest(loginSchema), login);

// ✅ Password reset routes
router.post("/forgot-password", validateRequest(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validateRequest(resetPasswordSchema), resetPassword);

// ✅ Password change (old password + new password)
router.post("/change-password", validateRequest(changePasswordSchema), changePassword); // ✅ new route

module.exports = router;
