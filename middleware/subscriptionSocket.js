const Company = require('../models/Company');
const {isPlatformOwner} = require('./authMiddleware');
const {subscriptionState, expiredResponse} = require('../utils/companySubscription');

const readEvents = new Set([
  'ping', 'chat:heartbeat', 'chat:get-online-users', 'chat:join-conversation',
  'chat:leave-conversation', 'chat:join-conversations', 'chat:seen',
  'notification:getUnreadCount', 'notification:markRead', 'notification:markAllRead',
  'leave:join', 'leave:leave', 'leave:get', 'call:check-availability',
  'call:sync-incoming', 'call:get-roster', 'call:get-ongoing', 'call:end', 'call:reject',
  'call:mic-state', 'call:rebind',
]);

module.exports = socket => async (packet, next) => {
  if (readEvents.has(packet[0]) || isPlatformOwner(socket.user) || !socket.companyId) return next();
  try {
    const company = await Company.findById(socket.companyId).select('subscriptionExpiry').lean();
    if (!subscriptionState(company).expired) return next();
    const response = expiredResponse(company);
    const ack = packet[packet.length - 1];
    if (typeof ack === 'function') ack(response);
    socket.emit('subscription:expired', response);
  } catch (error) { next(error); }
};
