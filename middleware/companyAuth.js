// controllers/companyAuthController.js
const Company = require("../models/Company");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Company-specific login
exports.companyLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const company = req.company; // From middleware

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user in this specific company
    const user = await User.findOne({
      email: email.toLowerCase(),
      company: company._id,
      isActive: true,
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials or user not in this company",
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Generate company-specific token
    const token = jwt.sign(
      {
        id: user._id,
        companyId: company._id,
        companyCode: company.companyCode,
        jobRole: user.jobRole,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    // Update user without password
    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: userWithoutPassword,
      company: {
        id: company._id,
        name: company.companyName,
        code: company.companyCode,
        logo: company.logo,
      },
    });
  } catch (err) {
    console.error("❌ Company login error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};

// Register user in specific company
exports.companyRegister = async (req, res) => {
  try {
    const company = req.company;
    const userData = req.body;
    const createdBy = req.user?.id;

    // Validate email domain (optional)
    if (company.companyDomain) {
      const userDomain = userData.email.split("@")[1];
      if (userDomain !== company.companyDomain) {
        return res.status(400).json({
          success: false,
          message: `Email must be from company domain: ${company.companyDomain}`,
        });
      }
    }

    // Check if user already exists in this company
    const existingUser = await User.findOne({
      email: userData.email.toLowerCase(),
      company: company._id,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists in this company",
      });
    }

    // Create user with company reference
    const user = await User.create({
      ...userData,
      company: company._id,
      companyCode: company.companyCode,
      email: userData.email.toLowerCase(),
      createdBy: createdBy || null,
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully in company",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        jobRole: user.jobRole,
        company: company.companyName,
      },
    });
  } catch (err) {
    console.error("❌ Company register error:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "User already exists in this company",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to register user",
    });
  }
};

// Get company profile
exports.getCompanyProfile = async (req, res) => {
  try {
    const company = req.company;
    const user = req.user;

    // Count active users in this company
    const userCount = await User.countDocuments({
      company: company._id,
      isActive: true,
    });

    return res.status(200).json({
      success: true,
      company: {
        id: company._id,
        name: company.companyName,
        email: company.companyEmail,
        phone: company.companyPhone,
        address: company.companyAddress,
        logo: company.logo,
        ownerName: company.ownerName,
        code: company.companyCode,
        domain: company.companyDomain,
        totalUsers: userCount,
        maxUsers: company.maxEmployees,
        subscriptionPlan: company.subscriptionPlan,
        subscriptionExpiry: company.subscriptionExpiry,
        settings: company.settings,
      },
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        jobRole: user.jobRole,
      },
    });
  } catch (err) {
    console.error("❌ Get company profile error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company profile",
    });
  }
};
// ✅ Middleware: Check Company Access
exports.checkCompanyAccess = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }

    if (!req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: "Company access denied"
      });
    }

    next();
  } catch (error) {
    console.error("❌ Company access middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error in company access middleware"
    });
  }
};
module.exports = function (req, res, next) {
  if (!req.user || !req.user.companyCode) {
    return res.status(403).json({
      success: false,
      message: "Company access denied"
    });
  }
  next();
};