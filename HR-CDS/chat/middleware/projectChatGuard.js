const Message = require('../models/Message');
const service = require('../../utils/projectChatService');

module.exports = async (req, res, next) => {
  try {
    const company = req.user.company?._id || req.user.company;
    const user = req.user.id || req.user._id;
    if (['/groups', '/conversations'].includes(req.path)) {
      // Lists are reads. Hooks and the outbox worker maintain conversations;
      // validate current source membership in batches without rewriting every chat.
      req.chatEntityAccess = await require('../../utils/chatListAccess')(company, user);
    }
    let conversationId = req.body?.conversationId;
    const match = req.path.match(/^\/(?:messages|conversation)\/([a-f\d]{24})(?:\/|$)/i);
    if (match) conversationId = match[1];
    const messageMatch = req.path.match(/^\/message\/([a-f\d]{24})(?:\/|$)/i);
    if (messageMatch) {
      const message = await Message.findOne({ _id: messageMatch[1], companyId: company }).select('conversationId messageType systemEvent');
      conversationId = message?.conversationId;
      if (message?.messageType === 'system' && message.systemEvent?.task && /delete-for-everyone/.test(req.path)) {
        return res.status(403).json({ success: false, message: 'Task updates cannot be deleted' });
      }
    }
    if (conversationId) await service.refreshConversation(conversationId, company);
    next();
  } catch (error) { next(error); }
};
