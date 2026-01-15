const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authorization token missing or malformed",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId =
      decoded._id ||
      decoded.id ||
      decoded.userId ||
      (decoded.user && decoded.user._id) ||
      (decoded.user && decoded.user.id);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token structure",
      });
    }

    req.user = {
      ...decoded,
      _id: userId.toString(),
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};
exports.protect = async (req, res, next) => {
  try {
    console.log("Protect middleware triggered"); 
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token, authorization denied"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from token
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User not found or inactive"
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired, please log in again"
      });
    }
    console.error("Auth error:", err);
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route"
    });
  }
};
exports.authorize = (...roles) => {
  return (req, res, next) => {
    console.log("Authorize middleware triggered with roles:", roles); // Log the roles and check if this function is triggered
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
exports.verify = async (req, res) => {
  try {
    console.log("Verify middleware triggered"); // Log to check if the function is triggered
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

module.exports = auth;
