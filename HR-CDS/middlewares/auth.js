const jwt = require('jsonwebtoken');
const User = require('../../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'Authentication secret is not configured'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id || decoded._id)
      .select('-password')
      .populate('company', 'isActive companyCode');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }

    if (user.company && !user.company.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Company account is deactivated'
      });
    }

    req.user = user;
    req.token = token;
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Please authenticate'
    });
  }
};

module.exports = authMiddleware;
