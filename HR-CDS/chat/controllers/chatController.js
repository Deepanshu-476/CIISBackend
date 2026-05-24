const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../../../models/User");
const Group = require("../../models/Group");
const {notifyDirectUsers} = require("../../utils/systemNotificationService");

const getUserId = req => req.user._id?.toString() || req.user.id?.toString();

const populateMessage = query => query.populate("sender", "name email profileImage");

const getUnreadCount = (conversationId, userId, companyId) => Message.countDocuments({
  conversationId,
  companyId,
  sender: {$ne: userId},
  seenBy: {$ne: userId},
  deletedFor: {$ne: userId},
  deletedForEveryone: false,
});

const getLastVisibleMessage = (conversationId, userId, companyId) => Message.findOne({
  conversationId,
  companyId,
  deletedFor: {$ne: userId},
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

    res.status(200).json({success: true, conversation});
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

    res.status(200).json({success: true, conversation});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getConversations = async (req, res) => {
  try {
    const userId = getUserId(req);
    const conversations = await Conversation.find({
      companyId: req.user.company,
      members: userId,
    })
      .populate("members", "name email profileImage companyRole")
      .populate("admins", "name email profileImage")
      .sort({updatedAt: -1});

    const conversationsWithMeta = await Promise.all(
      conversations.map(conversation => withConversationMeta(conversation, userId, req.user.company))
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

    res.status(200).json({success: true, conversation});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getCompanyGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      $or: [
        {members: getUserId(req)},
        {createdBy: getUserId(req)},
      ],
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
    const {conversationId, text} = req.body;
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

    const message = await Message.create({
      companyId: req.user.company,
      conversationId,
      sender: senderId,
      text,
      file,
      fileType,
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
      .filter(memberId => memberId !== senderId);

    console.log('[CHAT NOTIFICATION] dispatch', {
      conversationId,
      messageId: message._id,
      isGroup: conversation.isGroup,
      recipientCount: recipients.length,
      recipients,
    });

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
        console.log('[CHAT NOTIFICATION] dispatched', {
          conversationId,
          messageId: message._id,
          notificationCount: notifications?.length || 0,
        });
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
    })
      .populate("sender", "name email profileImage")
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
      },
      {$addToSet: {seenBy: userId}}
    );

    await emitUnreadCounts(conversation, userId);

    res.status(200).json({success: true, messages: normalizedMessages});
  } catch (error) {
    res.status(500).json({success: false, message: error.message});
  }
};

exports.getCompanyUsers = async (req, res) => {
  try {
    const users = await User.find({
      company: req.user.company,
      _id: {$ne: req.user.id},
      isActive: true,
    }).select("name email profileImage companyRole");

    res.status(200).json({success: true, users});
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
