const getCompanyOnlineUsers = async (io, companyId) => {
  if (!companyId) return [];
  const sockets = await io.in(`company:${companyId}`).fetchSockets();   // all servers
  return [...new Set(sockets.map(s => s.data?.userId || s.userId).filter(Boolean).map(String))];
};

const isUserOnline = async (io, userId) => {
  if (!userId) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.length > 0;
};

const sendOnlineUsers = async (io, companyId) => {
  const users = await getCompanyOnlineUsers(io, companyId);
  io.to(`company:${companyId}`).emit('chat:online-users', users);
  return users;
};

// Every connect/disconnect used to send the full online list to the whole company at once
// (mobile reconnects made that a storm). Calls within 2s of each other share one broadcast.
const BROADCAST_DEBOUNCE_MS = 2000;
const pendingBroadcasts = new Map();

const broadcastOnlineUsers = (io, companyId) => {
  const key = String(companyId);
  if (pendingBroadcasts.has(key)) return pendingBroadcasts.get(key);
  const pending = new Promise(resolve => setTimeout(resolve, BROADCAST_DEBOUNCE_MS))
    .then(() => {
      pendingBroadcasts.delete(key);
      return sendOnlineUsers(io, companyId);
    })
    .catch(error => {
      pendingBroadcasts.delete(key);
      throw error;
    });
  pendingBroadcasts.set(key, pending);
  return pending;
};

module.exports = { getCompanyOnlineUsers, isUserOnline, broadcastOnlineUsers };
