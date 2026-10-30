const jwt = require('jsonwebtoken');
const User = require('../../models/User');

// Chat and client-task routes run this on every request (chat polls often). The user is loaded lean and
// kept for a few seconds; each request gets its own hydrated document, so handlers still see a Mongoose
// document and cannot affect each other. Cleared by server.js after user/company writes.
const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS ?? 10000);
const authCache = new Map();

const loadUser = async userId => {
  const key = String(userId);
  const hit = authCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.json;
  const user = await User.findById(userId)
    .select('-password -resetToken -resetTokenExpiry')
    .populate('company', 'isActive companyCode')
    .lean();
  if (!user) {
    authCache.delete(key);
    return null;
  }
  const json = JSON.stringify(user);
  if (AUTH_CACHE_TTL_MS > 0) {
    if (authCache.size >= 5000) authCache.delete(authCache.keys().next().value);
    authCache.set(key, { json, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  }
  return json;
};

const authMiddleware = async (req, res, next) => {
  try {
    const token =
      req.header('Authorization')?.replace('Bearer ', '') ||
      req.cookies?.access_token ||
      req.cookies?.auth_token ||
      req.cookies?.token;
    
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
    const cachedJson = await loadUser(decoded.id || decoded._id);
    const user = cachedJson ? User.hydrate(JSON.parse(cachedJson), null, { hydratedPopulatedDocs: true }) : null;
    
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
module.exports.invalidateChatAuthUser = userId => (userId ? authCache.delete(String(userId)) : authCache.clear());
