
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const parseCookieToken = (cookieHeader = '') => {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(part => {
      const idx = part.indexOf('=');
      if (idx === -1) return ['', ''];
      return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
    })
  );
  return cookies.access_token || cookies.auth_token || cookies.token || null;
};

const authSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || 
                  socket.handshake.headers?.authorization?.split(' ')[1] ||
                  parseCookieToken(socket.handshake.headers?.cookie);
    
    if (!token) { 
      void 0;
      return next(new Error('Authentication token required'));
    }
   
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    
    const user = await User.findById(decoded.id || decoded._id)
      .select('-password')
      .populate('company', 'isActive companyCode');
    
    if (!user) {
      return next(new Error('User not found'));
    }

    if (!user.isActive) {
      return next(new Error('User account is deactivated'));
    }

    if (user.company && !user.company.isActive) {
      return next(new Error('Company account is deactivated'));
    }

    socket.user = user;
    socket.userId = user._id.toString();
    socket.companyId = user.company?._id?.toString() || user.company?.toString() || user.companyId?.toString();
    next();
  } catch (error) {
    console.error('❌ Socket auth error:', error.message);
    next(new Error('Authentication failed'));
  }
};

module.exports = authSocket; 