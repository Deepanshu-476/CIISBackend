const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Conversation = require('../HR-CDS/chat/models/Conversation');
const Message = require('../HR-CDS/chat/models/Message');
const User = require('../models/User');
const Notification = require('../HR-CDS/models/Notification');
const unreadModule = require('../HR-CDS/chat/utils/unreadCount');
const { deliverEvent } = require('../HR-CDS/utils/projectChatService');
const { syncClient, resolveMember } = require('../HR-CDS/utils/clientChatService');

const oid = () => new mongoose.Types.ObjectId();

test('Conversation pre-validate hook rejects both projectId and clientId', async () => {
  const conv = new Conversation({
    companyId: oid(),
    projectId: oid(),
    clientId: oid(),
    isGroup: true,
  });

  await assert.rejects(
    async () => {
      await conv.validate();
    },
    /cannot have both projectId and clientId/i
  );
});

test('syncClient(undefined) and invalid id returns null and does not query Conversation', async () => {
  const resultUndefined = await syncClient(undefined);
  assert.equal(resultUndefined, null);

  const resultNull = await syncClient(null);
  assert.equal(resultNull, null);

  const resultInvalid = await syncClient('not-an-objectid');
  assert.equal(resultInvalid, null);
});

test('deliverEvent refuses when ownerId does not match project._id', async () => {
  let findOneAndUpdateCalled = false;
  const originalFindOneAndUpdate = Message.findOneAndUpdate;
  Message.findOneAndUpdate = async () => {
    findOneAndUpdateCalled = true;
    return {};
  };

  try {
    const project = { _id: oid(), chatEntity: 'project' };
    const conversation = {
      _id: oid(),
      projectId: oid(), // different project ID
      members: [oid()],
      companyId: oid()
    };
    const event = {
      key: 'testkey1',
      type: 'task_status_changed',
      actor: conversation.members[0],
      task: oid(),
      title: 'Test task',
      from: 'Pending',
      to: 'In Progress'
    };

    await deliverEvent(project, conversation, event);
    assert.equal(findOneAndUpdateCalled, false, 'Message should NOT be written when ownerId mismatches');
  } finally {
    Message.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('deliverEvent refuses client event into project conversation (and vice versa)', async () => {
  let findOneAndUpdateCalled = false;
  const originalFindOneAndUpdate = Message.findOneAndUpdate;
  Message.findOneAndUpdate = async () => {
    findOneAndUpdateCalled = true;
    return {};
  };

  try {
    const clientId = oid();
    const clientEntity = { _id: clientId, chatEntity: 'client' };
    // Conversation has matching clientId BUT also has projectId
    const mixedConversation = {
      _id: oid(),
      clientId: clientId,
      projectId: oid(),
      members: [oid()],
      companyId: oid()
    };
    const event = {
      key: 'testkey2',
      type: 'task_status_changed',
      actor: mixedConversation.members[0],
      task: oid(),
      title: 'Client Task',
      from: 'Pending',
      to: 'In Progress'
    };

    await deliverEvent(clientEntity, mixedConversation, event);
    assert.equal(findOneAndUpdateCalled, false, 'Client event should NOT be written to conversation with projectId');
  } finally {
    Message.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('deliverEvent: non-member actor gets system card messageType: "system", not a user message', async () => {
  let capturedMessagePayload = null;
  const originalFindOneAndUpdate = Message.findOneAndUpdate;
  const originalFindById = Message.findById;
  const originalUserFind = User.find;
  const originalConvUpdate = Conversation.updateOne;
  const originalGetUnread = unreadModule.getUnreadCount;
  const originalNotifFind = Notification.findOneAndUpdate;
  const originalNotifCount = Notification.countDocuments;

  const actorId = oid();
  const memberId = oid();
  const projectId = oid();
  const convId = oid();
  const companyId = oid();

  Message.findOneAndUpdate = async (filter, update) => {
    capturedMessagePayload = update.$setOnInsert;
    return {
      _id: oid(),
      createdAt: new Date(),
      ...capturedMessagePayload
    };
  };

  Message.findById = () => ({
    populate: () => ({
      populate: async () => ({
        _id: oid(),
        ...capturedMessagePayload
      })
    })
  });

  Conversation.updateOne = async () => ({});
  unreadModule.getUnreadCount = async () => 0;
  Notification.findOneAndUpdate = async () => ({});
  Notification.countDocuments = async () => 0;

  User.find = () => ({
    select: async () => [{ _id: actorId, name: 'Taniya' }]
  });

  try {
    const project = { _id: projectId, chatEntity: 'project' };
    const conversation = {
      _id: convId,
      projectId: projectId,
      members: [memberId], // actorId is NOT in members!
      companyId: companyId
    };
    const event = {
      key: 'testkey3',
      type: 'task_status_changed',
      actor: actorId,
      task: oid(),
      title: 'Urvashi Creative 2',
      from: 'Pending',
      to: 'In Progress',
      service: 'creative production'
    };

    await deliverEvent(project, conversation, event);

    assert.ok(capturedMessagePayload, 'Message payload should be created');
    assert.equal(capturedMessagePayload.messageType, 'system', 'Non-member status change must be messageType: "system"');
    assert.deepEqual(capturedMessagePayload.seenBy, [], 'Non-member should not be in seenBy');
    assert.match(capturedMessagePayload.text, /Taniya changed the status of/);
  } finally {
    Message.findOneAndUpdate = originalFindOneAndUpdate;
    Message.findById = originalFindById;
    User.find = originalUserFind;
    Conversation.updateOne = originalConvUpdate;
    unreadModule.getUnreadCount = originalGetUnread;
    Notification.findOneAndUpdate = originalNotifFind;
    Notification.countDocuments = originalNotifCount;
  }
});

test('deliverEvent: member actor gets user message messageType: "message"', async () => {
  let capturedMessagePayload = null;
  const originalFindOneAndUpdate = Message.findOneAndUpdate;
  const originalFindById = Message.findById;
  const originalUserFind = User.find;
  const originalConvUpdate = Conversation.updateOne;
  const originalGetUnread = unreadModule.getUnreadCount;
  const originalNotifFind = Notification.findOneAndUpdate;
  const originalNotifCount = Notification.countDocuments;

  const actorId = oid();
  const projectId = oid();
  const convId = oid();
  const companyId = oid();

  Message.findOneAndUpdate = async (filter, update) => {
    capturedMessagePayload = update.$setOnInsert;
    return {
      _id: oid(),
      createdAt: new Date(),
      ...capturedMessagePayload
    };
  };

  Message.findById = () => ({
    populate: () => ({
      populate: async () => ({
        _id: oid(),
        ...capturedMessagePayload
      })
    })
  });

  Conversation.updateOne = async () => ({});
  unreadModule.getUnreadCount = async () => 0;
  Notification.findOneAndUpdate = async () => ({});
  Notification.countDocuments = async () => 0;

  User.find = () => ({
    select: async () => [{ _id: actorId, name: 'Vansh Gupta' }]
  });

  try {
    const project = { _id: projectId, chatEntity: 'project' };
    const conversation = {
      _id: convId,
      projectId: projectId,
      members: [actorId], // actor IS a member
      companyId: companyId
    };
    const event = {
      key: 'testkey4',
      type: 'task_status_changed',
      actor: actorId,
      task: oid(),
      title: 'Fix Bug',
      from: 'Pending',
      to: 'Completed'
    };

    await deliverEvent(project, conversation, event);

    assert.ok(capturedMessagePayload, 'Message payload should be created');
    assert.equal(capturedMessagePayload.messageType, 'message', 'Member status change must be messageType: "message"');
    assert.deepEqual(capturedMessagePayload.seenBy, [actorId]);
    assert.match(capturedMessagePayload.text, /✅ I have completed ‘Fix Bug’/);
  } finally {
    Message.findOneAndUpdate = originalFindOneAndUpdate;
    Message.findById = originalFindById;
    User.find = originalUserFind;
    Conversation.updateOne = originalConvUpdate;
    unreadModule.getUnreadCount = originalGetUnread;
    Notification.findOneAndUpdate = originalNotifFind;
    Notification.countDocuments = originalNotifCount;
  }
});

test('resolveMember matches exact name and unique prefix, but rejects non-unique prefix', () => {
  const users = [
    { _id: 'u1', name: 'Taniya Sharma', email: 'taniya.sharma@example.com' },
    { _id: 'u2', name: 'Taniya Verma', email: 'taniya.verma@example.com' },
    { _id: 'u3', name: 'Jatin Kumar', email: 'jatin@example.com' },
  ];

  // Exact ID match
  assert.equal(resolveMember('507f1f77bcf86cd799439011', [{ _id: '507f1f77bcf86cd799439011', name: 'User' }]), '507f1f77bcf86cd799439011');

  // Exact Email match
  assert.equal(resolveMember('jatin@example.com', users), 'u3');

  // Exact Full Name match
  assert.equal(resolveMember('Jatin Kumar', users), 'u3');
  assert.equal(resolveMember('Taniya Sharma', users), 'u1');

  // Ambiguous prefix "Taniya" matches both Taniya Sharma and Taniya Verma -> should return null
  assert.equal(resolveMember('Taniya', users), null);

  // Unique prefix "Jatin" matches only Jatin Kumar -> returns u3
  assert.equal(resolveMember('Jatin', users), 'u3');
});
