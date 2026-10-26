const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Conversation = require('../HR-CDS/chat/models/Conversation');
const Message = require('../HR-CDS/chat/models/Message');
require('../models/User');

test('conversation previews respect visibility, expiry, read marks and empty chats', async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri());
    await Message.init();
    const id = () => new mongoose.Types.ObjectId();
    const company = id(), user = id(), sender = id();
    const mark = new Date(Date.now() - 10000);
    const chats = await Conversation.create([
      { companyId: company, members: [user, sender], readState: [{ user, lastReadAt: mark }] },
      { companyId: company, members: [user] },
    ]);
    await Message.create([
      { companyId: company, conversationId: chats[0]._id, sender, text: 'old', createdAt: new Date(mark - 1000) },
      { companyId: company, conversationId: chats[0]._id, sender, text: 'visible', createdAt: new Date(mark.getTime() + 1000) },
      { companyId: company, conversationId: chats[0]._id, sender, text: 'hidden', deletedFor: [user] },
      { companyId: company, conversationId: chats[0]._id, sender, text: 'expired', expiresAt: new Date(Date.now() - 1000) },
      { companyId: id(), conversationId: chats[0]._id, sender, text: 'foreign' },
    ]);
    const source = fs.readFileSync(require.resolve('../HR-CDS/chat/controllers/chatController'), 'utf8');
    const start = source.indexOf('const withConversationsMeta =');
    const end = source.indexOf('const emitUnreadCounts =', start);
    const load = vm.runInNewContext(source.slice(start, end) + '\nwithConversationsMeta;', {
      require, Conversation, Message,
      activeMessageFilter: () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }),
      getConversationMuteState: () => ({ muted: false }),
    });
    const result = await load(chats, String(user), company);
    assert.equal(result[0].lastMessage.text, 'visible');
    assert.equal(result[0].unreadCount, 1);
    assert.equal(result[1].lastMessage, null);
    assert.equal(result[1].unreadCount, 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
