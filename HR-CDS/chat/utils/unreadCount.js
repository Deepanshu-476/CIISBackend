const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

// Unread counts used to scan every message of the conversation (seenBy is not indexable), and they are
// recomputed for every member on each new message / seen event. Each member now has a read mark
// (Conversation.readState.lastReadAt): everything before it is already seen, because opening a
// conversation marks all its messages seen. Counting only messages after the mark stays cheap on the
// { companyId, conversationId, deletedForEveryone, createdAt } index.

const activeMessageFilter = () => ({
  $or: [
    {expiresAt: null},
    {expiresAt: {$exists: false}},
    {expiresAt: {$gt: new Date()}},
  ],
});

const unseenFilter = (conversationId, userId, companyId) => ({
  conversationId,
  companyId,
  sender: {$ne: userId},
  seenBy: {$ne: userId},
  deletedFor: {$ne: userId},
  deletedForEveryone: false,
  ...activeMessageFilter(),
});

const readMarkOf = (readState, userId) => {
  const entry = (readState || []).find(item => String(item.user) === String(userId));
  return entry?.lastReadAt ? new Date(entry.lastReadAt) : null;
};

const setReadMark = async (conversationId, userId, at) => {
  const updated = await Conversation.updateOne(
    {_id: conversationId, "readState.user": userId},
    {$max: {"readState.$.lastReadAt": at}}
  );
  if (!updated.matchedCount) {
    await Conversation.updateOne(
      {_id: conversationId, "readState.user": {$ne: userId}},
      {$push: {readState: {user: userId, lastReadAt: at}}}
    );
  }
};

// readState: the conversation's readState if already loaded (saves a lookup).
const getUnreadCount = async (conversationId, userId, companyId, readState) => {
  const filter = unseenFilter(conversationId, userId, companyId);
  let mark = readState === undefined
    ? readMarkOf((await Conversation.findById(conversationId).select("readState").lean())?.readState, userId)
    : readMarkOf(readState, userId);

  if (!mark) {
    // First count for this member: start the mark just before their oldest unseen message.
    const oldest = await Message.findOne(filter).sort({createdAt: 1}).select("createdAt").lean();
    mark = oldest ? new Date(new Date(oldest.createdAt).getTime() - 1) : new Date();
    await setReadMark(conversationId, userId, mark);
    if (!oldest) return 0;
  }

  return Message.countDocuments({...filter, createdAt: {$gt: mark}});
};

module.exports = {getUnreadCount, setReadMark};
