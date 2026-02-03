const User = require("../models/User");
const Company = require("../models/Company");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");
const Department = require("../models/Department");
const crypto = require("crypto");
const mongoose = require("mongoose");
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

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate employee ID
    const employeeId = `EMP${Date.now()}${Math.floor(Math.random() * 1000)}`;

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
  const { email, password, companyIdentifier } = req.body;
  
  try {
    console.log('🔐 Login attempt:', { 
      email: email ? `${email.substring(0, 3)}...` : 'undefined',
      companyIdentifier,
      timestamp: new Date().toISOString()
    });

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
        errorCode: 'MISSING_CREDENTIALS'
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Find user
    const user = await User.findOne({ email: cleanEmail })
      .select('+password +isActive +failedLoginAttempts +lockUntil')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode isActive subscriptionExpiry logo')
      .lean();

    if (!user) {
      console.log('❌ User not found:', cleanEmail);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        errorCode: 'INVALID_CREDENTIALS'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact your administrator.',
        errorCode: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Check account lock
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const lockMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Account temporarily locked. Try again in ${lockMinutes} minutes.`,
        errorCode: 'ACCOUNT_LOCKED'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      // Update failed attempts
      await User.findByIdAndUpdate(user._id, {
        $inc: { failedLoginAttempts: 1 },
        ...(user.failedLoginAttempts >= 4 && { lockUntil: Date.now() + 15 * 60 * 1000 })
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        errorCode: 'INVALID_CREDENTIALS',
        remainingAttempts: Math.max(0, 5 - (user.failedLoginAttempts + 1))
      });
    }

    // ✅ VALIDATE COMPANY IDENTIFIER IF PROVIDED
    if (companyIdentifier) {
      console.log('🔍 Validating company identifier:', companyIdentifier);
      
      if (!user.company) {
        return res.status(403).json({
          success: false,
          message: 'User is not associated with any company',
          errorCode: 'NO_COMPANY'
        });
      }

      const company = user.company;
      
      // Check company status
      if (!company.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Company account is deactivated',
          errorCode: 'COMPANY_DEACTIVATED'
        });
      }

      // Check subscription
      const expiryDate = new Date(company.subscriptionExpiry);
      if (expiryDate < new Date()) {
        return res.status(403).json({
          success: false,
          message: 'Company subscription has expired',
          errorCode: 'SUBSCRIPTION_EXPIRED',
          expiryDate: expiryDate.toISOString()
        });
      }

      // Verify company identifier matches
      const cleanCompanyIdentifier = companyIdentifier.toLowerCase().trim();
      const companyCodeLower = company.companyCode.toLowerCase();
      const userCompanyCodeLower = user.companyCode.toLowerCase();
      
      // Check multiple possible matches
      const isValidIdentifier = 
        cleanCompanyIdentifier === companyCodeLower ||
        cleanCompanyIdentifier === userCompanyCodeLower ||
        cleanCompanyIdentifier === `company-${companyCodeLower}` ||
        cleanCompanyIdentifier === company.dbIdentifier?.toLowerCase() ||
        company.loginUrl?.toLowerCase().includes(cleanCompanyIdentifier);

      if (!isValidIdentifier) {
        console.log('❌ Invalid company identifier:', {
          provided: cleanCompanyIdentifier,
          companyCode: company.companyCode,
          userCompanyCode: user.companyCode
        });
        
        return res.status(403).json({
          success: false,
          message: 'Invalid company access',
          errorCode: 'INVALID_COMPANY_ACCESS',
          providedIdentifier: cleanCompanyIdentifier,
          expectedIdentifier: company.companyCode
        });
      }

      console.log('✅ Company identifier validated successfully');
    }

    // Reset failed attempts on successful login
    await User.findByIdAndUpdate(user._id, {
      $set: { 
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLogin: new Date()
      }
    });

    // Generate JWT token
    const tokenPayload = {
      userId: user._id,
      email: user.email,
      role: user.jobRole,
      companyId: user.company?._id,
      companyCode: user.companyCode,
      employeeId: user.employeeId
    };

    const tokenExpiry = '24h';
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: tokenExpiry }
    );

    // Prepare response
    const response = {
      success: true,
      message: 'Login successful',
      token,
      tokenType: 'Bearer',
      expiresIn: tokenExpiry,
      user: {
        _id: user._id,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.jobRole,
        department: user.department,
        company: user.company,
        companyCode: user.companyCode,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      },
      metadata: {
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        companyIdentifier: companyIdentifier || 'general'
      }
    };

    // Set HTTP-only cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    console.log('✅ Login successful for:', user.email);
    return res.json(response);

  } catch (error) {
    console.error('🔥 Login error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'An internal server error occurred.',
      errorCode: 'INTERNAL_SERVER_ERROR'
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
// Helper function to blacklist token
const blacklistToken = async (token, expiry) => {
  // Implement token blacklist logic here
  // Could use Redis, MongoDB, or in-memory store
  // Example with Redis:
  // await redis.set(`blacklist:${token}`, '1', 'EX', expiry);
};