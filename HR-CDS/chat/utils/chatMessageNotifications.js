const idOf = value => String(value?._id || value || '');

// Mentions have already been validated against this conversation and company.
// Send one notification per recipient, using the existing chat push type so
// delivery receipts and notification navigation continue to work on older apps.
function chatMessageNotifications({conversation, senderId, senderName, text, file, messageId, mentions = [], isMuted}) {
  const members = [...new Set(conversation.members.map(idOf))].filter(id => id !== idOf(senderId));
  const mentioned = new Set(mentions.map(mention => idOf(mention.user)));
  const tagged = members.filter(id => mentioned.has(id));
  const regular = members.filter(id => !mentioned.has(id) && !isMuted(id));
  const common = {
    targetPath: '/ciisUser/chat',
    type: conversation.isGroup ? 'group_chat_message' : 'chat_message',
    message: `${senderName || 'User'}: ${text || (file ? 'Sent an attachment' : 'New message')}`,
    actor: senderId,
    company: conversation.companyId,
    // Each saved message is a separate notification, including repeated text.
    dedupe: false,
    data: {
      conversationId: idOf(conversation), messageId: idOf(messageId),
      mentionedUserIds: tagged, isGroup: conversation.isGroup, groupId: conversation.groupId,
    },
  };
  return [
    regular.length ? {...common, userIds: regular, priority: 'medium', title: conversation.isGroup ? `New message in ${conversation.groupName || 'Group'}` : 'New Chat Message'} : null,
    tagged.length ? {
      ...common, userIds: tagged, priority: 'high',
      title: `${senderName || 'User'} mentioned you${conversation.isGroup ? ` in ${conversation.groupName || 'Group'}` : ''}`,
      data: {...common.data, isMention: true},
    } : null,
  ].filter(Boolean);
}

module.exports = {chatMessageNotifications};
