const Conversation = require('../chat/models/Conversation');
const Message = require('../chat/models/Message');
const User = require('../../models/User');
const Notification = require('../models/Notification');
const { getUnreadCount } = require('../chat/utils/unreadCount');
const { id, ids } = require('./projectChatEvents');
const projects = () => require('../models/Project').Project;

async function resolveCompany(project) {
  if (project.company) return project.company;
  if (!project.companyCode) return null;
  const company = await require('../../models/Company').findOne({ companyCode: project.companyCode }).select('_id');
  return company?._id;
}

async function syncProject(project) {
  project = await projects().findById(project._id).lean();
  if (!project) return null;
  const companyId = await resolveCompany(project);
  if (!companyId) throw new Error('Project has no resolvable company');
  const candidates = ids([project.createdBy, ...(project.users || []), ...(project.managers || []),
    ...(project.tasks || []).flatMap(task => [task.assignedTo, ...(task.assignedUsers || [])])]);
  const users = await User.find({ _id: { $in: candidates }, company: companyId, isActive: { $ne: false } }).select('_id');
  const members = users.map(user => user._id);
  const admins = ids([project.createdBy, ...(project.managers || [])]).filter(user => members.some(member => id(member) === user));
  const query = { companyId, projectId: project._id };
  const previous = await Conversation.findOne(query).select("members groupName");
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate({ ...query, $or: [
      { projectVersion: { $lte: project.__v || 0 } }, { projectVersion: { $exists: false } },
    ] }, { $set: { projectVersion: project.__v || 0,
      isGroup: true, groupName: project.projectName, members, admins,
    }, $setOnInsert: { createdAt: new Date(), updatedAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true, timestamps: false });
  } catch (error) {
    if (error.code !== 11000) throw error;
    conversation = await Conversation.findOne(query);
  }
  // Revoke already joined rooms, including sockets connected on another worker.
  if (global.io) {
    const sockets = await global.io.in(`conversation:${conversation._id}`).fetchSockets();
    for (const socket of sockets) {
      if (!conversation.members.some(member => id(member) === id(socket.userId || socket.data?.userId))) {
        socket.leave(`conversation:${conversation._id}`);
      }
    }
  }
  if (!previous || previous.groupName !== conversation.groupName || previous.members.map(id).sort().join() !== members.map(id).sort().join()) {
    const recipients = ids([...(previous?.members || []), ...conversation.members]);
    global.io?.to(recipients.map(member => `user:${member}`)).emit('chat:project-membership-updated', { conversationId: conversation._id });
  }
  return conversation;
}

async function refreshConversation(conversationId, companyId) {
  const conversation = await Conversation.findOne({ _id: conversationId, companyId });
  if (conversation?.clientId) {
    const client = await require('../models/Client').findById(conversation.clientId).lean();
    const company = client && await require('./clientChatService').companyFor(client);
    if (!client || id(company) !== id(companyId)) {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { members: [], admins: [] } });
      global.io?.in(`conversation:${conversation._id}`).socketsLeave(`conversation:${conversation._id}`);
      return null;
    }
    return require('./clientChatService').syncClient(client._id);
  }
  if (!conversation?.projectId) return conversation;
  const project = await projects().findById(conversation.projectId).lean();
  if (!project || id(await resolveCompany(project)) !== id(companyId)) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { members: [], admins: [] } });
    global.io?.in(`conversation:${conversation._id}`).socketsLeave(`conversation:${conversation._id}`);
    return null;
  }
  return syncProject(project);
}

function emitMembers(conversation, event, payload) {
  if (!global.io || !conversation.members.length) return;
  global.io.to(conversation.members.map(member => `user:${id(member)}`)).emit(event, payload);
}

async function deliverEvent(project, conversation, event) {
  const isClient = project.chatEntity === 'client';
  const reference = isClient ? { client: project._id } : { project: project._id };
  const navigation = isClient ? { clientId: project._id } : { projectId: project._id };
  const memberIds = conversation.members.map(id);
  // Invalid or cross-company mentions never expose names, notify, or create updates.
  if (event.mentioned && !memberIds.includes(id(event.mentioned))) return;
  const users = await User.find({ _id: { $in: ids([event.actor, ...(event.assigned || []), event.mentioned]) }, company: conversation.companyId }).select('name');
  const names = new Map(users.map(user => [id(user), user.name || 'User']));
  const actor = names.get(id(event.actor)) || 'System';
  let text;
  if (event.type === 'task_created') text = `${actor} ne ‘${event.title}’ task create kiya. Assigned to: ${(event.assigned || []).map(user => names.get(id(user))).filter(Boolean).join(', ') || 'Unassigned'}.`;
  if (event.type === 'task_status_changed') text = `${actor} ne ‘${event.title}’ ka status ${event.from} → ${event.to} kiya.`;
  if (event.type === 'task_mentioned') text = `${actor} ne ${names.get(id(event.mentioned))} ko ‘${event.title}’ task mein mention kiya.`;
  if (!text) return;
  const message = await Message.findOneAndUpdate({ eventKey: event.key }, { $setOnInsert: {
    eventKey: event.key, companyId: conversation.companyId, conversationId: conversation._id,
    sender: event.actor, text, messageType: 'system', seenBy: [event.actor],
    systemEvent: { type: event.type, actor: event.actor, ...reference, task: event.task, mentionedUser: event.mentioned },
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await Conversation.updateOne({ _id: conversation._id }, { $max: { updatedAt: message.createdAt } }, { timestamps: false });
  const populated = await Message.findById(message._id).populate('sender', 'name').populate('systemEvent.actor', 'name');
  emitMembers(conversation, 'chat:receive-message', populated);
  emitMembers(conversation, 'chat:conversation-updated', { conversationId: conversation._id, ...navigation, isGroup: true, lastMessage: populated, updatedAt: message.createdAt });
  for (const member of conversation.members) {
    const count = await getUnreadCount(conversation._id, member, conversation.companyId, conversation.readState || []);
    global.io?.to(`user:${id(member)}`).emit('chat:unread-update', { conversationId: conversation._id, senderId: event.actor, count });
  }
  for (const recipient of conversation.members) {
    if (id(recipient) === id(event.actor)) continue;
    const isMention = id(recipient) === id(event.mentioned);
    const setting = (conversation.notificationSettings || []).find(item => id(item.user) === id(recipient));
    const muted = setting?.muted && (!setting.mutedUntil || new Date(setting.mutedUntil) > new Date());
    if (muted && !isMention) continue;
    const notification = await Notification.findOneAndUpdate({ eventKey: event.key, recipient }, { $setOnInsert: {
      eventKey: event.key, recipient, company: conversation.companyId, actor: event.actor,
      type: isMention ? (isClient ? 'client_task_mention' : 'project_task_mention') : 'group_chat_message', title: isMention ? 'Task mention' : `Update in ${conversation.groupName}`,
      message: text, targetPath: '/ciisUser/chat',
      data: { conversationId: conversation._id, ...navigation, taskId: event.task, messageId: message._id },
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    global.io?.to(`user:${id(recipient)}`).emit('notification:new', notification);
    global.io?.to(`user_${id(recipient)}`).emit('new_notification', notification);
    const count = await Notification.countDocuments({ recipient, company: conversation.companyId, isRead: false });
    global.io?.to(`user:${id(recipient)}`).emit('notification:unread_count', count);
    global.io?.to(`user_${id(recipient)}`).emit('notification:unread_count', count);
  }
}

async function syncAndDrain(projectId) {
  const project = await projects().findById(projectId).select('+chatOutbox').lean();
  if (!project) return;
  const conversation = await syncProject(project);
  if (!conversation) return;
  for (const event of project.chatOutbox || []) {
    await deliverEvent(project, conversation, event);
    // Raw update deliberately bypasses hooks; delivery is idempotent under retries.
    await projects().collection.updateOne({ _id: project._id }, { $pull: { chatOutbox: { key: event.key } } });
  }
  await projects().collection.updateOne({ _id: project._id, __v: project.__v }, { $set: { chatSyncPending: false } });
  return conversation;
}

async function syncForUser(companyId, userId) {
  const company = await require('../../models/Company').findById(companyId).select('companyCode');
  if (!company) return;
  const query = { $and: [ { $or: [{ company: companyId }, { company: null, companyCode: company.companyCode }] },
    { $or: [{ createdBy: userId }, { users: userId }, { managers: userId }, { 'tasks.assignedTo': userId }, { 'tasks.assignedUsers': userId }] } ] };
  for await (const project of projects().find(query).lean().cursor()) await syncProject(project);
}

module.exports = { resolveCompany, syncProject, syncAndDrain, syncForUser, refreshConversation, emitMembers, deliverEvent };
