// socket/handlers/connectionHandler.js
const User = require('../../../models/User');

const connectionHandler = (io, socket) => {
  console.log(`🔌 New client connected: ${socket.id} - User: ${socket.user?.name}`);

  // Join user to their personal room
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
    console.log(`📌 Joined room: user:${socket.userId}`);
  } else {
    console.log("❌ socket.userId missing");
  }
  console.log(`📌 Joined room: user:${socket.userId}`);

  // Join company room if user has company
  if (socket.companyId) {
    socket.join(`company:${socket.companyId}`);
    console.log(`📌 Joined company room: company:${socket.companyId}`);
  }

  // Join role-based rooms
  if (socket.user.companyRole === 'Owner' || socket.user.companyRole === 'Admin') {
    socket.join(`company:${socket.companyId}:admin`);
    console.log(`📌 Joined admin room: company:${socket.companyId}:admin`);
  }

  // Update user online status
  updateUserOnlineStatus(socket.userId, true);

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`🔌 Client disconnected: ${socket.id} - User: ${socket.user?.name}`);
    
    // Update user online status
    await updateUserOnlineStatus(socket.userId, false);
    
    // Leave all rooms
    socket.leave(`user:${socket.userId}`);
    if (socket.companyId) {
      socket.leave(`company:${socket.companyId}`);
      socket.leave(`company:${socket.companyId}:admin`);
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`❌ Socket error for user ${socket.userId}:`, error);
  });

  // Ping-pong for connection health
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ status: 'ok', timestamp: new Date() });
    }
  });
};

// Helper to update user online status
const updateUserOnlineStatus = async (userId, isOnline) => {
  try {
    await User.findByIdAndUpdate(userId, {
      isOnline,
      lastSeen: new Date()
    });
  } catch (error) {
    console.error('Error updating user status:', error);
  }
};

module.exports = connectionHandler;