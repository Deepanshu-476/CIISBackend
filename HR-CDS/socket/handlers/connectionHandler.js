
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
  require('../../chat/utils/messageReceipts')
    .recordPendingDeliveries(io, socket.userId, socket.companyId)
    .catch(error => console.error('[chat] pending deliveries failed:', error.message));
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


// Connects and the 25s chat heartbeat used to write the user doc every time. "Online" is now
// written at most once a minute per user; going offline is always written.
const ONLINE_WRITE_INTERVAL_MS = 60 * 1000;
const lastOnlineWriteAt = new Map();

const updateUserOnlineStatus = async (userId, isOnline) => {
  if (!userId) return;

  const key = String(userId);
  const now = Date.now();
  if (isOnline) {
    if (now - (lastOnlineWriteAt.get(key) || 0) < ONLINE_WRITE_INTERVAL_MS) return;
    lastOnlineWriteAt.set(key, now);
  } else {
    lastOnlineWriteAt.delete(key);
  }

  try {
    await User.updateOne({ _id: userId }, {
      isOnline,
      lastSeen: new Date(now)
    });
  } catch (error) {
    console.error('Error updating user status:', error);
  }
};

module.exports = connectionHandler;
