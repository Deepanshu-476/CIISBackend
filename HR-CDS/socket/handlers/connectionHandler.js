
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
  void 0;

  
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
    void 0;
  } else {
    void 0;
  }
  void 0;

  
  if (socket.companyId) {
    socket.join(`company:${socket.companyId}`);
    void 0;
  }

  
  if (socket.user.companyRole === 'Owner' || socket.user.companyRole === 'Admin') {
    socket.join(`company:${socket.companyId}:admin`);
    void 0;
  }

  
  updateUserOnlineStatus(socket.userId, true);
  emitPresence(io, socket, true);

  
  socket.on('disconnect', async () => {
    void 0;
    
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

  
  socket.on('error', (error) => {
    console.error(`❌ Socket error for user ${socket.userId}:`, error);
  });

  
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ status: 'ok', timestamp: new Date() });
    }
  });
};


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
