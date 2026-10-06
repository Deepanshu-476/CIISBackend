
const User = require('../../../models/User');

const getRawCompanyId = company => {
  if (!company) return '';
  if (typeof company === 'string') return company;
  if (company._id) return company._id.toString();
  if (company.id) return company.id.toString();
  return company.toString();
};

const getCompanyOnlineUsers = (io, companyId) => {
  if (!companyId) return [];

  const companyKey = getRawCompanyId(companyId);
  const userIds = new Set();

  io.sockets.sockets.forEach((connectedSocket) => {
    const socketCompId = getRawCompanyId(connectedSocket.companyId);
    if (companyKey && socketCompId && socketCompId !== companyKey) return;
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
  }

  if (socket.companyId) {
    socket.join(`company:${socket.companyId}`);
  }

  if (socket.user?.companyRole === 'Owner' || socket.user?.companyRole === 'Admin') {
    socket.join(`company:${socket.companyId}:admin`);
  }

  updateUserOnlineStatus(socket.userId, true);
  emitPresence(io, socket, true);

  socket.on('disconnect', async () => {
    setTimeout(async () => {
      let hasActiveSocket = false;
      const userRoom = io.sockets.adapter?.rooms?.get(`user:${socket.userId}`);
      if (userRoom && userRoom.size > 0) {
        hasActiveSocket = true;
      } else if (io.sockets?.sockets) {
        for (const [_, connected] of io.sockets.sockets) {
          if (connected.userId?.toString() === socket.userId?.toString()) {
            hasActiveSocket = true;
            connected.join(`user:${socket.userId}`);
            break;
          }
        }
      }

      if (!hasActiveSocket) {
        await updateUserOnlineStatus(socket.userId, false);
        emitPresence(io, socket, false);
      } else {
        io.to(`company:${socket.companyId}`).emit('chat:online-users', getCompanyOnlineUsers(io, socket.companyId));
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
