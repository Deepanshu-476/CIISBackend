const Joi = require("joi");

// Register validation (Updated with full user fields)
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid("admin", "hr", "user", "manager", "SuperAdmin").required(),

  // Optional extended fields (for role = 'user')
  phone: Joi.string().allow(""),
  address: Joi.string().allow(""),
  gender: Joi.string().allow(""),
  maritalStatus: Joi.string().allow(""),
  dob: Joi.date().allow(""),
  salary: Joi.string().allow(""),

  accountNumber: Joi.string().allow(""),
  ifsc: Joi.string().allow(""),
  bankName: Joi.string().allow(""),
  bankHolderName: Joi.string().allow(""),

  employeeType: Joi.string().valid("intern", "technical", "non-technical", "sales").allow(""),
  jobRole: Joi.string().allow(""),
  properties: Joi.array().items(Joi.string()).allow(null),
  propertyOwned: Joi.string().allow(""),
  additionalDetails: Joi.string().allow(""),

  fatherName: Joi.string().allow(""),
  motherName: Joi.string().allow(""),

  emergencyName: Joi.string().allow(""),
  emergencyPhone: Joi.string().allow(""),
  emergencyRelation: Joi.string().allow(""),
  emergencyAddress: Joi.string().allow("")
});

// Login validation
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Forgot password validation
const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

// Reset password validation (using user ID and new password)
const resetPasswordSchema = Joi.object({
  id: Joi.string().required(),
  password: Joi.string().min(8).required()
});

// ✅ Change password validation (old + new password)
const changePasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  oldPassword: Joi.string().min(5).required(),
  newPassword: Joi.string().min(8).required()
});

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema
};
