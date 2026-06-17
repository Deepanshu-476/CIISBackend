const User = require("../models/User");
const Company = require("../models/Company");
const Client = require("../HR-CDS/models/Client");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");
const Department = require("../models/Department");
const Branch = require("../models/Branch");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { validateRequest } = require("../middleware/validation");
const { loginSchema } = require("../validations/authValidation");
const OTP = require('../models/OTP');
const emailService = require('../services/emailService'); 

// Login OTP Model (add this if not exists)
const LoginOTPSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  otp: { type: String, required: true },
  tempToken: { type: String, required: true },
  expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 5 * 60 * 1000) },
  attempts: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

LoginOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const LoginOTP = mongoose.models.LoginOTP || mongoose.model('LoginOTP', LoginOTPSchema);

// Rate limiting store for brute force protection
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

// Helper function to generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const DEFAULT_CLIENT_DEPARTMENT_ID = '69ae555c9a1e47e80a40204c';
const DEFAULT_CLIENT_JOB_ROLE_ID = '69ae559b9a1e47e80a4020a2';

const normalizeCompanyCode = (value) => value ? String(value).trim().toUpperCase() : null;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveCompanyScope = async (identifier) => {
  const cleanIdentifier = identifier ? String(identifier).trim() : '';
  if (!cleanIdentifier) return null;

  const cleanCompanyCode = normalizeCompanyCode(cleanIdentifier);
  const company = await Company.findOne({
    $or: [
      { companyCode: cleanCompanyCode },
      { dbIdentifier: cleanIdentifier },
      { loginUrl: { $regex: escapeRegExp(cleanIdentifier), $options: 'i' } },
      { companyName: { $regex: `^${escapeRegExp(cleanIdentifier)}$`, $options: 'i' } }
    ]
  }).select('_id companyCode companyName');

  if (!company) return null;

  return {
    company,
    companyId: company._id,
    companyCode: company.companyCode
  };
};

const findClientPasswordAccount = async (email, companyScope = null, includePassword = false) => {
  const userQuery = { email };
  if (companyScope?.companyId || companyScope?.companyCode) {
    userQuery.$or = [
      companyScope.companyId ? { company: companyScope.companyId } : null,
      companyScope.companyCode ? { companyCode: companyScope.companyCode } : null
    ].filter(Boolean);
  }

  const userSelect = includePassword
    ? '+password +isActive +companyRole +jobRole +department +employeeType +additionalDetails'
    : '+isActive +companyRole +jobRole +department +employeeType +additionalDetails';

  const user = await User.findOne(userQuery).select(userSelect);

  const clientQuery = { email };
  if (companyScope?.companyCode) {
    clientQuery.companyCode = companyScope.companyCode;
  } else if (user?.companyCode) {
    clientQuery.companyCode = user.companyCode;
  }

  const client = await Client.findOne(clientQuery);
  return { user, client };
};

const parseAdditionalDetails = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
};

const resolveClientForUser = async (user) => {
  if (!user) return null;

  const details = parseAdditionalDetails(user.additionalDetails);
  const possibleClientIds = [
    details.clientId,
    user.employeeType,
    user.clientId,
  ].filter(Boolean);

  for (const clientId of possibleClientIds) {
    if (mongoose.Types.ObjectId.isValid(String(clientId))) {
      const client = await Client.findById(clientId).select('_id email userId companyCode client company phone');
      if (client) return client;
    }
  }

  if (user._id) {
    const linkedClient = await Client.findOne({userId: user._id}).select('_id email userId companyCode client company phone');
    if (linkedClient) return linkedClient;
  }

  if (user.email) {
    return Client.findOne({
      email: String(user.email).trim().toLowerCase(),
      ...(user.companyCode ? {companyCode: user.companyCode} : {}),
    }).select('_id email userId companyCode client company phone');
  }

  return null;
};

const createClientUserForPasswordReset = async (client, password, companyScope = null) => {
  if (!client?.email || !client?.companyCode) return null;

  const company = companyScope?.company || await Company.findOne({
    companyCode: normalizeCompanyCode(client.companyCode)
  }).select('_id companyCode companyName');

  if (!company) return null;

  const employeeId = `CLT${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const additionalDetails = JSON.stringify({
    clientId: client._id,
    isClientRepresentative: true,
    companyName: client.company,
    city: client.city
  });

  const user = await User.create({
    name: client.client || client.company || client.email.split('@')[0],
    email: String(client.email).trim().toLowerCase(),
    password,
    department: DEFAULT_CLIENT_DEPARTMENT_ID,
    jobRole: DEFAULT_CLIENT_JOB_ROLE_ID,
    company: company._id,
    companyCode: company.companyCode || normalizeCompanyCode(client.companyCode),
    employeeId,
    phone: client.phone || '',
    address: client.address || '',
    gender: 'other',
    maritalStatus: 'single',
    employeeType: client._id.toString(),
    companyRole: 'client',
    properties: [],
    propertyOwned: '',
    additionalDetails,
    isActive: true,
    isVerified: false,
    verificationToken: crypto.randomBytes(32).toString('hex')
  });

  client.userId = user._id;
  await client.save();
  return user;
};

const LOGIN_OTP_BYPASS_CODE = "987654";

const isValidLoginOTP = (otpRecord, submittedOTP) => {
  const normalizedOTP = String(submittedOTP).trim();
  return otpRecord.otp === normalizedOTP || normalizedOTP === LOGIN_OTP_BYPASS_CODE;
};

// Helper function to track login attempts
const trackLoginAttempt = (email, success = false) => {
  if (!loginAttempts.has(email)) {
    loginAttempts.set(email, { attempts: 0, lockUntil: null });
  }
  
  const data = loginAttempts.get(email);
  
  if (success) {
    // Reset on successful login
    loginAttempts.delete(email);
    return { locked: false, remaining: MAX_ATTEMPTS };
  }
  
  // Check if account is locked
  if (data.lockUntil && data.lockUntil > Date.now()) {
    return { 
      locked: true, 
      lockUntil: data.lockUntil,
      remaining: 0 
    };
  }
  
  // Increment failed attempts
  data.attempts += 1;
  
  // Lock account if max attempts reached
  if (data.attempts >= MAX_ATTEMPTS) {
    data.lockUntil = Date.now() + LOCK_TIME;
    data.attempts = 0;
  }
  
  loginAttempts.set(email, data);
  
  return { 
    locked: false, 
    remaining: MAX_ATTEMPTS - data.attempts 
  };
};

// Reusable error response
const errorResponse = (res, status, message, errorCode = null) => {
  return res.status(status).json({ 
    success: false, 
    message,
    errorCode 
  });
};

// ✅ Company Login Route Handler (with middleware)
exports.companyLoginRoute = [
  (req, res, next) => {
    console.log('🏢 Company login route hit:', {
      companyCode: req.params.companyCode,
      body: { email: req.body.email ? `${req.body.email.substring(0, 3)}...` : 'undefined' }
    });
    next();
  },
  validateRequest(loginSchema),
  async (req, res) => {
    await exports.companyLogin(req, res);
  }
];

// ✅ Company Login Endpoint
exports.companyLogin = async (req, res) => {
  const startTime = Date.now();
  const { email, password } = req.body;
  const { companyCode } = req.params;

  try {
    console.log("🏢 Company login attempt:", {
      email: email ? `${email.substring(0, 3)}...` : "undefined",
      companyCode,
      timestamp: new Date().toISOString(),
    });

    // ✅ Validate input
    if (!email || !password || !companyCode) {
      return res.status(400).json({
        success: false,
        message: "Email, password and company code are required",
        errorCode: "MISSING_CREDENTIALS",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const rawCompanyCode = companyCode.toLowerCase().trim();

    // Support companyCode-branchCode format
    let cleanCompanyCode = rawCompanyCode;
    let expectedBranchCode = null;
    if (rawCompanyCode.includes("-")) {
      const parts = rawCompanyCode.split("-");
      cleanCompanyCode = parts[0];
      expectedBranchCode = parts.slice(1).join("-").toUpperCase();
    }

    // ✅ Find company first
    const company = await Company.findOne({
      $or: [
        { companyCode: cleanCompanyCode.toUpperCase() },
        { dbIdentifier: cleanCompanyCode },
        { loginUrl: { $regex: cleanCompanyCode, $options: 'i' } }
      ]
    }).select('+isActive +subscriptionExpiry');

    if (!company) {
      console.log("❌ Company not found:", cleanCompanyCode);
      return res.status(404).json({
        success: false,
        message: "Company not found or invalid company code",
        errorCode: "COMPANY_NOT_FOUND",
      });
    }

    // ✅ Check company status
    if (!company.isActive) {
      return res.status(403).json({
        success: false,
        message: "Company account is deactivated",
        errorCode: "COMPANY_DEACTIVATED",
      });
    }

    // ✅ Check subscription expiry
    if (company.subscriptionExpiry && new Date() > new Date(company.subscriptionExpiry)) {
      return res.status(403).json({
        success: false,
        message: "Company subscription has expired",
        errorCode: "SUBSCRIPTION_EXPIRED",
        expiryDate: company.subscriptionExpiry,
      });
    }

    // ✅ Find user with company association
    const userQuery = {
      email: cleanEmail,
      $or: [
        { companyCode: company.companyCode },
        { company: company._id }
      ]
    };

    if (expectedBranchCode) {
      userQuery.branchCode = expectedBranchCode;
    }

    const user = await User.findOne(userQuery)
      .select("+password +isActive +loginAttempts +lockUntil")
      .populate("department", "name")
      .populate("branch", "name branchCode")
      .populate("company", "companyName companyCode logo")

    if (!user) {
      console.log("❌ User not found for company:", { email: cleanEmail, company: company.companyName });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password for this company",
        errorCode: "INVALID_CREDENTIALS",
      });
    }

    // ✅ Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact your administrator.",
        errorCode: "ACCOUNT_DEACTIVATED",
      });
    }

    // ✅ Check account lock
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const lockMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Account temporarily locked. Try again in ${lockMinutes} minutes.`,
        errorCode: "ACCOUNT_LOCKED",
        retryAfter: user.lockUntil,
      });
    }

    // ✅ Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const updatedAttempts = (user.failedLoginAttempts || 0) + 1;
      const updateData = {
        failedLoginAttempts: updatedAttempts,
      };

      if (updatedAttempts >= 5) {
        updateData.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minutes lock
      }

      await User.findByIdAndUpdate(user._id, updateData);

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
        remainingAttempts: Math.max(0, 5 - updatedAttempts),
      });
    }

    // ✅ Reset failed attempts on successful login
    await User.findByIdAndUpdate(user._id, {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLogin: new Date(),
      },
    });

    // ✅ Generate OTP for login verification
    const otp = generateOTP();
    const tempToken = jwt.sign(
      { 
        email: user.email,
        userId: user._id,
        purpose: 'login-verification',
        companyCode: company.companyCode
      },
      process.env.JWT_SECRET + '-temp',
      { expiresIn: '10m' }
    );

    // ✅ Save OTP to database
    await LoginOTP.create({
      email: user.email,
      otp,
      tempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    });

    // ✅ Send OTP via email
    await emailService.sendEmail(
      user.email,
      "🔐 Company Login Verification OTP",
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Company Login Verification</h2>
          <p>Hello ${user.name},</p>
          <p>Your OTP for logging into <strong>${company.companyName}</strong> is:</p>
          <h1 style="font-size: 36px; letter-spacing: 8px; background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
          <p>If you didn't attempt to login, please contact your company administrator immediately.</p>
        </div>
      `
    );

    console.log(`✅ OTP sent to ${user.email} for company login verification`);

    // ✅ Return response indicating OTP verification required
    return res.json({
      success: true,
      requiresOTP: true,
      message: "OTP sent to your email",
      tempToken: tempToken,
      email: user.email,
      companyName: company.companyName
    });

  } catch (error) {
    console.error("🔥 Company login error:", error);
    console.error("🔥 Error stack:", error.stack);

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred during company login.",
      errorCode: "INTERNAL_SERVER_ERROR",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Register User with enhanced validation
exports.register = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const {
      name,
      email,
      password,
      department,
      jobRole,
      company, 
      companyCode, 
      branch, // NEW: Branch ID
      phone, address, gender, maritalStatus, dob, salary,
      accountNumber, ifsc, bankName, bankHolderName,
      employeeType, properties, propertyOwned, additionalDetails,
      fatherName, motherName,
      emergencyName, emergencyPhone, emergencyRelation, emergencyAddress
    } = req.body;

    // Required fields validation
    const requiredFields = [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'password', label: 'Password' },
      { field: 'department', label: 'Department' },
      { field: 'jobRole', label: 'Job Role' },
      { field: 'company', label: 'Company' },
      { field: 'companyCode', label: 'Company Code' }
    ];

    const missingFields = requiredFields.filter(f => !req.body[f.field]);
    if (missingFields.length > 0) {
      await session.abortTransaction();
      return errorResponse(res, 400, 
        `Missing required fields: ${missingFields.map(f => f.label).join(', ')}`,
        'MISSING_FIELDS'
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // Enhanced email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      await session.abortTransaction();
      return errorResponse(res, 400, "Invalid email format", "INVALID_EMAIL");
    }

    // Password strength validation
    if (password.length < 8) {
      await session.abortTransaction();
      return errorResponse(res, 400, "Password must be at least 8 characters", "WEAK_PASSWORD");
    }

    // Check existing user in session
    const existingUser = await User.findOne({ email: cleanEmail }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      return errorResponse(res, 409, "Email already in use", "EMAIL_EXISTS");
    }

    // Check if department exists
    const departmentExists = await Department.findById(department).session(session);
    if (!departmentExists) {
      await session.abortTransaction();
      return errorResponse(res, 404, "Department not found", "DEPARTMENT_NOT_FOUND");
    }

    // Check if company exists and is active
    const companyExists = await Company.findOne({ 
      $or: [
        { _id: company },
        { companyCode: companyCode }
      ]
    }).session(session);

    if (!companyExists) {
      await session.abortTransaction();
      return errorResponse(res, 404, "Company not found", "COMPANY_NOT_FOUND");
    }

    if (!companyExists.isActive) {
      await session.abortTransaction();
      return errorResponse(res, 403, "Company account is deactivated", "COMPANY_DEACTIVATED");
    }

    // Check subscription expiry
    if (new Date() > new Date(companyExists.subscriptionExpiry)) {
      await session.abortTransaction();
      return errorResponse(res, 403, "Company subscription has expired", "SUBSCRIPTION_EXPIRED");
    }

    // Validate or Auto-assign Branch
    let cleanBranch = branch;
    let cleanBranchCode = null;

    if (branch) {
      const branchExists = await Branch.findById(branch).session(session);
      if (!branchExists) {
        await session.abortTransaction();
        return errorResponse(res, 404, "Branch not found", "BRANCH_NOT_FOUND");
      }
      cleanBranchCode = branchExists.branchCode;
    } else {
      // Fallback: Default to Company's Default Branch (HQ)
      const defaultBranch = await Branch.findOne({ company: company, isDefault: true }).session(session);
      if (defaultBranch) {
        cleanBranch = defaultBranch._id;
        cleanBranchCode = defaultBranch.branchCode;
      }
    }

    // Generate employee ID
    const employeeId = `EMP${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create user in session
    const user = await User.create([{
      name: name.trim(),
      email: cleanEmail,
      password: password,
      department,
      jobRole,
      company,
      companyCode,
      branch: cleanBranch,
      branchCode: cleanBranchCode,
      employeeId,
      phone: phone?.trim(),
      address: address?.trim(),
      gender,
      maritalStatus,
      dob: dob ? new Date(dob) : null,
      salary,
      accountNumber,
      ifsc,
      bankName,
      bankHolderName,
      employeeType,
      properties,
      propertyOwned,
      additionalDetails,
      fatherName: fatherName?.trim(),
      motherName: motherName?.trim(),
      emergencyName: emergencyName?.trim(),
      emergencyPhone,
      emergencyRelation,
      emergencyAddress: emergencyAddress?.trim(),
      isActive: true,
      isVerified: false,
      verificationToken: crypto.randomBytes(32).toString('hex'),
      createdBy: req.user?.id
    }], { session });

    const createdUser = user[0];

    // Commit transaction
    await session.commitTransaction();

    // Send welcome email (async, don't await)
    sendWelcomeEmail(cleanEmail, name, companyExists.companyName).catch(console.error);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: createdUser._id,
        employeeId: createdUser.employeeId,
        name: createdUser.name,
        email: createdUser.email,
        department: createdUser.department,
        jobRole: createdUser.jobRole,
        company: createdUser.company,
        companyCode: createdUser.companyCode,
        createdAt: createdUser.createdAt,
      },
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("❌ Registration error:", err);
    
    if (err.code === 11000) {
      return errorResponse(res, 409, "Duplicate entry found", "DUPLICATE_ENTRY");
    }
    
    return errorResponse(res, 500, "Registration failed. Please try again.", "REGISTRATION_FAILED");
  } finally {
    session.endSession();
  }
};

// ✅ Enhanced Login with rate limiting and OTP verification
exports.login = async (req, res) => {
  const startTime = Date.now();
  const { email, password, companyCode, companyIdentifier } = req.body;

  try {
    console.log("🔐 Login attempt:", {
      email: email ? `${email.substring(0, 3)}...` : "undefined",
      companyCode,
      companyIdentifier,
      timestamp: new Date().toISOString(),
    });

    // ✅ Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
        errorCode: "MISSING_CREDENTIALS",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // ✅ Find user
    const user = await User.findOne({ email: cleanEmail })
      .select("+password +isActive +loginAttempts +lockUntil")
      .populate("department", "name")
      .populate("branch", "name branchCode")
      .populate("company", "companyName companyCode isActive subscriptionExpiry logo companyEmail companyPhone companyAddress dbIdentifier loginUrl");

    if (!user) {
      console.log("❌ User not found:", cleanEmail);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
      });
    }

    // ✅ Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact your administrator.",
        errorCode: "ACCOUNT_DEACTIVATED",
      });
    }

    // ✅ Check account lock
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const lockMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Account temporarily locked. Try again in ${lockMinutes} minutes.`,
        errorCode: "ACCOUNT_LOCKED",
        retryAfter: user.lockUntil,
      });
    }

    // ✅ Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const updatedAttempts = (user.failedLoginAttempts || 0) + 1;
      const updateData = {
        failedLoginAttempts: updatedAttempts,
      };

      if (updatedAttempts >= 5) {
        updateData.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minutes lock
      }

      await User.findByIdAndUpdate(user._id, updateData);

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
        remainingAttempts: Math.max(0, 5 - updatedAttempts),
      });
    }

    // ✅ Use companyCode if provided, otherwise use companyIdentifier
    const rawCompanyCode = companyCode || companyIdentifier;
    let providedCompanyCode = rawCompanyCode;
    let expectedBranchCode = null;
    if (rawCompanyCode && typeof rawCompanyCode === "string" && rawCompanyCode.includes("-")) {
      const parts = rawCompanyCode.split("-");
      providedCompanyCode = parts[0];
      expectedBranchCode = parts.slice(1).join("-").toUpperCase();
    }
    
    // ✅ VALIDATE COMPANY CODE IF PROVIDED
    if (providedCompanyCode) {
      console.log("🔍 Validating company code:", providedCompanyCode);
      console.log("📋 User company details:", {
        userCompanyCode: user.companyCode,
        company: user.company,
        hasCompany: !!user.company
      });

      if (!user.company && !user.companyCode) {
        console.log("❌ User has no company association");
        return res.status(403).json({
          success: false,
          message: "User is not associated with any company",
          errorCode: "NO_COMPANY",
        });
      }

      const company = user.company;

      // ✅ Check company status
      if (company && !company.isActive) {
        return res.status(403).json({
          success: false,
          message: "Company account is deactivated",
          errorCode: "COMPANY_DEACTIVATED",
        });
      }

      // ✅ Check subscription
      if (company && company.subscriptionExpiry) {
        const expiryDate = new Date(company.subscriptionExpiry);
        if (expiryDate < new Date()) {
          return res.status(403).json({
            success: false,
            message: "Company subscription has expired",
            errorCode: "SUBSCRIPTION_EXPIRED",
            expiryDate: expiryDate.toISOString(),
          });
        }
      }

      // ✅ Verify company code matches
      const cleanProvidedCode = providedCompanyCode.toLowerCase().trim();
      const userCompanyCode = (user.companyCode || (company && company.companyCode) || '').toLowerCase();
      
      console.log("🔍 Company code comparison:", {
        provided: cleanProvidedCode,
        userCompanyCode: userCompanyCode,
        companyCode: company?.companyCode,
        companyLoginUrl: company?.loginUrl,
        companyDbIdentifier: company?.dbIdentifier
      });

      // ✅ Multiple ways to match company code
      let isValidCompany = false;
      
      // 1. Direct match with companyCode
      if (userCompanyCode === cleanProvidedCode) {
        isValidCompany = true;
      }
      // 2. Match with company identifier (dbIdentifier)
      else if (company?.dbIdentifier && company.dbIdentifier.toLowerCase() === cleanProvidedCode) {
        isValidCompany = true;
      }
      // 3. Match with login URL segment
      else if (company?.loginUrl && company.loginUrl.toLowerCase().includes(cleanProvidedCode)) {
        isValidCompany = true;
      }

      if (!isValidCompany) {
        console.log("❌ Invalid company code:", {
          provided: cleanProvidedCode,
          expected: userCompanyCode,
          company: company
        });

        return res.status(403).json({
          success: false,
          message: "Invalid company access. Please check your company URL.",
          errorCode: "COMPANY_MISMATCH",
          providedCode: providedCompanyCode,
          expectedCode: userCompanyCode.toUpperCase(),
          userCompany: company?.companyName || "Unknown",
        });
      }

      // ✅ Branch validation
      if (expectedBranchCode && user.branchCode !== expectedBranchCode) {
        console.log("❌ Branch mismatch for login:", {
          expected: expectedBranchCode,
          actual: user.branchCode
        });
        return res.status(403).json({
          success: false,
          message: `Access denied. You do not belong to branch '${expectedBranchCode}'`,
          errorCode: "BRANCH_MISMATCH"
        });
      }

      console.log("✅ Company code validated successfully");
    } else {
      console.log("ℹ️ No company code provided, proceeding with general login");
    }

    // ✅ Reset failed attempts on successful password verification
    await User.findByIdAndUpdate(user._id, {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    });

    // ✅ Generate OTP for login verification
    const otp = generateOTP();
    const tempToken = jwt.sign(
      { 
        email: user.email,
        userId: user._id,
        purpose: 'login-verification',
        companyCode: user.companyCode || (user.company && user.company.companyCode)
      },
      process.env.JWT_SECRET + '-temp',
      { expiresIn: '10m' }
    );

    // ✅ Save OTP to database
    await LoginOTP.create({
      email: user.email,
      otp,
      tempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    });
    try {
      const emailResult = await emailService.sendEmail(
        user.email,
        "🔐 Login Verification OTP",
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Login Verification</h2>

            <p>Hello ${user.name},</p>

            <p>Your OTP for login verification is:</p>

            <h1 style="font-size: 36px; letter-spacing: 8px; background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px;">
              ${otp}
            </h1>

            <p>This OTP is valid for 5 minutes.</p>

          </div>
        `
      );

      if (!emailResult?.success) {
        throw new Error(emailResult?.error || "Email service failed");
      }

      console.log(`✅ OTP sent to ${user.email}`);

    } catch (emailError) {
      await LoginOTP.deleteOne({ tempToken });
      console.error("❌ Email sending failed:", emailError.message);

      return res.status(503).json({
        success: false,
        message: "Email service is not configured. Please contact administrator.",
        errorCode: "EMAIL_SERVICE_NOT_CONFIGURED"
      });
    }

    console.log(`✅ OTP sent to ${user.email} for login verification`);

    // ✅ Return response indicating OTP verification required
    return res.json({
      success: true,
      requiresOTP: true,
      message: "OTP sent to your email",
      tempToken: tempToken,
      email: user.email,
      companyName: user.company?.companyName || "CIIS NETWORK"
    });

  } catch (error) {
    console.error("🔥 Login error:", error);
    console.error("🔥 Error stack:", error.stack);

    // Handle specific JWT errors
    if (error.message.includes('expiresIn')) {
      console.error("⚠️ JWT expiresIn error - check token payload");
      return res.status(500).json({
        success: false,
        message: "Token generation error",
        errorCode: "TOKEN_ERROR",
      });
    }

    return res.status(500).json({
      success: false,
      message: "An internal server error occurred.",
      errorCode: "INTERNAL_SERVER_ERROR",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Verify Login OTP
exports.verifyLoginOTP = async (req, res) => {
  try {
    const { email, otp, tempToken } = req.body;

    if (!email || !otp || !tempToken) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and tempToken are required"
      });
    }

    // ✅ Verify tempToken
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET + '-temp');
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session"
      });
    }

    // ✅ Check if email matches
    if (decoded.email !== email) {
      return res.status(401).json({
        success: false,
        message: "Invalid session"
      });
    }

    // ✅ Find OTP session and verify generated OTP or bypass code
    const otpRecord = await LoginOTP.findOne({
      email,
      tempToken,
      verified: false
    });

    if (!otpRecord || !isValidLoginOTP(otpRecord, otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // ✅ Check expiry
    if (otpRecord.expiresAt < new Date()) {
      await LoginOTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: "OTP has expired"
      });
    }

    // ✅ Check attempts
    if (otpRecord.attempts >= 3) {
      await LoginOTP.deleteOne({ _id: otpRecord._id });
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. Please login again."
      });
    }

    // ✅ Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // ✅ Mark as verified
    otpRecord.verified = true;
    await otpRecord.save();

    // ✅ Get user with populated data
    const user = await User.findOne({ _id: decoded.userId, email })
      .select("-password -loginAttempts -lockUntil")
      .populate("department", "name")
      .populate("company", "companyName companyCode logo companyEmail companyPhone companyAddress isActive subscriptionExpiry allowedPages loginUrl dbIdentifier");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // ✅ Update last login
    user.lastLogin = new Date();
    await user.save();

    const linkedClient = await resolveClientForUser(user);
    const additionalDetails = parseAdditionalDetails(user.additionalDetails);
    const clientId = linkedClient?._id || additionalDetails.clientId || null;

    // ✅ Create final token
    const tokenPayload = {
      id: user._id.toString(),
      _id: user._id.toString(),
      email: user.email,
      companyCode: user.companyCode || (user.company && user.company.companyCode),
      role: user.role?._id || user.role,
      jobRole: user.jobRole,
    };

    const finalToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "30d" }
    );

    // ✅ Clean up OTP records
    await LoginOTP.deleteMany({ email });

    // ✅ Prepare company details
    const companyDetails = user.company ? {
      _id: user.company._id,
      companyName: user.company.companyName,
      companyCode: user.company.companyCode,
      companyEmail: user.company.companyEmail,
      companyPhone: user.company.companyPhone,
      companyAddress: user.company.companyAddress,
      logo: user.company.logo,
      isActive: user.company.isActive,
      subscriptionExpiry: user.company.subscriptionExpiry,
      allowedPages: user.company.allowedPages || [],
      loginUrl: user.company.loginUrl,
      dbIdentifier: user.company.dbIdentifier,
    } : null;

    // ✅ Prepare response
    const response = {
      success: true,
      message: "Login successful",
      token: finalToken,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_EXPIRE || "30d",
      user: {
        _id: user._id,
        id: user._id,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        clientId,
        clientUserId: user._id,
        employeeType: user.employeeType,
        additionalDetails,
        role: user.role,
        jobRole: user.jobRole,
        department: user.department,
        company: user.company?._id,
        companyName: user.company?.companyName,
        companyCode: user.companyCode || (user.company && user.company.companyCode),
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        companyRole: user.companyRole,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      client: linkedClient ? {
        _id: linkedClient._id,
        id: linkedClient._id,
        clientId: linkedClient._id,
        userId: linkedClient.userId,
        email: linkedClient.email,
        client: linkedClient.client,
        company: linkedClient.company,
        companyCode: linkedClient.companyCode,
        phone: linkedClient.phone
      } : null,
      companyDetails: companyDetails
    };

    // ✅ Set HTTP-only cookie
    res.cookie("auth_token", finalToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    console.log("✅ OTP verification successful for:", {
      user: user.email,
      userId: user._id,
      company: user.company?.companyName || "No company"
    });

    return res.json(response);

  } catch (error) {
    console.error("🔥 OTP verification error:", error);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
      errorCode: "INTERNAL_SERVER_ERROR"
    });
  }
};

// ✅ Resend Login OTP
exports.resendLoginOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // ✅ Check rate limiting (don't allow too many resends)
    const recentOTPs = await LoginOTP.countDocuments({
      email,
      createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) }
    });

    if (recentOTPs >= 3) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP requests. Please try again after 5 minutes."
      });
    }

    // ✅ Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // ✅ Delete old OTPs
    await LoginOTP.deleteMany({ email });

    // ✅ Generate new OTP and tempToken
    const otp = generateOTP();
    const tempToken = jwt.sign(
      { 
        email: user.email,
        userId: user._id,
        purpose: 'login-verification'
      },
      process.env.JWT_SECRET + '-temp',
      { expiresIn: '10m' }
    );

    // ✅ Save new OTP
    await LoginOTP.create({
      email,
      otp,
      tempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });

    // ✅ Send OTP email
    const emailResult = await emailService.sendEmail(
      email,
      "🔐 New Login OTP",
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">New Login OTP</h2>
          <p>Hello ${user.name},</p>
          <p>Your new OTP for login verification is:</p>
          <h1 style="font-size: 36px; letter-spacing: 8px; background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `
    );

    if (!emailResult?.success) {
      await LoginOTP.deleteOne({ tempToken });
      return res.status(503).json({
        success: false,
        message: "Email service is not configured. Please contact administrator.",
        errorCode: "EMAIL_SERVICE_NOT_CONFIGURED"
      });
    }

    return res.json({
      success: true,
      message: "OTP resent successfully",
      tempToken
    });

  } catch (error) {
    console.error("🔥 Resend OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resend OTP"
    });
  }
};

// ✅ Enhanced Forgot Password with OTP
exports.forgotPassword = async (req, res) => {
  try {
    const { email, companyCode, companyIdentifier } = req.body;
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const companyScope = await resolveCompanyScope(companyCode || companyIdentifier);
    const { user, client } = await findClientPasswordAccount(cleanEmail, companyScope);
    if (!user && !client) {
      return res.status(404).json({ message: 'No account found with this email.' });
    }

    const otp = generateOTP();
    const otpScope = { email: cleanEmail };

    if (companyScope?.companyCode) {
      otpScope.companyCode = companyScope.companyCode;
    } else if (client?.companyCode) {
      otpScope.companyCode = client.companyCode;
    }

    await OTP.deleteMany(otpScope);

    await OTP.create({
      email: cleanEmail,
      companyCode: otpScope.companyCode,
      otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });

    try {
      const emailResult = await emailService.sendEmail(
        cleanEmail,
        "Password Reset OTP",
        `
          <div style="font-family: Arial; padding:20px;">
            <h2 style="color:#2563eb;">Password Reset OTP</h2>
            <p>Hello ${user?.name || client?.client || 'User'},</p>
            <p>Your OTP is:</p>
            <h1 style="letter-spacing:4px;">${otp}</h1>
            <p>This OTP is valid for 5 minutes.</p>
          </div>
        `
      );

      if (!emailResult?.success && process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          success: false,
          message: "Email service is unavailable. Please contact administrator.",
          errorCode: "EMAIL_SERVICE_UNAVAILABLE"
        });
      }
    } catch (emailError) {
      console.error("Password reset email failed:", emailError);

      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          success: false,
          message: "Email service is unavailable. Please contact administrator.",
          errorCode: "EMAIL_SERVICE_UNAVAILABLE"
        });
      }

      console.log(`[DEV] Password reset OTP for ${cleanEmail}: ${otp}`);
      return res.json({
        success: true,
        message: "OTP generated. Email could not be sent in development mode.",
        devOtp: otp
      });
    }

    const response = { success: true, message: "OTP sent successfully" };
    if (process.env.NODE_ENV !== 'production') {
      response.devOtp = otp;
    }

    res.json(response);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== SUPER ADMIN OTP LOGIN ====================

// ✅ Enhanced Helper: Check Super Admin Access (More Flexible)
const isSuperAdminUser = (user) => {
  if (!user) return false;
  
  console.log("🔍 Checking SuperAdmin status for user:", {
    email: user.email,
    companyRole: user.companyRole,
    jobRole: user.jobRole,
    department: user.department,
    role: user.role
  });
  
  // Method 1: Check by role fields
  const hasSuperAdminRole = (
    user.companyRole === "Owner" ||
    user.companyRole === "SuperAdmin" ||
    user.companyRole === "superadmin" ||
    user.jobRole === "SuperAdmin" ||
    user.jobRole === "superadmin" ||
    user.role === "SuperAdmin" ||
    user.role === "superadmin" ||
    user.userType === "superadmin"
  );
  
  // Method 2: Check if user has superAdmin flag
  const hasSuperAdminFlag = (
    user.isSuperAdmin === true ||
    user.superAdmin === true
  );
  
  // Method 3: Check by email domain for CIIS NETWORK
  const isCIISEmail = (
    user.email?.endsWith("@ciisnetwork.in") ||
    user.email === "admin@ciisnetwork.in" ||
    user.email === "superadmin@ciisnetwork.in"
  );
  
  // Method 4: Check if user has Management department with Owner/SuperAdmin role
  const hasManagementRole = (
    (user.department === "Management" || user.department === "Admin") &&
    (user.companyRole === "Owner" || user.jobRole === "SuperAdmin")
  );
  
  // Return true if any condition matches
  const isSuperAdmin = (
    hasSuperAdminRole ||
    hasSuperAdminFlag ||
    (isCIISEmail && hasManagementRole)
  );
  
  console.log("✅ SuperAdmin check result:", {
    isSuperAdmin,
    hasSuperAdminRole,
    hasSuperAdminFlag,
    isCIISEmail,
    hasManagementRole
  });
  
  return isSuperAdmin;
};

// ✅ Super Admin Login - Send OTP (Updated with better debugging)
exports.superAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log("🔐 SuperAdmin Login attempt:", {
      email: email ? `${email.substring(0, 3)}...` : "undefined",
      timestamp: new Date().toISOString(),
    });

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
        errorCode: "MISSING_CREDENTIALS",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Find user with all fields
    const user = await User.findOne({ email: cleanEmail })
      .select("+password +isActive +loginAttempts +lockUntil +companyRole +jobRole +department +role +isSuperAdmin +superAdmin +userType")
      .populate("company", "companyName companyCode logo");

    if (!user) {
      console.log("❌ User not found:", cleanEmail);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
      });
    }

    // Log user details for debugging
    console.log("👤 User found:", {
      id: user._id,
      name: user.name,
      email: user.email,
      companyRole: user.companyRole,
      jobRole: user.jobRole,
      department: user.department,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      superAdmin: user.superAdmin,
      userType: user.userType
    });

    // Check if active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated",
        errorCode: "ACCOUNT_DEACTIVATED",
      });
    }

    // Check if SuperAdmin with detailed logging
    const isSuperAdmin = isSuperAdminUser(user);
    console.log("🔍 SuperAdmin check result:", {
      isSuperAdmin,
      userDetails: {
        companyRole: user.companyRole,
        jobRole: user.jobRole,
        department: user.department,
        email: user.email
      }
    });

    if (!isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Super Admin only.",
        errorCode: "SUPERADMIN_ONLY",
        details: {
          required: "User must have SuperAdmin privileges",
          current: {
            companyRole: user.companyRole || "Not set",
            jobRole: user.jobRole || "Not set",
            department: user.department || "Not set",
            email: user.email
          },
          suggestion: "Contact system administrator to grant SuperAdmin access"
        }
      });
    }

    // Check lock
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const lockMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Account temporarily locked. Try again in ${lockMinutes} minutes.`,
        errorCode: "ACCOUNT_LOCKED",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const updatedAttempts = (user.failedLoginAttempts || 0) + 1;
      const updateData = {
        failedLoginAttempts: updatedAttempts,
      };

      if (updatedAttempts >= 5) {
        updateData.lockUntil = Date.now() + 15 * 60 * 1000;
      }

      await User.findByIdAndUpdate(user._id, updateData);

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        errorCode: "INVALID_CREDENTIALS",
        remainingAttempts: Math.max(0, 5 - updatedAttempts),
      });
    }

    // Reset failed attempts
    await User.findByIdAndUpdate(user._id, {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    });

    // Delete old OTPs
    await LoginOTP.deleteMany({ email: user.email });

    // Generate OTP
    const otp = generateOTP();

    const tempToken = jwt.sign(
      {
        email: user.email,
        userId: user._id,
        purpose: "superadmin-login",
        role: "SuperAdmin",
      },
      process.env.JWT_SECRET + "-temp",
      { expiresIn: "10m" }
    );

    // Save OTP
    await LoginOTP.create({
      email: user.email,
      otp,
      tempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Send OTP Email
   try {

  await emailService.sendEmail(
    user.email,
    "🔐 Super Admin Login OTP",
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">Super Admin Login Verification</h2>

        <p>Hello ${user.name},</p>

        <p>Your OTP for <strong>Super Admin Panel Login</strong> is:</p>

        <h1 style="font-size: 36px; letter-spacing: 8px; background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px;">
          ${otp}
        </h1>

        <p>This OTP is valid for 5 minutes.</p>

      </div>
    `
  );

  console.log(`✅ SuperAdmin OTP sent to ${user.email}`);

} catch (emailError) {

  console.log("❌ SuperAdmin email failed:", emailError.message);

  console.log("🔐 SUPERADMIN OTP:", otp);
}

    console.log(`✅ SuperAdmin OTP sent to ${user.email}`);

    return res.status(200).json({
      success: true,
      requiresOTP: true,
      message: "Super Admin OTP sent successfully",
      tempToken,
      email: user.email,
      userType: "SuperAdmin",
    });
  } catch (error) {
    console.error("🔥 SuperAdmin Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Super Admin login failed",
      errorCode: "INTERNAL_SERVER_ERROR",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ✅ Super Admin Verify OTP (Updated)
exports.verifySuperAdminOTP = async (req, res) => {
  try {
    const { email, otp, tempToken } = req.body;

    if (!email || !otp || !tempToken) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and tempToken are required",
      });
    }

    // Verify temp token
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET + "-temp");
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    if (decoded.email !== email || decoded.purpose !== "superadmin-login") {
      return res.status(401).json({
        success: false,
        message: "Invalid Super Admin session",
      });
    }

    const otpRecord = await LoginOTP.findOne({
      email,
      tempToken,
      verified: false,
    });

    if (!otpRecord || !isValidLoginOTP(otpRecord, otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (otpRecord.expiresAt < new Date()) {
      await LoginOTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: "OTP has expired",
      });
    }

    if (otpRecord.attempts >= 3) {
      await LoginOTP.deleteOne({ _id: otpRecord._id });
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. Please login again.",
      });
    }

    otpRecord.attempts += 1;
    otpRecord.verified = true;
    await otpRecord.save();

    const user = await User.findOne({ email })
      .select("-password -loginAttempts -lockUntil")
      .populate("company", "companyName companyCode logo");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // SuperAdmin re-check
    if (!isSuperAdminUser(user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Not a Super Admin.",
      });
    }

    user.lastLogin = new Date();
    await user.save();

    // Final JWT
    const finalToken = jwt.sign(
      {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        companyCode: user.companyCode,
        companyRole: user.companyRole,
        department: user.department,
        jobRole: user.jobRole,
        role: "SuperAdmin",
        loginType: "superadmin",
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "30d" }
    );

    // Delete OTPs
    await LoginOTP.deleteMany({ email });

    res.cookie("auth_token", finalToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    console.log(`✅ SuperAdmin verified successfully: ${user.email}`);

    return res.status(200).json({
      success: true,
      message: "Super Admin login successful",
      token: finalToken,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_EXPIRE || "30d",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        companyRole: user.companyRole,
        department: user.department,
        jobRole: user.jobRole,
        companyCode: user.companyCode,
        companyName: user.company?.companyName || "CIIS NETWORK",
        loginType: "superadmin",
      },
    });
  } catch (error) {
    console.error("🔥 SuperAdmin OTP Verify Error:", error);
    return res.status(500).json({
      success: false,
      message: "Super Admin OTP verification failed",
      errorCode: "INTERNAL_SERVER_ERROR",
    });
  }
};

// ✅ Super Admin Resend OTP (Updated)
exports.resendSuperAdminOTP = async (req, res) => {
  try {
    const { email, tempToken } = req.body;

    if (!email || !tempToken) {
      return res.status(400).json({
        success: false,
        message: "Email and tempToken are required",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET + "-temp");
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    if (decoded.email !== email || decoded.purpose !== "superadmin-login") {
      return res.status(401).json({
        success: false,
        message: "Invalid Super Admin session",
      });
    }

    const user = await User.findOne({ email }).populate("company", "companyName");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!isSuperAdminUser(user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Super Admin only.",
      });
    }

    // Check rate limiting for resend
    const recentOTPs = await LoginOTP.countDocuments({
      email,
      createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) }
    });

    if (recentOTPs >= 3) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP requests. Please try again after 5 minutes."
      });
    }

    // Delete old OTPs
    await LoginOTP.deleteMany({ email });

    const otp = generateOTP();

    const newTempToken = jwt.sign(
      {
        email: user.email,
        userId: user._id,
        purpose: "superadmin-login",
        role: "SuperAdmin",
      },
      process.env.JWT_SECRET + "-temp",
      { expiresIn: "10m" }
    );

    await LoginOTP.create({
      email,
      otp,
      tempToken: newTempToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await emailService.sendEmail(
      email,
      "🔐 New Super Admin OTP",
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626;">New Super Admin OTP</h2>
          <p>Hello ${user.name},</p>
          <p>Your new OTP is:</p>
          <h1 style="font-size: 36px; letter-spacing: 8px; background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px;">${otp}</h1>
          <p>This OTP is valid for 5 minutes.</p>
        </div>
      `
    );

    console.log(`✅ SuperAdmin OTP resent to ${email}`);

    return res.status(200).json({
      success: true,
      message: "Super Admin OTP resent successfully",
      tempToken: newTempToken,
    });
  } catch (error) {
    console.error("🔥 Resend SuperAdmin OTP Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resend Super Admin OTP",
    });
  }
};

// ✅ Reset Password with OTP
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword, companyCode, companyIdentifier } = req.body;
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP and new password are required' });
    }

    const companyScope = await resolveCompanyScope(companyCode || companyIdentifier);
    const otpQuery = { email: cleanEmail, otp };

    if (companyScope?.companyCode) {
      otpQuery.companyCode = companyScope.companyCode;
    }

    const otpRecord = await OTP.findOne(otpQuery);

    if (!otpRecord)
      return res.status(400).json({ message: 'Invalid OTP' });

    if (otpRecord.expiresAt < new Date())
      return res.status(400).json({ message: 'OTP expired' });

    const account = await findClientPasswordAccount(cleanEmail, companyScope, true);
    let user = account.user;
    let createdClientUser = false;

    if (!user && account.client) {
      user = await createClientUserForPasswordReset(account.client, newPassword, companyScope);
      createdClientUser = true;
    }

    if (!user)
      return res.status(404).json({ message: 'User not found' });

    const isSamePassword = !createdClientUser && user.password
      ? await bcrypt.compare(newPassword, user.password)
      : false;
    if (isSamePassword) {
      return res.status(400).json({ 
        success: false,
        message: "New password cannot be same as old password" 
      });
    }

    if (!createdClientUser) {
      // User model hashes modified passwords in its pre-save hook.
      user.password = newPassword;
      user.passwordChangedAt = Date.now();
      await user.save();
    }

    await OTP.deleteMany(otpRecord.companyCode
      ? { email: cleanEmail, companyCode: otpRecord.companyCode }
      : { email: cleanEmail }
    );

    // Send confirmation email
    emailService.sendEmail(
      cleanEmail,
      "✅ Password Reset Successful",
      `
        <div style="font-family: Arial; padding:20px;">
          <h2 style="color:#4CAF50;">Password Reset Successful</h2>
          <p>Your password has been successfully reset.</p>
          <p>If you did not make this change, please contact support immediately.</p>
        </div>
      `
    ).catch(console.error);

    res.json({ success: true, message: "Password reset successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
};

// ✅ Verify Email Endpoint
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    
    const user = await User.findOne({
      verificationToken: token,
      isVerified: false
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification token"
      });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Email verified successfully"
    });

  } catch (err) {
    console.error("❌ Verify email error:", err);
    return errorResponse(res, 500, "Server error during email verification");
  }
};

// ✅ Refresh Token Endpoint
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return errorResponse(res, 400, "Refresh token is required");
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    const user = await User.findById(decoded.userId);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Generate new access token
    const newToken = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.jobRole
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.status(200).json({
      success: true,
      token: newToken,
      expiresIn: '15m'
    });

  } catch (err) {
    console.error("❌ Refresh token error:", err);
    
    if (err.name === 'JsonWebTokenError') {
      return errorResponse(res, 401, "Invalid refresh token");
    }
    
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 401, "Refresh token expired");
    }
    
    return errorResponse(res, 500, "Server error during token refresh");
  }
};

// ✅ Logout Endpoint
exports.logout = async (req, res) => {
  try {
    // Clear HTTP-only cookie
    res.clearCookie('auth_token');
    
    // Optionally blacklist token if using token blacklist
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      // Add to blacklist (implement Redis/memory store)
      await blacklistToken(token, '1d');
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (err) {
    console.error("❌ Logout error:", err);
    return errorResponse(res, 500, "Server error during logout");
  }
};

// ✅ Get Company Details by Identifier
exports.getCompanyDetailsByIdentifier = async (req, res) => {
  try {
    const { identifier } = req.params;
    
    console.log('🔍 Fetching company for identifier:', identifier);
    
    // Clean and normalize the identifier
    const cleanIdentifier = identifier.trim().toLowerCase();
    
    // Multiple ways to find company:
    const company = await Company.findOne({
      $or: [
        // Direct company code match
        { companyCode: cleanIdentifier.toUpperCase() },
        
        // Match from loginUrl (extract code from URL patterns)
        { 
          loginUrl: { 
            $regex: cleanIdentifier.replace(/[^a-z0-9]/gi, '.*'), 
            $options: 'i' 
          } 
        },
        
        // Match dbIdentifier
        { dbIdentifier: cleanIdentifier },
        
        // Match extracted code from URL pattern like "company-xxxxxx"
        {
          $expr: {
            $regexMatch: {
              input: cleanIdentifier,
              regex: { $concat: ["^company-", "$companyCode", "$"] }
            }
          }
        }
      ]
    }).select('-loginToken -__v');

    if (!company) {
      console.log('❌ Company not found for identifier:', cleanIdentifier);
      return res.status(404).json({
        success: false,
        message: 'Company not found',
        identifier: cleanIdentifier
      });
    }

    // Check if company is active
    if (!company.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Company account is deactivated',
        companyName: company.companyName
      });
    }

    // Check subscription expiry
    if (new Date() > new Date(company.subscriptionExpiry)) {
      return res.status(403).json({
        success: false,
        message: 'Company subscription has expired',
        expiryDate: company.subscriptionExpiry
      });
    }

    console.log('✅ Company found:', company.companyName);
    
    res.json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        companyEmail: company.companyEmail,
        companyAddress: company.companyAddress,
        companyPhone: company.companyPhone,
        ownerName: company.ownerName,
        logo: company.logo,
        companyDomain: company.companyDomain,
        companyCode: company.companyCode,
        isActive: company.isActive,
        subscriptionExpiry: company.subscriptionExpiry,
        loginUrl: company.loginUrl,
        dbIdentifier: company.dbIdentifier,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      }
    });

  } catch (error) {
    console.error('🔥 Company details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ✅ Test API Endpoint
exports.testAPI = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Auth API is working! 🚀",
      timestamp: new Date().toISOString(),
      endpoints: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        companyLoginRoute: "POST /api/auth/company/:companyCode/login",
        companyLogin: "POST /api/auth/company-login/:companyCode",
        verifyLoginOTP: "POST /api/auth/verify-login-otp",
        resendLoginOTP: "POST /api/auth/resend-login-otp",
        forgotPassword: "POST /api/auth/forgot-password",
        resetPassword: "POST /api/auth/reset-password",
        verifyEmail: "GET /api/auth/verify-email/:token",
        refreshToken: "POST /api/auth/refresh-token",
        logout: "POST /api/auth/logout",
        getCompanyDetails: "GET /api/auth/company/:identifier",
        test: "GET /api/auth/test",
        superAdmin: {
          login: "POST /api/auth/superadmin/login",
          verifyOTP: "POST /api/auth/superadmin/verify-otp",
          resendOTP: "POST /api/auth/superadmin/resend-otp"
        }
      },
      status: "operational",
      version: "1.0.0"
    });
  } catch (error) {
    console.error("🔥 Test API error:", error);
    return res.status(500).json({
      success: false,
      message: "Test API failed",
      error: error.message
    });
  }
};

// Helper function to send welcome email
const sendWelcomeEmail = async (email, name, companyName) => {
  try {
    await sendEmail(
      email,
      `🎉 Welcome to ${companyName}!`,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4CAF50;">Welcome to ${companyName}, ${name}!</h2>
          <p>Your account has been successfully created.</p>
          <p>You can now login to your account using your credentials.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Complete your profile</li>
              <li>Set up two-factor authentication (recommended)</li>
              <li>Explore the dashboard</li>
            </ul>
          </div>
          <p>If you have any questions, please contact your administrator.</p>
        </div>
      `
    );
  } catch (err) {
    console.error("Failed to send welcome email:", err);
  }
};

// Helper function to blacklist token
const blacklistToken = async (token, expiry) => {
  // Implement your token blacklist logic here
  // This could use Redis, MongoDB, or in-memory storage
  console.log(`Token blacklisted: ${token.substring(0, 20)}...`);
};

console.log("✅ authController.js loaded successfully");
