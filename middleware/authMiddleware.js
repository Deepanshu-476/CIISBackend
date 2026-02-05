// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Token verification endpoint
exports.verify = async (req, res) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from token - WITHOUT role populate
    const user = await User.findById(decoded.id)
      .select('-password')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode logo');

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User not found or inactive"
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        jobRole: user.jobRole,
        department: user.department,
        company: user.company,
        companyCode: user.companyCode
      }
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired, please log in again"
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid token"
    });
  }
};

exports.protect = async (req, res, next) => {
  try {
    let token;
    
    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log("🟢 Token found in headers:", token ? "Yes" : "No");
    } else {
      console.log("🔴 No Authorization header found");
      return res.status(401).json({
        success: false,
        message: "Not authorized to access this route - No token"
      });
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized to access this route - No token"
      });
    }
    
    try {
      // Decode token first to check contents
      const decodedToken = jwt.decode(token);
      console.log("🔍 Decoded token payload:", decodedToken);
      
      if (!decodedToken) {
        return res.status(401).json({
          success: false,
          message: "Invalid token"
        });
      }
      
      // Get user ID from token (use id or _id field)
      const userId = decodedToken.id || decodedToken._id;
      
      if (!userId) {
        console.log("❌ No user ID found in token");
        return res.status(401).json({
          success: false,
          message: "Invalid token - No user ID"
        });
      }
      
      console.log("✅ User ID extracted from token:", userId);
      
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("✅ Token verified successfully");
      
      // Find user WITHOUT role populate (since role field doesn't exist)
      const user = await User.findById(userId)
        .select('+lastPasswordChange')
        .populate('company', 'companyName companyCode logo isActive')
        .populate('department', 'name');
        // ❌ REMOVED: .populate('role', 'name permissions')
      
      if (!user) {
        console.log("❌ User not found in database for ID:", userId);
        return res.status(401).json({
          success: false,
          message: "User not found"
        });
      }
      
      console.log("✅ User found in database:", {
        id: user._id,
        name: user.name,
        email: user.email,
        jobRole: user.jobRole,
        company: user.company?.companyName,
        companyCode: user.companyCode,
        department: user.department?.name
      });
      
      // Check if user is active
      if (!user.isActive) {
        console.log("❌ User account is inactive");
        return res.status(401).json({
          success: false,
          message: "User account is deactivated"
        });
      }
      
      // Check if company is active
      if (user.company && !user.company.isActive) {
        console.log("❌ Company account is inactive");
        return res.status(401).json({
          success: false,
          message: "Company account is deactivated"
        });
      }
      
      // Check if user changed password after token was issued
      if (user.lastPasswordChange && decoded.iat) {
        const changedTimestamp = parseInt(
          user.lastPasswordChange.getTime() / 1000,
          10
        );
        
        if (decoded.iat < changedTimestamp) {
          console.log("🔒 Password changed after token issued");
          return res.status(401).json({
            success: false,
            message: "User recently changed password. Please login again."
          });
        }
      }
      
      // Attach user to request object
      req.user = {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        jobRole: user.jobRole,
        employeeId: user.employeeId,
        phone: user.phone,
        department: user.department,
        departmentName: user.department?.name,
        company: user.company,
        companyName: user.company?.companyName,
        companyCode: user.companyCode || (user.company && user.company.companyCode),
        companyLogo: user.company?.logo,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      };
      
      console.log("📋 req.user object attached successfully");
      next();
      
    } catch (error) {
      console.error("❌ Auth middleware error:", error.message);
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: "Invalid token"
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: "Token expired, please login again"
        });
      }
      
      if (error.name === 'StrictPopulateError') {
        console.error("⚠️ Role populate error - User model doesn't have role field");
        // Continue without role field
        // You can retry without role populate or handle differently
      }
      
      return res.status(401).json({
        success: false,
        message: "Not authorized to access this route"
      });
    }
    
  } catch (error) {
    console.error("❌ Protect middleware error:", error.message);
    
    return res.status(500).json({
      success: false,
      message: "Server error in authentication"
    });
  }
};

// Role-based authorization (using jobRole instead of role)
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }

    // Use jobRole since role field doesn't exist
    const userRole = req.user.jobRole;
    
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "User role not defined"
      });
    }
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `User role ${userRole} is not authorized to access this route`
      });
    }

    next();
  };
};

// Restrict to certain roles (using jobRole)
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }
    
    // Use jobRole since role field doesn't exist
    const userRole = (req.user.jobRole || '').toLowerCase();
    const allowedRoles = roles.map(role => role.toLowerCase());
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action'
      });
    }
    next();
  };
};

// Check if user is manager of department
exports.isManagerOfDepartment = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }
    
    const userRole = (req.user.jobRole || '').toLowerCase();
    
    if (userRole !== 'manager') {
      return next();
    }
    
    // For manager-specific checks
    if (req.params.departmentId && req.user.department) {
      if (req.params.departmentId.toString() !== req.user.department._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "You can only manage your own department"
        });
      }
    }
    
    next();
  } catch (error) {
    console.error("isManagerOfDepartment error:", error);
    return res.status(500).json({
      success: false,
      error: 'Server error in manager validation'
    });
  }
};

// Company-specific middleware
exports.sameCompany = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Not authorized"
    });
  }
  
  if (req.params.companyCode && req.user.companyCode) {
    if (req.params.companyCode !== req.user.companyCode) {
      return res.status(403).json({
        success: false,
        message: "Access denied to different company data"
      });
    }
  }
  
  next();
};

// Simple debug middleware
exports.debugRequest = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
};