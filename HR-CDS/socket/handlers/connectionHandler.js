
const User = require('../../../models/User');
const { getCompanyOnlineUsers, isUserOnline, broadcastOnlineUsers } = require('../presence');

const connectionHandler = (io, socket) => {
  void 0;

  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
  }

  if (socket.companyId) {
    socket.join(`company:${socket.companyId}`);
  }

  if (socket.user?.companyRole === 'Owner' || socket.user?.companyRole === 'Admin') {
    socket.join(`company:${socket.companyId}:admin`);
  }

  updateUserOnlineStatus(socket.userId, true);
  if (socket.userId && socket.companyId) {
    const payload = {
      userId: socket.userId,
      isOnline: true,
      lastSeen: new Date(),
    };
    io.to(`company:${socket.companyId}`).emit('user:online', payload);
    io.to(`company:${socket.companyId}`).emit('chat:user-online', payload);
    broadcastOnlineUsers(io, socket.companyId).catch(() => {});
  }

  socket.on('disconnect', () => {
    setTimeout(async () => {
      const stillOnline = await isUserOnline(io, socket.userId);
      if (!stillOnline) {
        await updateUserOnlineStatus(socket.userId, false);
        if (socket.userId && socket.companyId) {
          const payload = {
            userId: socket.userId,
            isOnline: false,
            lastSeen: new Date(),
          };
          io.to(`company:${socket.companyId}`).emit('user:offline', payload);
          io.to(`company:${socket.companyId}`).emit('chat:user-offline', payload);
        }
      }
      if (socket.companyId) {
        await broadcastOnlineUsers(io, socket.companyId);
      }
    }, 15000);
  });

  socket.on('error', (error) => {
    console.error(`❌ Socket error for user ${socket.userId}:`, error);
  });

  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ status: 'ok', timestamp: new Date() });
    }
  });

  socket.on('chat:heartbeat', async (callback) => {
    if (socket.userId) {
      await updateUserOnlineStatus(socket.userId, true);
    }
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
