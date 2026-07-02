
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || 
                  socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
      void 0;
      return next(new Error('Authentication token required'));
    }
  
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      void 0;
      return next(new Error('User not found'));
    }

    
    socket.user = user;
    socket.userId = user._id.toString();
    socket.companyId = user.company?.toString() || user.companyId?.toString();

    void 0;
    
    next();
  } catch (error) {
    console.error('❌ Socket auth error:', error.message);
    next(new Error('Authentication failed'));
  }
};

module.exports = authSocket; 