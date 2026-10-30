const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../../../models/User');
const { refreshConversation } = require('../../utils/projectChatService');

module.exports = socket => async (packet, next) => {
  try {
    const [event, data] = packet;
    if (!event.startsWith('chat:') || !data || typeof data !== 'object') return next();
    const reject = () => { socket.emit('chat:error', { message: 'Chat access denied' }); };
    let conversationId = data.conversationId;
    const relay = ['chat:send-message', 'chat:forward-message'].includes(event);
    const messageId = event === 'chat:send-message' ? data._id : data.message?._id || data.messageId;
    if (relay || ['chat:seen', 'chat:delete-for-everyone', 'chat:delete-for-me'].includes(event)) {
      if (!messageId) return reject();
      const message = await Message.findOne({ _id: messageId, companyId: socket.companyId });
      if (!message) return reject();
      conversationId = message.conversationId;
      if (relay && (String(message.sender) !== String(socket.userId) || message.messageType === 'system')) return reject();
      if (event === 'chat:delete-for-everyone' && (String(message.sender) !== String(socket.userId) || !message.deletedForEveryone || message.messageType === 'system')) return reject();
      if (relay) {
        const canonical = await Message.findById(message._id).populate('sender', 'name email profileImage');
        packet[1] = event === 'chat:send-message' ? canonical.toObject() : { message: canonical.toObject() };
      }
    }
    if (conversationId) {
      const conversation = await refreshConversation(conversationId, socket.companyId);
      if (!conversation?.members.some(member => String(member) === String(socket.userId))) return reject();
    }
    if (event === 'chat:join-conversations') {
      const conversations = await Conversation.find({ _id: { $in: data.conversationIds || [] }, companyId: socket.companyId, members: socket.userId }).select('_id');
      for (const conversation of conversations) await refreshConversation(conversation._id, socket.companyId);
    }
    if (!conversationId && data.receiverId) {
      if (!await User.exists({ _id: data.receiverId, company: socket.companyId, isActive: { $ne: false } })) return reject();
    }
    next();
  } catch { socket.emit('chat:error', { message: 'Unable to authorize chat event' }); }
};
