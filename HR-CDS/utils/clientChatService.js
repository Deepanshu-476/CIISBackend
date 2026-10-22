const Conversation = require('../chat/models/Conversation');
const User = require('../../models/User');
const { id, ids } = require('./projectChatEvents');
const Client = () => require('../models/Client');
const Task = () => require('../models/ClientTask');

const internal = (user, client) => id(user) !== id(client.userId) &&
  ![user.companyRole, user.role, user.jobRoleName, user.employeeType].some(value => String(value || '').trim().toLowerCase() === 'client');

// Legacy names grant membership only when exactly one internal user matches.
function resolveMember(value, users) {
  const key = id(value).trim().toLowerCase();
  const matches = users.filter(user => [id(user), user.email, user.name].some(item => String(item || '').trim().toLowerCase() === key));
  return matches.length === 1 ? matches[0]._id : null;
}

async function companyFor(client) {
  if (!client?.companyCode) return null;
  return require('../../models/Company').findOne({ companyCode: client.companyCode }).select('_id companyCode');
}

async function syncClient(clientId) {
  const startedAt = new Date();
  const client = await Client().findById(clientId).lean();
  const existing = await Conversation.findOne({ clientId });
  if (!client) {
    if (existing) {
      require('./projectChatService').emitMembers(existing, 'chat:project-membership-updated', { conversationId: existing._id, clientId });
      await Conversation.updateOne({ _id: existing._id }, { $set: { members: [], admins: [] } });
      global.io?.in(`conversation:${existing._id}`).socketsLeave(`conversation:${existing._id}`);
    }
    return null;
  }
  const company = await companyFor(client);
  if (!company) throw new Error('Client has no resolvable companyCode');
  if (existing && id(existing.companyId) !== id(company)) {
    await Conversation.updateOne({ _id: existing._id }, { $set: { members: [], admins: [] } });
    global.io?.in(`conversation:${existing._id}`).socketsLeave(`conversation:${existing._id}`);
  }
  const users = (await User.find({ company: company._id, isActive: { $ne: false } }).select('_id name email companyRole role jobRoleName employeeType')).filter(user => internal(user, client));
  const tasks = await Task().find({ clientId }).select('assigneeId assignee').lean();
  const managers = ids((client.projectManager || []).map(value => resolveMember(value, users)));
  const candidates = ids([...managers, ...tasks.map(task => task.assigneeId ? users.find(user => id(user) === id(task.assigneeId))?._id : resolveMember(task.assignee, users))]);
  const members = client.status === 'Inactive' ? [] : candidates;
  const query = { companyId: company._id, clientId };
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate({ ...query, $or: [{ clientSyncedAt: { $lte: startedAt } }, { clientSyncedAt: { $exists: false } }] }, {
      $set: { groupName: client.client, isGroup: true, members, admins: managers.filter(member => members.includes(member)), clientSyncedAt: startedAt },
      $setOnInsert: { createdAt: new Date(), updatedAt: new Date() },
    }, { upsert: true, new: true, timestamps: false, setDefaultsOnInsert: true });
  } catch (error) { if (error.code !== 11000) throw error; conversation = await Conversation.findOne(query); }
  if (global.io) for (const socket of await global.io.in(`conversation:${conversation._id}`).fetchSockets()) {
    if (!conversation.members.some(member => id(member) === id(socket.userId || socket.data?.userId))) socket.leave(`conversation:${conversation._id}`);
  }
  if (!existing || existing.groupName !== conversation.groupName || existing.members.map(id).sort().join() !== conversation.members.map(id).sort().join()) {
    const recipients = ids([...(existing?.members || []), ...conversation.members]);
    if (recipients.length) global.io?.to(recipients.map(member => `user:${member}`)).emit('chat:project-membership-updated', { conversationId: conversation._id, clientId });
  }
  return conversation;
}

async function drainTask(taskId) {
  const task = await Task().findById(taskId).select('+chatOutbox').lean();
  if (!task) return;
  const conversation = await syncClient(task.clientId);
  if (!conversation) return;
  if (!conversation.members.length) {
    // Retain events while inactive; deliver after access is explicitly restored.
    return;
  }
  for (const event of task.chatOutbox || []) {
    let outgoing = event;
    if (event.type === 'task_created' && !event.assigned?.length && task.assignee) {
      const users = await User.find({ _id: { $in: conversation.members }, company: conversation.companyId }).select('_id name email');
      const assigned = resolveMember(task.assignee, users);
      if (assigned) outgoing = { ...event, assigned: [assigned] };
    }
    await require('./projectChatService').deliverEvent({ _id: task.clientId, chatEntity: 'client' }, conversation, outgoing);
    await Task().collection.updateOne({ _id: task._id }, { $pull: { chatOutbox: { key: event.key } } });
  }
  await Task().collection.updateOne({ _id: task._id, __v: task.__v }, { $set: { chatSyncPending: false } });
}

async function syncForUser(companyId) {
  const company = await require('../../models/Company').findById(companyId).select('companyCode');
  if (!company) return;
  for await (const client of Client().find({ companyCode: company.companyCode }).select('_id').lean().cursor()) await syncClient(client._id);
}

async function sweep() {
  for await (const client of Client().find({ chatSyncPending: true }).select('_id updatedAt __v').lean().cursor()) {
    try { await syncClient(client._id); await Client().collection.updateOne({ _id: client._id, __v: client.__v, updatedAt: client.updatedAt }, { $set: { chatSyncPending: false } }); }
    catch (error) { console.error('[client-chat] sync pending', id(client), error.message); }
  }
  for await (const task of Task().find({ $or: [{ 'chatOutbox.0': { $exists: true } }, { chatSyncPending: true }] }).select('_id').lean().cursor()) {
    try { await drainTask(task._id); } catch (error) { console.error('[client-chat] delivery pending', id(task), error.message); }
  }
  // Also clean deleted clients whose previously joined sockets still exist.
  for await (const conversation of Conversation.find({ clientId: { $exists: true }, 'members.0': { $exists: true } }).select('clientId').lean().cursor()) {
    try { await syncClient(conversation.clientId); } catch (error) { console.error('[client-chat] refresh pending', error.message); }
  }
}

module.exports = { syncClient, drainTask, syncForUser, sweep, companyFor, resolveMember, internal };
