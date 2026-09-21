// Socket connections are the source of truth; persisted presence can outlive a
// server restart, and a user may have several tabs/devices connected at once.
const getCompanyOnlineUsers = (io, companyId) => {
  if (!companyId || !io?.sockets?.sockets) return [];
  const companyKey = companyId.toString();
  const users = new Set();
  io.sockets.sockets.forEach(socket => {
    if (socket.connected === false || socket.companyId?.toString() !== companyKey) return;
    if (socket.userId) users.add(socket.userId.toString());
  });
  return Array.from(users);
};

const isUserOnline = (io, companyId, userId) =>
  getCompanyOnlineUsers(io, companyId).includes(userId?.toString());

module.exports = {getCompanyOnlineUsers, isUserOnline};
