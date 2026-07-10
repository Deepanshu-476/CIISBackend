
const jwt = require("jsonwebtoken");
const User = require("../models/User");


exports.verify = async (req, res) => {
  try {
    let token;

    
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }
 
    if (!token) {
      return res.status(401).json({    
        success: false,
        message: "No token provided"
      });
    } 

    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    
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
    
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      
    } else {
      void 0;
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
      
      const decodedToken = jwt.decode(token);
      
      
      if (!decodedToken) {
        return res.status(401).json({
          success: false,
          message: "Invalid token"
        });
      }
      
      
      const userId = decodedToken.id || decodedToken._id;
      
      if (!userId) {
        void 0;
        return res.status(401).json({
          success: false,
          message: "Invalid token - No user ID"
        });
      }
      
      
      
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      
      
      const user = await User.findById(userId)
        .select('+lastPasswordChange')
        .populate('company', 'companyName companyCode logo isActive')
        .populate('department', 'name');
        
      
      if (!user) {
        void 0;
        return res.status(401).json({
          success: false,
          message: "User not found"
        });
      }
      
      
      
      
      
      
      
      
      
      
      
      
      if (!user.isActive) {
        void 0;
        return res.status(401).json({
          success: false,
          message: "User account is deactivated"
        });
      }
      
      
      if (user.company && !user.company.isActive) {
        void 0;
        return res.status(401).json({
          success: false,
          message: "Company account is deactivated"
        });
      }
      
      
      if (user.lastPasswordChange && decoded.iat) {
        const changedTimestamp = parseInt(
          user.lastPasswordChange.getTime() / 1000,
          10
        );
        
        if (decoded.iat < changedTimestamp) {
          void 0;
          return res.status(401).json({
            success: false,
            message: "User recently changed password. Please login again."
          });
        }
      }
      
      
      req.user = {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.companyRole || user.jobRole,
        jobRole: user.jobRole,
        companyRole: user.companyRole,
        employeeId: user.employeeId,
        phone: user.phone,
        branch: user.branch,
        branchCode: user.branchCode,
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

exports.isCompanyOwner = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized - User not found"
      });
    }

    
    const user = await User.findById(req.user._id)
      .select('companyRole company companyCode email name')
      .populate('company', 'companyName companyCode isActive');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found"
      });
    }

    
    const userCompanyRole = (user.companyRole || '').toLowerCase();
    if (userCompanyRole !== 'owner') {
      void 0;
      return res.status(403).json({
        success: false,
        message: "Access denied. Company owner privileges required."
      });
    }

    
    
    const userCompanyId = user.company?._id?.toString() || user.companyCode;
    
    
    let targetCompanyId = req.params.companyId || req.params.companyCode;
    
    
    if (!targetCompanyId) {
      targetCompanyId = userCompanyId;
    }

    
    if (targetCompanyId !== userCompanyId) {
      void 0;
      return res.status(403).json({
        success: false,
        message: "You can only manage your own company"
      });
    }

    
    if (user.company && !user.company.isActive) {
      return res.status(403).json({
        success: false,
        message: "Company account is deactivated"
      });
    }

    
    req.user.companyRole = user.companyRole;
    req.user.isCompanyOwner = true;
    req.user.companyDetails = user.company;
    
    void 0;
    
    next();
    
  } catch (error) {
    console.error("❌ isCompanyOwner middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error in owner validation"
    });
  }
};


exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }

    
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


exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized"
      });
    }
    
    
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


exports.debugRequest = (req, res, next) => {
  void 0;
  next();
};
