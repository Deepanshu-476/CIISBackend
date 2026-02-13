const User = require("../models/User");
const Company = require("../models/Company");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");
const Department = require("../models/Department");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { validateRequest } = require("../middleware/validation");
const { loginSchema } = require("../validations/authValidation");

// Rate limiting store for brute force protection
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

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
    const cleanCompanyCode = companyCode.toLowerCase().trim();

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
    const user = await User.findOne({
      email: cleanEmail,
      $or: [
        { companyCode: company.companyCode },
        { company: company._id }
      ]
    })
      .select("+password +isActive +failedLoginAttempts +lockUntil")
      .populate("department", "name")
      .populate("company", "companyName companyCode logo")
      .lean();

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

    // ✅ Get user with populated data for response
    const userForResponse = await User.findById(user._id)
      .select("-password -failedLoginAttempts -lockUntil")
      .populate("department", "name")
      .populate("company", "companyName companyCode logo")
      .lean();

    // ✅ Create token payload
    const tokenPayload = {
      id: user._id.toString(),
      _id: user._id.toString(),
      companyRole: user.companyRole,
      email: user.email,
      companyCode: company.companyCode,
      role: user.role?._id || user.role,
      jobRole: user.jobRole,
      iat: Math.floor(Date.now() / 1000),
    };

    console.log("🔐 Company login token payload:", tokenPayload);

    // ✅ Create token
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || "your-secret-key",
      {
        expiresIn: process.env.JWT_EXPIRE || "30d",
      }
    );

    // ✅ Decode token to get actual expiration
    const decodedToken = jwt.decode(token);
    const tokenExpiry = decodedToken.exp;
    
    console.log("🔐 Company login token created. Expires at:", new Date(tokenExpiry * 1000).toISOString());

    // ✅ Prepare response
    const response = {
      success: true,
      message: "Company login successful",
      token,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_EXPIRE || "30d",
      expiresAt: new Date(tokenExpiry * 1000).toISOString(),
      user: {
        _id: userForResponse._id,
        employeeId: userForResponse.employeeId,
        name: userForResponse.name,
        email: userForResponse.email,
        phone: userForResponse.phone,
        role: userForResponse.role,
        jobRole: userForResponse.jobRole,
        department: userForResponse.department,
        company: userForResponse.company?._id,
        companyName: userForResponse.company?.companyName,
        companyCode: userForResponse.company?.companyCode,
        isActive: userForResponse.isActive,
        lastLogin: new Date(),
        createdAt: userForResponse.createdAt,
        updatedAt: userForResponse.updatedAt
      },
      companyDetails: {
        _id: company._id,
        companyName: company.companyName,
        companyCode: company.companyCode,
        companyEmail: company.companyEmail,
        companyPhone: company.companyPhone,
        companyAddress: company.companyAddress,
        logo: company.logo,
        dbIdentifier: company.dbIdentifier,
        loginUrl: company.loginUrl,
        isActive: company.isActive,
        subscriptionExpiry: company.subscriptionExpiry,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      },
      metadata: {
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        companyCode: company.companyCode,
      },
    };

    // ✅ Set HTTP-only cookie
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    console.log("✅ Company login successful:", {
      user: user.email,
      company: company.companyName,
      companyCode: company.companyCode
    });
    
    return res.json(response);
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

    // Generate employee ID
    const employeeId = `EMP${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user in session
    const user = await User.create([{
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      department,
      jobRole,
      company,
      companyCode,
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

// ✅ Enhanced Login with rate limiting
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
      .select("+password +isActive +failedLoginAttempts +lockUntil")
      .populate("department", "name")
      .populate("company", "companyName companyCode isActive subscriptionExpiry logo companyEmail companyPhone companyAddress dbIdentifier loginUrl")
      .lean();

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
    const providedCompanyCode = companyCode || companyIdentifier;
    
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

      console.log("✅ Company code validated successfully");
    } else {
      console.log("ℹ️ No company code provided, proceeding with general login");
    }

    // ✅ Reset failed attempts on successful login
    await User.findByIdAndUpdate(user._id, {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLogin: new Date(),
      },
    });

    // ✅ Get user with populated data for response
    const userForResponse = await User.findById(user._id)
      .select("-password -failedLoginAttempts -lockUntil")
      .populate("department", "name")
      .populate("company", "companyName companyCode logo")
      .lean();

    // ✅ Create token payload WITHOUT exp field (let jwt handle it)
    const tokenPayload = {
      id: user._id.toString(), // ✅ CRITICAL: यह field authMiddleware में use होता है
      _id: user._id.toString(), // ✅ Backup field
      email: user.email,
      companyCode: user.companyCode || (user.company && user.company.companyCode),
      role: user.role?._id || user.role,
      jobRole: user.jobRole,
      iat: Math.floor(Date.now() / 1000),
      // ❌ REMOVE exp field from here
    };

    console.log("🔐 Token payload:", tokenPayload);

    // ✅ Create token - let jwt add the exp field automatically
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || "your-secret-key",
      {
        expiresIn: process.env.JWT_EXPIRE || "30d",
      }
    );

    // ✅ Decode token to get actual expiration
    const decodedToken = jwt.decode(token);
    const tokenExpiry = decodedToken.exp;
    
    console.log("🔐 Token created successfully. Expires at:", new Date(tokenExpiry * 1000).toISOString());

    // ✅ Prepare company details for response
    const companyDetails = user.company ? {
      _id: user.company._id,
      companyName: user.company.companyName,
      companyCode: user.company.companyCode,
      companyEmail: user.company.companyEmail,
      companyPhone: user.company.companyPhone,
      companyAddress: user.company.companyAddress,
      logo: user.company.logo,
      
      dbIdentifier: user.company.dbIdentifier,
      loginUrl: user.company.loginUrl,
      isActive: user.company.isActive,
      subscriptionExpiry: user.company.subscriptionExpiry,
      createdAt: user.company.createdAt,
      updatedAt: user.company.updatedAt
    } : null;

    // ✅ Prepare response
    const response = {
      success: true,
      message: "Login successful",
      token,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_EXPIRE || "30d",
      expiresAt: new Date(tokenExpiry * 1000).toISOString(),
      user: {
        _id: userForResponse._id,
        employeeId: userForResponse.employeeId,
        name: userForResponse.name,
        email: userForResponse.email,
        phone: userForResponse.phone,
        role: userForResponse.role,
        jobRole: userForResponse.jobRole,
        department: userForResponse.department,
        company: userForResponse.company?._id,
        companyName: userForResponse.company?.companyName,
        companyCode: userForResponse.companyCode || (userForResponse.company && userForResponse.company.companyCode),
        isActive: userForResponse.isActive,
        lastLogin: new Date(),
        companyRole: userForResponse.companyRole,
        createdAt: userForResponse.createdAt,
        updatedAt: userForResponse.updatedAt
      },
      companyDetails: companyDetails,
      metadata: {
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        companyCode: providedCompanyCode || "general",
      },
    };

    // ✅ Set HTTP-only cookie
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (matches token expiry)
    });

    console.log("✅ Login successful for:", {
      user: user.email,
      userId: user._id,
      company: user.company?.companyName || "No company",
      companyCode: user.companyCode
    });
    
    return res.json(response);
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

// ✅ Enhanced Forgot Password with token expiry
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return errorResponse(res, 400, "Please provide a valid email address");
    }

    const user = await User.findOne({ email: cleanEmail });
    
    if (!user) {
      // For security, don't reveal if email exists
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, a reset link has been sent"
      });
    }

    // Generate reset token with expiry
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour
    
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(cleanEmail)}`;

    // Send email
    await sendEmail(
      cleanEmail,
      "🔐 Password Reset Request",
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>You requested a password reset for your account.</p>
          <p>Click the button below to reset your password (link expires in 1 hour):</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #4CAF50; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; font-weight: bold;">
              Reset Password
            </a>
          </div>
          <p>If you didn't request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `
    );

    return res.status(200).json({
      success: true,
      message: "If an account exists with this email, a reset link has been sent"
    });

  } catch (err) {
    console.error("❌ Forgot password error:", err);
    return errorResponse(res, 500, "Server error during password reset request");
  }
};

// ✅ Enhanced Reset Password with token validation
exports.resetPassword = async (req, res) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return errorResponse(res, 400, "All fields are required");
    }

    if (password.length < 8) {
      return errorResponse(res, 400, "Password must be at least 8 characters");
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return errorResponse(res, 400, "Invalid or expired reset token");
    }

    // Check if new password is same as old
    const isSamePassword = await bcrypt.compare(password, user.password);
    if (isSamePassword) {
      return errorResponse(res, 400, "New password cannot be same as old password");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.passwordChangedAt = Date.now();
    
    await user.save();

    // Send confirmation email
    sendEmail(
      user.email,
      "✅ Password Reset Successful",
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4CAF50;">Password Reset Successful</h2>
          <p>Your password has been successfully reset.</p>
          <p>If you did not make this change, please contact support immediately.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            For security reasons, we recommend you regularly update your password.
          </p>
        </div>
      `
    ).catch(console.error);

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully"
    });

  } catch (err) {
    console.error("❌ Reset password error:", err);
    return errorResponse(res, 500, "Server error during password reset");
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
        forgotPassword: "POST /api/auth/forgot-password",
        resetPassword: "POST /api/auth/reset-password",
        verifyEmail: "GET /api/auth/verify-email/:token",
        refreshToken: "POST /api/auth/refresh-token",
        logout: "POST /api/auth/logout",
        getCompanyDetails: "GET /api/auth/company/:identifier",
        test: "GET /api/auth/test"
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