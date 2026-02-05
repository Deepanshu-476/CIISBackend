const Joi = require("joi");

// Register validation (Updated with full user fields)
const registerSchema = Joi.object({
   name: Joi.string().min(2).max(50).required().messages({
    "string.empty": "Name is required",
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name cannot exceed 50 characters"
  }),
  email: Joi.string().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Please provide a valid email"
  }),
    company: Joi.string().hex().length(24).required().messages({
    "string.empty": "Company is required",
    "string.hex": "Invalid company ID format",
    "string.length": "Invalid company ID length"
  }),
  companyIdentifier: Joi.string()
    .optional()
    .allow('', null)
    .messages({
      'string.base': 'Company identifier must be a string'
    }),
    
  // For two-factor authentication
  twoFactorCode: Joi.string()
    .optional()
    .length(6)
    .pattern(/^[0-9]+$/)
    .messages({
      'string.length': 'Two-factor code must be 6 digits',
      'string.pattern.base': 'Two-factor code must contain only numbers'
    }),
  companyCode: Joi.string().required().messages({
    "string.empty": "Company code is required"
  }),
  password: Joi.string().min(8).required().messages({
    "string.empty": "Password is required",
    "string.min": "Password must be at least 8 characters"
  }),
  department: Joi.string().hex().length(24).required().messages({
    "string.empty": "Department is required",
    "string.hex": "Invalid department ID format",
    "string.length": "Invalid department ID length"
  }),
 jobRole: Joi.string().hex().length(24).required().messages({
    "string.empty": "Job role is required",
    "string.length": "Invalid job role ID format"
  }),
  // Optional extended fields (for role = 'user')
  phone: Joi.string().pattern(/^\d{10}$/).allow('').messages({
    "string.pattern.base": "Phone must be 10 digits"
  }),
  address: Joi.string().allow(""),
  gender: Joi.string().valid('male', 'female', 'other').allow(''),
  maritalStatus: Joi.string().valid('single', 'married', 'divorced', 'widowed').allow(''),
  dob: Joi.date().allow(""),
  salary: Joi.string().allow(""),

  accountNumber: Joi.string().allow(""),
  ifsc: Joi.string().pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/).allow('').messages({
    "string.pattern.base": "Invalid IFSC code format"
  }),
  bankName: Joi.string().allow(""),
  bankHolderName: Joi.string().allow(""),

  employeeType: Joi.string().valid("intern", "technical", "non-technical", "sales").allow(""),
  
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
  email: Joi.string().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Please provide a valid email"
  }),
  password: Joi.string().required().messages({
    "string.empty": "Password is required"
  }),
   companyCode: Joi.string()
    .optional()
    .allow('', null)
    .messages({
      'string.base': 'Company code must be a string'
    }),
    companyIdentifier: Joi.string()
    .optional()
    .allow('', null)
    .messages({
      'string.base': 'Company identifier must be a string'
    }),
    twoFactorCode: Joi.string()
    .optional()
    .length(6)
    .pattern(/^[0-9]+$/)
    .allow('', null)
    .messages({
      'string.length': 'Two-factor code must be 6 digits',
      'string.pattern.base': 'Two-factor code must contain only numbers'
    })
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
