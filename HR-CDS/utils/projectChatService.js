const mongoose = require('mongoose');
const Conversation = require('../chat/models/Conversation');
const Message = require('../chat/models/Message');
const User = require('../../models/User');
const Notification = require('../models/Notification');
const unreadCountService = require('../chat/utils/unreadCount');
const { id, ids } = require('./projectChatEvents');
const projects = () => require('../models/Project').Project;

async function resolveCompany(project) {
  if (project.company) return project.company;
  if (!project.companyCode) return null;
  const company = await require('../../models/Company').findOne({ companyCode: project.companyCode }).select('_id');
  return company?._id;
}

// Only what group membership needs: a full project (every task's logs, remarks and
// notifications) can be several MB and this runs on every chat request for the group.
const SYNC_FIELDS = 'projectName company companyCode createdBy users managers tasks.assignedTo tasks.assignedUsers __v';

async function syncProject(project) {
  if (!project) return null;
  const projectId = project._id || project;
  if (!projectId || !mongoose.isValidObjectId(projectId)) return null;
  if (!project.projectName || !project.tasks) {
    project = await projects().findById(projectId).select(SYNC_FIELDS).lean();
  }
  if (!project) return null;
  const companyId = await resolveCompany(project);
  if (!companyId) throw new Error('Project has no resolvable company');
  const candidates = ids([project.createdBy, ...(project.users || []), ...(project.managers || []),
    ...(project.tasks || []).flatMap(task => [task.assignedTo, ...(task.assignedUsers || [])])]);
  const users = await User.find({ _id: { $in: candidates }, company: companyId, isActive: { $ne: false } }).select('_id');
  const members = users.map(user => user._id);
  const admins = ids([project.createdBy, ...(project.managers || [])]).filter(user => members.some(member => id(member) === user));
  const query = { companyId, projectId: project._id, clientId: { $exists: false } };
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
  const membersChanged = !previous || previous.members.map(id).sort().join() !== members.map(id).sort().join();
  // Revoke already joined rooms, including sockets connected on another worker.
  // Only needed when someone left; asking every worker costs up to 2s per request.
  if (global.io && membersChanged) {
    try {
      const sockets = await Promise.race([
        global.io.in(`conversation:${conversation._id}`).fetchSockets(),
        new Promise(resolve => setTimeout(() => resolve([]), 2000))
      ]);
      for (const socket of sockets) {
        if (!conversation.members.some(member => id(member) === id(socket.userId || socket.data?.userId))) {
          socket.leave(`conversation:${conversation._id}`);
        }
      }
    } catch (sockErr) {
      console.warn('[project-chat] fetchSockets error:', sockErr.message);
    }
  }
  if (membersChanged || previous.groupName !== conversation.groupName) {
    const recipients = ids([...(previous?.members || []), ...conversation.members]);
    global.io?.to(recipients.map(member => `user:${member}`)).emit('chat:project-membership-updated', { conversationId: conversation._id });
  }
  return conversation;
}

async function refreshConversation(conversationId, companyId) {
  if (!conversationId || !companyId || !mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(companyId)) return null;
  const conversation = await Conversation.findOne({ _id: conversationId, companyId });
  if (!conversation) return null;
  if (conversation.clientId && conversation.projectId) {
    console.warn('[project-chat] conversation has both clientId and projectId, refusing sync', id(conversation._id));
    return null;
  }
  if (conversation.clientId) {
    if (!mongoose.isValidObjectId(conversation.clientId)) return null;
    const client = await require('../models/Client').findById(conversation.clientId).lean();
    const company = client && await require('./clientChatService').companyFor(client);
    if (!client || id(company) !== id(companyId)) {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { members: [], admins: [] } });
      global.io?.in(`conversation:${conversation._id}`).socketsLeave(`conversation:${conversation._id}`);
      return null;
    }
    return require('./clientChatService').syncClient(client._id);
  }
  if (!conversation.projectId) return conversation;
  if (!mongoose.isValidObjectId(conversation.projectId)) return null;
  const project = await projects().findById(conversation.projectId).select(SYNC_FIELDS).lean();
  if (!project || id(await resolveCompany(project)) !== id(companyId)) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { members: [], admins: [] } });
    global.io?.in(`conversation:${conversation._id}`).socketsLeave(`conversation:${conversation._id}`);
    return null;
  }
  return syncProject(project);
}

// Date-only due dates arrive as UTC (or IST) midnight; showing "05:30 am" for them would be misleading.
const formatDue = value => {
  if (!value) return 'no due date';
  const date = new Date(value);
  const dateOnly = /T00:00:00(\.000)?Z$/.test(date.toISOString()) || /T18:30:00(\.000)?Z$/.test(date.toISOString());
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: true }),
  });
};

// A status change made by a person is posted as that person's own message,
// e.g. "✅ I have completed ‘Fix login’.\nRemark: …", with the remark image attached.
const statusMessageText = event => {
  const lines = [String(event.to).toLowerCase() === 'completed'
    ? `✅ I have completed ‘${event.title}’.`
    : `I changed the status of ‘${event.title}’ from ${event.from} to ${event.to}.`];
  if (event.service) lines.push(`Service: ${event.service}`);
  if (event.remark) lines.push(`Remark: ${event.remark}`);
  return lines.join('\n');
};

function emitMembers(conversation, event, payload) {
  if (!global.io || !conversation.members.length) return;
  global.io.to(conversation.members.map(member => `user:${id(member)}`)).emit(event, payload);
}

async function deliverEvent(project, conversation, event) {
  if (!project?._id || !conversation?._id || !event) return;
  const isClient = project.chatEntity === 'client';
  const ownerId = isClient ? conversation.clientId : conversation.projectId;
  if (!ownerId || id(ownerId) !== id(project._id)) {
    console.warn('[project-chat] event for', isClient ? 'client' : 'project', id(project._id),
      'refused for conversation', id(conversation._id));
    return;                                   // never write into another group
  }
  if (isClient && conversation.projectId) return;   // a client event never goes to a project group
  if (!isClient && conversation.clientId) return;   // and the other way round

  const reference = isClient ? { client: project._id } : { project: project._id };
  const navigation = isClient ? { clientId: project._id } : { projectId: project._id };
  const memberIds = conversation.members.map(id);
  const actorIsMember = memberIds.includes(id(event.actor));
  // Invalid or cross-company mentions never expose names, notify, or create updates.
  if (event.mentioned && !memberIds.includes(id(event.mentioned))) return;
  const users = await User.find({ _id: { $in: ids([event.actor, ...(event.assigned || []), event.mentioned]) }, company: conversation.companyId }).select('name');
  const names = new Map(users.map(user => [id(user), user.name || 'User']));
  const actor = names.get(id(event.actor)) || 'System';
  const isUserStatusMessage = event.type === 'task_status_changed' && names.has(id(event.actor)) && actorIsMember;
  let text;
  if (event.type === 'task_created') text = `${actor} created task ‘${event.title}’. Assigned to: ${(event.assigned || []).map(user => names.get(id(user))).filter(Boolean).join(', ') || 'Unassigned'}.`;
  if (event.type === 'task_status_changed') text = `${actor} changed the status of ‘${event.title}’ from ${event.from} to ${event.to}.`;
  if (event.type === 'task_mentioned') text = `${actor} mentioned ${names.get(id(event.mentioned)) || 'a user'} in task ‘${event.title}’.`;
  if (event.type === 'task_remark_added') {
    const images = event.images ? `${event.images} image${event.images === 1 ? '' : 's'}` : '';
    text = event.remark
      ? `${actor} added a remark on ‘${event.title}’: “${event.remark}”${images ? ` (+${images})` : ''}`
      : `${actor} added ${images || 'a remark'} on ‘${event.title}’.`;
  }
  if (event.type === 'task_priority_changed') text = `${actor} changed the priority of ‘${event.title}’ from ${event.from} to ${event.to}.`;
  if (event.type === 'task_due_changed') text = `${actor} changed the due date of ‘${event.title}’ from ${formatDue(event.from)} to ${formatDue(event.to)}.`;
  if (event.type === 'task_assignee_changed') {
    const assignees = (event.assigned || []).map(user => names.get(id(user))).filter(Boolean).join(', ') || event.assigneeName || 'Unassigned';
    text = `${actor} reassigned ‘${event.title}’. Assigned to: ${assignees}.`;
  }
  if (event.type === 'task_renamed') text = `${actor} renamed task ‘${event.from}’ to ‘${event.title}’.`;
  if (event.type === 'task_description_updated') text = `${actor} updated the description of ‘${event.title}’.`;
  if (event.type === 'task_checkpoint_added') text = `${actor} added checkpoint “${event.checkpoint}” to ‘${event.title}’.`;
  if (event.type === 'task_checkpoint_completed') text = `${actor} completed checkpoint “${event.checkpoint}” in ‘${event.title}’.`;
  if (event.type === 'task_checkpoint_reopened') text = `${actor} reopened checkpoint “${event.checkpoint}” in ‘${event.title}’.`;
  if (event.type === 'task_file_added') text = `${actor} attached “${event.file}” to ‘${event.title}’.`;
  if (event.type === 'task_file_removed') text = `${actor} removed the attachment “${event.file}” from ‘${event.title}’.`;
  if (event.type === 'task_deleted') text = `${actor} deleted task ‘${event.title}’.`;
  if (isUserStatusMessage) text = statusMessageText(event);
  if (!text) return;
  const image = isUserStatusMessage && event.image
    ? { file: event.image, fileType: 'image/jpeg', fileName: String(event.image).split('/').pop() }
    : {};
  const message = await Message.findOneAndUpdate({ eventKey: event.key }, { $setOnInsert: {
    eventKey: event.key, companyId: conversation.companyId, conversationId: conversation._id,
    sender: event.actor, text, messageType: isUserStatusMessage ? 'message' : 'system', seenBy: actorIsMember ? [event.actor] : [], ...image,
    systemEvent: { type: event.type, actor: event.actor, ...reference, task: event.task, mentionedUser: event.mentioned },
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await Conversation.updateOne({ _id: conversation._id }, { $max: { updatedAt: message.createdAt } }, { timestamps: false });
  const populated = await Message.findById(message._id).populate('sender', 'name').populate('systemEvent.actor', 'name');
  emitMembers(conversation, 'chat:receive-message', populated);
  emitMembers(conversation, 'chat:conversation-updated', { conversationId: conversation._id, ...navigation, isGroup: true, lastMessage: populated, updatedAt: message.createdAt });
  for (const member of conversation.members) {
    const count = await unreadCountService.getUnreadCount(conversation._id, member, conversation.companyId, conversation.readState || []);
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
      message: isUserStatusMessage ? `${actor}: ${text}` : text, targetPath: '/ciisUser/chat',
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
  const project = await projects().findById(projectId)
    .select('projectName company companyCode createdBy users managers tasks.assignedTo tasks.assignedUsers chatOutbox __v')
    .select('+chatOutbox')
    .lean();
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
