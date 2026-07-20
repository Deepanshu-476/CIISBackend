const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../../../models/User");
const Group = require("../../models/Group");
const {notifyDirectUsers} = require("../../utils/systemNotificationService");

const getUserId = req => req.user._id?.toString() || req.user.id?.toString();

const populateMessage = query => query
  .populate("sender", "name email profileImage")
  .populate({
    path: "replyTo",
    select: "sender text file fileType deletedForEveryone",
    populate: {path: "sender", select: "name email profileImage"},
  })
  .populate("reactions.user", "name profileImage")
  .populate("systemEvent.actor", "name profileImage");

const DISAPPEARING_DURATIONS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const activeMessageFilter = () => ({
  $or: [
    {expiresAt: null},
    {expiresAt: {$exists: false}},
    {expiresAt: {$gt: new Date()}},
  ],
});

const getConversationMuteState = (conversation, userId) => {
  const setting = (conversation.notificationSettings || [])
    .find(item => item.user?.toString() === userId?.toString());
  if (!setting?.muted) return {muted: false, mutedUntil: null};
  if (setting.mutedUntil && new Date(setting.mutedUntil) <= new Date()) {
    return {muted: false, mutedUntil: null};
  }
  return {muted: true, mutedUntil: setting.mutedUntil || null};
};

const getUnreadCount = (conversationId, userId, companyId) => Message.countDocuments({
  conversationId,
  companyId,
  sender: {$ne: userId},
  seenBy: {$ne: userId},
  deletedFor: {$ne: userId},
  deletedForEveryone: false,
  ...activeMessageFilter(),
});

const getLastVisibleMessage = (conversationId, userId, companyId) => Message.findOne({
  conversationId,
  companyId,
  deletedFor: {$ne: userId},
  ...activeMessageFilter(),
})
  .populate("sender", "name email profileImage")
  .sort({createdAt: -1});

const withConversationMeta = async (conversation, userId, companyId) => {
  const plain = conversation.toObject ? conversation.toObject() : conversation;
  const [lastMessage, unreadCount] = await Promise.all([
    getLastVisibleMessage(plain._id, userId, companyId),
    getUnreadCount(plain._id, userId, companyId),
  ]);

  return {
    ...plain,
    notificationSettings: undefined,
    notificationPreference: getConversationMuteState(plain, userId),
    lastMessage,
    unreadCount,
  };
};

const emitUnreadCounts = async (conversation, senderId) => {
  if (!global.io || !conversation) return;

  await Promise.all((conversation.members || []).map(async member => {
    const memberId = member.toString();
    const count = await getUnreadCount(conversation._id, memberId, conversation.companyId);
    global.io.to(`user:${memberId}`).emit("chat:unread-update", {
      senderId,
      conversationId: conversation._id,
      count,
    });
  }));
};

const getSocketOnlineUserIds = (companyId) => {
  const onlineIds = new Set();
  const companyKey = companyId?.toString();

  if (!global.io?.sockets?.sockets) return onlineIds;

  global.io.sockets.sockets.forEach(socket => {
    const socketUserId = socket.userId?.toString();
    const socketCompanyId = socket.companyId?.toString();

    if (!socketUserId) return;
    if (companyKey && socketCompanyId !== companyKey) return;

    onlineIds.add(socketUserId);
  });

  return onlineIds;
};

const isRecentlyOnlineInDb = (user) => {
  if (!user?.isOnline) return false;
  if (!user.lastSeen) return true;

  const lastSeenTime = new Date(user.lastSeen).getTime();
  if (Number.isNaN(lastSeenTime)) return true;

  return Date.now() - lastSeenTime < 30 * 1000;
};

exports.createConversation = async (req, res) => {
  try {
    const {receiverId} = req.body;
    const requesterId = getUserId(req);
    const receiver = await User.findOne({
      _id: receiverId,
      company: req.user.company,
      isActive: true,
    });

    if (!receiver) {
      return res.status(404).json({success: false, message: "User not found"});
    }

    let conversation = await Conversation.findOne({
      companyId: req.user.company,
      isGroup: false,
      members: {$all: [req.user.id, receiverId]},
    });

    if (!conversation) {
      conversation = await Conversation.create({
        companyId: req.user.company,
        members: [requesterId, receiverId],
        isGroup: false,
      });
    }

    const plain = conversation.toObject();
    res.status(200).json({
      success: true,
      conversation: {
        ...plain,
        notificationSettings: undefined,
        notificationPreference: getConversationMuteState(plain, getUserId(req)),
      },
    });
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.createGroupConversation = async (req, res) => {
  try {
    const {groupId} = req.body;
    const group = await Group.findOne({_id: groupId, isActive: true});

    if (!group) {
      return res.status(404).json({success: false, message: "Group not found"});
    }

    const memberIds = (group.members || []).map(member => member.toString());
    const requesterId = getUserId(req);
    const isMember = group.createdBy?.toString() === requesterId || memberIds.includes(requesterId);

    if (!isMember) {
      return res.status(403).json({success: false, message: "You are not a member of this group"});
    }

    const members = Array.from(new Set([
      group.createdBy?.toString(),
      ...memberIds,
    ].filter(Boolean)));

    let conversation = await Conversation.findOne({
      companyId: req.user.company,
      isGroup: true,
      groupId,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        companyId: req.user.company,
        members,
        isGroup: true,
        groupId,
        groupName: group.name,
        admins: [group.createdBy],
      });
    } else {
      conversation.members = members;
      conversation.groupName = group.name;
      if (!conversation.admins || !conversation.admins.length) {
        conversation.admins = [group.createdBy];
      }
      await conversation.save();
    }

    const plain = conversation.toObject();
    res.status(200).json({
      success: true,
      conversation: {
        ...plain,
        notificationSettings: undefined,
        notificationPreference: getConversationMuteState(plain, requesterId),
      },
    });
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getConversations = async (req, res) => {
  try {
    const userId = getUserId(req);

    
    const activeUserGroups = await Group.find({
      members: userId,
      isActive: true,
    }).select("_id");
    const activeGroupIds = new Set(activeUserGroups.map(g => g._id.toString()));

    const conversations = await Conversation.find({
      companyId: req.user.company,
      members: userId,
    })
      .populate("members", "name email profileImage companyRole isActive")
      .populate("admins", "name email profileImage")
      .sort({updatedAt: -1});

    
    
    
    const activeConversations = conversations.filter(conversation => {
      if (conversation.isGroup) {
        if (!conversation.groupId) return false;
        return activeGroupIds.has(conversation.groupId.toString());
      } else {
        const otherMember = conversation.members.find(
          m => m._id.toString() !== userId.toString()
        );
        if (otherMember && otherMember.isActive === false) {
          return false;
        }
        return true;
      }
    });

    const conversationsWithMeta = await Promise.all(
      activeConversations.map(conversation => withConversationMeta(conversation, userId, req.user.company))
    );

    res.status(200).json({success: true, conversations: conversationsWithMeta});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      companyId: req.user.company,
      members: req.user.id,
    })
      .populate("members", "name email profileImage companyRole")
      .populate("admins", "name email profileImage");

    if (!conversation) {
      return res.status(404).json({success: false, message: "Conversation not found"});
    }

    const plain = conversation.toObject();
    res.status(200).json({
      success: true,
      conversation: {
        ...plain,
        notificationSettings: undefined,
        notificationPreference: getConversationMuteState(plain, getUserId(req)),
      },
    });
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getCompanyGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      members: getUserId(req),
      isActive: true,
    })
      .select("name description members createdBy")
      .populate("createdBy", "name email profileImage");

    res.status(200).json({success: true, groups});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const {conversationId, text, replyToMessageId} = req.body;
    const senderId = getUserId(req);
    const conversation = await Conversation.findOne({
      _id: conversationId,
      companyId: req.user.company,
    });

    if (!conversation) {
      return res.status(404).json({success: false, message: "Conversation not found"});
    }

    const isMember = conversation.members.some(member => member.toString() === senderId);
    if (!isMember) {
      return res.status(403).json({success: false, message: "You are not a member of this conversation"});
    }

    const file = req.file ? `/api/uploads/chat/${req.file.filename}` : "";
    const fileType = req.file ? req.file.mimetype : "";
    let replyTo = null;

    if (replyToMessageId) {
      replyTo = await Message.findOne({
        _id: replyToMessageId,
        conversationId,
        companyId: req.user.company,
        deletedForEveryone: false,
        ...activeMessageFilter(),
      }).select("_id");

      if (!replyTo) {
        return res.status(400).json({success: false, message: "Reply message is unavailable"});
      }
    }

    const duration = DISAPPEARING_DURATIONS[conversation.disappearingMode];
    const expiresAt = duration ? new Date(Date.now() + duration) : null;

    const message = await Message.create({
      companyId: req.user.company,
      conversationId,
      sender: senderId,
      text,
      file,
      fileType,
      replyTo: replyTo?._id || null,
      expiresAt,
      seenBy: [senderId],
    });

    const populatedMessage = await populateMessage(Message.findById(message._id));

    if (global.io) {
      const room = `conversation:${conversationId}`;
      global.io.to(room).emit("chat:receive-message", populatedMessage);
    }

    await emitUnreadCounts(conversation, senderId);

    const recipients = conversation.members
      .map(member => member.toString())
      .filter(memberId => memberId !== senderId)
      .filter(memberId => !getConversationMuteState(conversation, memberId).muted);

    void 0;

    notifyDirectUsers({
      userIds: recipients,
      targetPath: '/ciisUser/chat',
      type: conversation.isGroup ? 'group_chat_message' : 'chat_message',
      title: conversation.isGroup ? `New message in ${conversation.groupName || 'Group'}` : 'New Chat Message',
      message: `${req.user.name || 'User'}: ${text || (file ? 'Sent an attachment' : 'New message')}`,
      actor: senderId,
      company: req.user.company,
      data: {
        conversationId,
        messageId: message._id,
        isGroup: conversation.isGroup,
        groupId: conversation.groupId,
      },
      priority: 'medium',
    })
      .then(notifications => {
        void 0;
      })
      .catch(error => {
        console.error('[CHAT NOTIFICATION] failed', {
          conversationId,
          messageId: message._id,
          message: error.message,
          stack: error.stack,
        });
      });

    res.status(201).json({success: true, message: populatedMessage});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getMessages = async (req, res) => {
  try {
    const userId = getUserId(req);
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      companyId: req.user.company,
      members: userId,
    });

    if (!conversation) {
      return res.status(404).json({success: false, message: "Conversation not found"});
    }

    const messages = await Message.find({
      conversationId: req.params.id,
      companyId: req.user.company,
      deletedFor: {$ne: userId},
      ...activeMessageFilter(),
    })
      .populate("sender", "name email profileImage")
      .populate({
        path: "replyTo",
        select: "sender text file fileType deletedForEveryone",
        populate: {path: "sender", select: "name email profileImage"},
      })
      .populate("reactions.user", "name profileImage")
      .populate("systemEvent.actor", "name profileImage")
      .sort({createdAt: 1});

    const normalizedMessages = messages.map(message => {
      const plain = message.toObject();
      const senderId = plain.sender?._id?.toString() || plain.sender?.toString();
      const seenBy = (plain.seenBy || []).map(member => member.toString());

      return {
        ...plain,
        seen: senderId === userId
          ? seenBy.some(memberId => memberId !== userId)
          : seenBy.includes(userId),
      };
    });

    await Message.updateMany(
      {
        conversationId: req.params.id,
        companyId: req.user.company,
        sender: {$ne: userId},
        seenBy: {$ne: userId},
        ...activeMessageFilter(),
      },
      {$addToSet: {seenBy: userId}}
    );

    await emitUnreadCounts(conversation, userId);

    res.status(200).json({success: true, messages: normalizedMessages});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.updateConversationMute = async (req, res) => {
  try {
    const userId = getUserId(req);
    const {muted, mutedUntil = null} = req.body;
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      companyId: req.user.company,
      members: userId,
    });

    if (!conversation) {
      return res.status(404).json({success: false, message: "Conversation not found"});
    }

    const normalizedMutedUntil = muted && mutedUntil ? new Date(mutedUntil) : null;
    if (normalizedMutedUntil && Number.isNaN(normalizedMutedUntil.getTime())) {
      return res.status(400).json({success: false, message: "Invalid mute expiry"});
    }

    const existing = conversation.notificationSettings
      .find(item => item.user.toString() === userId);
    if (existing) {
      existing.muted = Boolean(muted);
      existing.mutedUntil = normalizedMutedUntil;
    } else {
      conversation.notificationSettings.push({
        user: userId,
        muted: Boolean(muted),
        mutedUntil: normalizedMutedUntil,
      });
    }
    await conversation.save();

    const notificationPreference = getConversationMuteState(conversation, userId);
    global.io?.to(`user:${userId}`).emit("chat:mute-updated", {
      conversationId: conversation._id,
      notificationPreference,
    });

    res.status(200).json({success: true, notificationPreference});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.updateDisappearingMessages = async (req, res) => {
  try {
    const userId = getUserId(req);
    const {mode} = req.body;
    if (!["off", "24h", "7d", "90d"].includes(mode)) {
      return res.status(400).json({success: false, message: "Invalid disappearing-message timer"});
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      companyId: req.user.company,
      members: userId,
    });
    if (!conversation) {
      return res.status(404).json({success: false, message: "Conversation not found"});
    }

    conversation.disappearingMode = mode;
    conversation.disappearingUpdatedBy = userId;
    conversation.disappearingUpdatedAt = new Date();
    await conversation.save();

    const systemMessage = await Message.create({
      companyId: req.user.company,
      conversationId: conversation._id,
      sender: userId,
      messageType: "system",
      systemEvent: {
        type: "disappearing_messages_changed",
        actor: userId,
        mode,
      },
      seenBy: conversation.members,
    });
    const populatedMessage = await populateMessage(Message.findById(systemMessage._id));

    global.io?.to(`conversation:${conversation._id}`).emit("chat:receive-message", populatedMessage);
    global.io?.to(`conversation:${conversation._id}`).emit("chat:disappearing-updated", {
      conversationId: conversation._id,
      mode,
      updatedBy: userId,
      updatedAt: conversation.disappearingUpdatedAt,
    });

    res.status(200).json({
      success: true,
      disappearingMode: mode,
      message: populatedMessage,
    });
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.updateMessageReaction = async (req, res) => {
  try {
    const userId = getUserId(req);
    const emoji = String(req.body.emoji || "").trim();
    if (emoji.length > 16) {
      return res.status(400).json({success: false, message: "Invalid reaction"});
    }

    const message = await Message.findOne({
      _id: req.params.messageId,
      companyId: req.user.company,
      deletedForEveryone: false,
      ...activeMessageFilter(),
    });
    if (!message) {
      return res.status(404).json({success: false, message: "Message not found"});
    }

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      companyId: req.user.company,
      members: userId,
    });
    if (!conversation) {
      return res.status(403).json({success: false, message: "You are not a member of this conversation"});
    }

    message.reactions = (message.reactions || [])
      .filter(reaction => reaction.user.toString() !== userId);
    if (emoji) message.reactions.push({user: userId, emoji});
    await message.save();

    const populatedMessage = await populateMessage(Message.findById(message._id));
    global.io?.to(`conversation:${conversation._id}`).emit("chat:message-reaction", {
      messageId: message._id,
      conversationId: conversation._id,
      reactions: populatedMessage.reactions,
    });

    res.status(200).json({success: true, reactions: populatedMessage.reactions});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getCompanyUsers = async (req, res) => {
  try {
    const socketOnlineIds = getSocketOnlineUserIds(req.user.company);
    const users = await User.find({
      company: req.user.company,
      _id: {$ne: req.user.id},
      isActive: true,
      companyRole: { $not: /^client$/i },
    }).select("name email profileImage companyRole isOnline lastSeen").lean();

    const usersWithPresence = users.map(user => ({
      ...user,
      isOnline: socketOnlineIds.has(user._id.toString()) || isRecentlyOnlineInDb(user),
    }));

    res.status(200).json({success: true, users: usersWithPresence});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.deleteMessageForMe = async (req, res) => {
  try {
    const userId = getUserId(req);
    const message = await Message.findOne({
      _id: req.params.messageId,
      companyId: req.user.company,
    });

    if (!message) {
      return res.status(404).json({success: false, message: "Message not found"});
    }

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      companyId: req.user.company,
      members: userId,
    });

    if (!conversation) {
      return res.status(403).json({success: false, message: "You are not a member of this conversation"});
    }

    message.deletedFor.addToSet(userId);
    await message.save();
    await emitUnreadCounts(conversation, userId);

    if (global.io) {
      global.io.to(`user:${userId}`).emit("chat:message-deleted-for-me", {
        messageId: message._id,
        conversationId: conversation._id,
      });
    }

    res.status(200).json({success: true, message: "Message deleted for you"});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};


exports.deleteMessageForEveryone = async (req, res) => {
  try {
    const userId = getUserId(req);
    const message = await Message.findOne({
      _id: req.params.messageId,
      companyId: req.user.company,
    });

    if (!message) {
      return res.status(404).json({success: false, message: "Message not found"});
    }

    if (message.sender.toString() !== userId) {
      return res.status(403).json({success: false, message: "Only the sender can delete this message for everyone"});
    }

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      companyId: req.user.company,
      members: userId,
    });

    if (!conversation) {
      return res.status(403).json({success: false, message: "You are not a member of this conversation"});
    }

    message.deletedForEveryone = true;
    message.text = "";
    message.file = "";
    message.fileType = "";
    await message.save();
    await emitUnreadCounts(conversation, userId);

    if (global.io) {
      global.io.to(`conversation:${conversation._id}`).emit("chat:message-deleted-for-everyone", {
        messageId: message._id,
        conversationId: conversation._id,
      });
    }

    res.status(200).json({success: true, message: "Message deleted for everyone"});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.forwardMessage = async (req, res) => {
  try {
    const userId = getUserId(req);
    const {targetUserIds = []} = req.body;
    const uniqueTargets = Array.from(new Set(targetUserIds.map(String))).filter(targetId => targetId !== userId);

    if (!uniqueTargets.length) {
      return res.status(400).json({success: false, message: "Select at least one user"});
    }

    const original = await Message.findOne({
      _id: req.params.messageId,
      companyId: req.user.company,
      deletedForEveryone: false,
      deletedFor: {$ne: userId},
    });

    if (!original) {
      return res.status(404).json({success: false, message: "Message not found"});
    }

    const sourceConversation = await Conversation.findOne({
      _id: original.conversationId,
      companyId: req.user.company,
      members: userId,
    });

    if (!sourceConversation) {
      return res.status(403).json({success: false, message: "You are not a member of this conversation"});
    }

    const targetUsers = await User.find({
      _id: {$in: uniqueTargets},
      company: req.user.company,
      isActive: true,
    }).select("_id");

    const forwardedMessages = [];

    for (const target of targetUsers) {
      const targetId = target._id.toString();
      let conversation = await Conversation.findOne({
        companyId: req.user.company,
        isGroup: false,
        members: {$all: [userId, targetId]},
      });

      if (!conversation) {
        conversation = await Conversation.create({
          companyId: req.user.company,
          members: [userId, targetId],
          isGroup: false,
        });
      }

      const message = await Message.create({
        companyId: req.user.company,
        conversationId: conversation._id,
        sender: userId,
        text: original.text,
        file: original.file,
        fileType: original.fileType,
        seenBy: [userId],
        isForwarded: true,
        originalMessage: original._id,
      });

      const populatedMessage = await populateMessage(Message.findById(message._id));
      forwardedMessages.push(populatedMessage);

      if (global.io) {
        global.io.to(`conversation:${conversation._id}`).emit("chat:message-forwarded", populatedMessage);
        global.io.to(`user:${targetId}`).emit("chat:message-forwarded", populatedMessage);
      }

      await emitUnreadCounts(conversation, userId);
    }

    res.status(201).json({success: true, messages: forwardedMessages});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.markMessageSeen = async (req, res) => {
  try {
    const userId = getUserId(req);
    const message = await Message.findOne({
      _id: req.params.messageId,
      companyId: req.user.company,
    });

    if (!message) {
      return res.status(404).json({success: false, message: "Message not found"});
    }

    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      companyId: req.user.company,
      members: userId,
    });

    if (!conversation) {
      return res.status(403).json({success: false, message: "You are not a member of this conversation"});
    }

    message.seenBy.addToSet(userId);
    await message.save();
    await emitUnreadCounts(conversation, userId);

    if (global.io) {
      global.io.to(`user:${message.sender}`).emit("chat:message-seen", {
        messageId: message._id,
        conversationId: conversation._id,
        seenBy: userId,
      });
    }

    res.status(200).json({success: true});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};
