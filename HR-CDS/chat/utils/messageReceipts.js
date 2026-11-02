const Message = require("../models/Message");

const toId = value => String(value?._id || value || "");

const deliveryReceiptsFor = (userIds = [], at = new Date()) =>
  userIds.map(user => ({user, at}));

// Marks one message delivered and read by userId (opening it, or a "seen" event).
// Returns true when this is the first time the user read it.
// The receipt arrays are not loaded with messages, so this writes with one atomic update
// (guarded so a repeated "seen" never adds a second receipt).
const recordSeen = async (message, userId, at = new Date()) => {
  const id = toId(userId);
  const delivered = (message.deliveredTo || []).some(member => toId(member) === id);
  const seen = (message.seenBy || []).some(member => toId(member) === id);
  if (delivered && seen) return false;
  const addToSet = {};
  const push = {};
  if (!delivered) {
    addToSet.deliveredTo = userId;
    push.deliveryReceipts = {user: userId, at};
  }
  if (!seen) {
    addToSet.seenBy = userId;
    push.readReceipts = {user: userId, at};
  }
  await Message.updateOne(
    {_id: message._id, ...(seen ? {deliveredTo: {$ne: userId}} : {seenBy: {$ne: userId}})},
    {$addToSet: addToSet, $push: push}
  );
  if (!delivered) message.deliveredTo?.addToSet?.(userId);
  if (!seen) message.seenBy?.addToSet?.(userId);
  return !seen;
};

// Marks every message matching `filter` (already limited to other people's messages)
// as delivered to and read by userId.
const recordConversationRead = async (filter, userId, at = new Date()) => {
  await Message.updateMany(
    {...filter, deliveredTo: {$ne: userId}},
    {$addToSet: {deliveredTo: userId}, $push: {deliveryReceipts: {user: userId, at}}}
  );
  await Message.updateMany(
    {...filter, seenBy: {$ne: userId}},
    {$addToSet: {seenBy: userId}, $push: {readReceipts: {user: userId, at}}}
  );
};

// Adds the users who have not received the message yet. Returns those newly added.
const recordDelivered = async (messageId, companyId, userIds = [], at = new Date()) => {
  if (!messageId || !userIds.length) return [];
  const message = await Message.findOne({_id: messageId, companyId}).select("deliveredTo").lean();
  if (!message) return [];
  const already = new Set((message.deliveredTo || []).map(toId));
  const added = [...new Set(userIds.map(toId))].filter(id => id && !already.has(id));
  if (!added.length) return [];
  await Message.updateOne(
    {_id: messageId, companyId},
    {$addToSet: {deliveredTo: {$each: added}}, $push: {deliveryReceipts: {$each: deliveryReceiptsFor(added, at)}}}
  );
  return added;
};

// When a user comes online, the messages sent to them while they were offline count as delivered
// (WhatsApp's double grey tick); their senders are told so their ticks update. Runs at most every
// 2 minutes per user and only looks at the newest 200 messages of the last 7 days (each one is
// an event to its sender's open chat).
const PENDING_DELIVERY_INTERVAL_MS = 2 * 60 * 1000;
const PENDING_DELIVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const lastPendingDeliveryAt = new Map();

const recordPendingDeliveries = async (io, userId, companyId) => {
  if (!userId || !companyId) return;
  const key = toId(userId);
  const now = Date.now();
  if (now - (lastPendingDeliveryAt.get(key) || 0) < PENDING_DELIVERY_INTERVAL_MS) return;
  lastPendingDeliveryAt.set(key, now);
  if (lastPendingDeliveryAt.size > 5000) lastPendingDeliveryAt.clear();

  const Conversation = require("../models/Conversation");
  const conversations = await Conversation.find({companyId, members: userId}).select("_id").lean();
  if (!conversations.length) return;
  const messages = await Message.find({
    companyId,
    conversationId: {$in: conversations.map(conversation => conversation._id)},
    createdAt: {$gte: new Date(now - PENDING_DELIVERY_WINDOW_MS)},
    sender: {$ne: userId},
    deliveredTo: {$ne: userId},
    messageType: {$ne: "system"},
  }).select("_id sender conversationId").sort({createdAt: -1}).limit(200).lean();
  if (!messages.length) return;

  const at = new Date();
  await Message.updateMany(
    {_id: {$in: messages.map(message => message._id)}, deliveredTo: {$ne: userId}},
    {$addToSet: {deliveredTo: userId}, $push: {deliveryReceipts: {user: userId, at}}}
  );
  messages.forEach(message => {
    io?.to(`user:${message.sender}`).emit("chat:message-delivered", {
      messageId: message._id,
      conversationId: message.conversationId,
      deliveredTo: [key],
    });
  });
};

module.exports = {deliveryReceiptsFor, recordSeen, recordConversationRead, recordDelivered, recordPendingDeliveries};
