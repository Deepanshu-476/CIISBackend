const getCompanyOnlineUsers = async (io, companyId) => {
  if (!companyId) return [];
  const sockets = await io.in(`company:${companyId}`).fetchSockets();   // all servers
  return [...new Set(sockets.map(s => s.data?.userId).filter(Boolean).map(String))];
};

const isUserOnline = async (io, userId) => {
  if (!userId) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.length > 0;
};

const broadcastOnlineUsers = async (io, companyId) => {
  const users = await getCompanyOnlineUsers(io, companyId);
  io.to(`company:${companyId}`).emit('chat:online-users', users);
  return users;
};

module.exports = { getCompanyOnlineUsers, isUserOnline, broadcastOnlineUsers };
