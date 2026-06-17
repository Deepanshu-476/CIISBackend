// socket/handlers/connectionHandler.js
const User = require('../../../models/User');

const getCompanyOnlineUsers = (io, companyId) => {
  if (!companyId) return [];

  const companyKey = companyId.toString();
  const userIds = new Set();

  io.sockets.sockets.forEach((connectedSocket) => {
    if (connectedSocket.companyId?.toString() !== companyKey) return;
    if (!connectedSocket.userId) return;
    userIds.add(connectedSocket.userId.toString());
  });

  return Array.from(userIds);
};

const emitPresence = (io, socket, isOnline) => {
  if (!socket.userId || !socket.companyId) return;

  const payload = {
    userId: socket.userId,
    isOnline,
    lastSeen: new Date(),
  };

  io.to(`company:${socket.companyId}`).emit(isOnline ? 'user:online' : 'user:offline', payload);
  io.to(`company:${socket.companyId}`).emit(isOnline ? 'chat:user-online' : 'chat:user-offline', payload);
  io.to(`company:${socket.companyId}`).emit('chat:online-users', getCompanyOnlineUsers(io, socket.companyId));
};

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
  emitPresence(io, socket, true);

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`🔌 Client disconnected: ${socket.id} - User: ${socket.user?.name}`);
    
    setTimeout(async () => {
      const userRoom = io.sockets.adapter.rooms.get(`user:${socket.userId}`);
      if (!userRoom || userRoom.size === 0) {
        await updateUserOnlineStatus(socket.userId, false);
        emitPresence(io, socket, false);
      } else {
        io.to(`company:${socket.companyId}`).emit('chat:online-users', getCompanyOnlineUsers(io, socket.companyId));
      }
    }, 1000);
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
  if (!userId) return;

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
