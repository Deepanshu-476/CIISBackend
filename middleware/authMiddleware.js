// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Single middleware for authentication
// exports.protect = async (req, res, next) => {
//   try {
//     let token;

//     // Check for token in headers
//     if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
//       token = req.headers.authorization.split(" ")[1];
//     }

//     if (!token) {
//       return res.status(401).json({
//         success: false,
//         message: "No token, authorization denied"
//       });
//     }

//     // Verify token
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     // Get user from token
//     const user = await User.findById(decoded.id).select('-password');
    
//     if (!user || !user.isActive) {
//       return res.status(401).json({
//         success: false,
//         message: "User not found or inactive"
//       });
//     }

//     req.user = user;
//     next();
//   } catch (err) {
//     if (err.name === 'TokenExpiredError') {
//       return res.status(401).json({
//         success: false,
//         message: "Token expired, please log in again"
//       });
//     }
//     console.error("Auth error:", err);
//     return res.status(401).json({
//       success: false,
//       message: "Not authorized to access this route"
//     });
//   }
// };

// Role-based authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }

    if (!roles.includes(req.user.jobRole)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.jobRole} is not authorized to access this route`
      });
    }

    next();
  };
};

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

    // Get user from token
    const user = await User.findById(decoded.id)
      .select('-password')
      .populate('department', 'name');

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
        department: user.department
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
    }
    
    if (!token) {
      return res.status(401).json({
        error: 'Not authorized to access this route'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await User.findById(decoded.id).select('+lastPasswordChange');
    
    if (!user) {
      return res.status(401).json({
        error: 'User not found'
      });
    }
    
    // Check if user changed password after token was issued
    if (user.lastPasswordChange) {
      const changedTimestamp = parseInt(
        user.lastPasswordChange.getTime() / 1000,
        10
      );
      
      if (decoded.iat < changedTimestamp) {
        return res.status(401).json({
          error: 'User recently changed password. Please login again.'
        });
      }
    }
    
    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Not authorized to access this route'
    });
  }
};

// Restrict to certain roles
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.jobRole.toLowerCase())) {
      return res.status(403).json({
        error: 'You do not have permission to perform this action'
      });
    }
    next();
  };
};

// Check if user is manager of department
exports.isManagerOfDepartment = async (req, res, next) => {
  try {
    if (req.user.jobRole.toLowerCase() !== 'manager') {
      return next();
    }
    
    // For manager-specific checks, add department validation here
    next();
  } catch (error) {
    return res.status(500).json({
      error: 'Server error'
    });
  }
};