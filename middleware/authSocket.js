// socket/middleware/authSocket.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || 
                  socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
      console.log('❌ Socket auth: No token provided');
      return next(new Error('Authentication token required'));
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      console.log('❌ Socket auth: User not found');
      return next(new Error('User not found'));
    }

    // Attach user to socket
    socket.user = user;
    socket.userId = user._id.toString();
    socket.companyId = user.company?.toString() || user.companyId?.toString();

    console.log(`✅ Socket authenticated: ${user.name} (${user._id})`);
    
    next();
  } catch (error) {
    console.error('❌ Socket auth error:', error.message);
    next(new Error('Authentication failed'));
  }
};

module.exports = authSocket;