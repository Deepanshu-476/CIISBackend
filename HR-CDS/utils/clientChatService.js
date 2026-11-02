const mongoose = require('mongoose');
const Conversation = require('../chat/models/Conversation');
const User = require('../../models/User');
const { id, ids } = require('./projectChatEvents');
const Client = () => require('../models/Client');
const Task = () => require('../models/ClientTask');

const internal = (user, client) => id(user) !== id(client.userId) &&
  ![user.companyRole, user.role, user.jobRoleName, user.employeeType].some(value => String(value || '').trim().toLowerCase() === 'client');

function normalizePerson(val) {
  if (!val) return null;
  if (typeof val === 'object') {
    return {
      id: String(val._id || val.id || val.userId || val.employeeId || '').trim(),
      name: String(val.name || val.fullName || val.employeeName || val.username || '').trim(),
      email: String(val.email || val.userEmail || val.employeeEmail || '').trim().toLowerCase()
    };
  }
  const s = String(val).trim();
  if (/^[a-f\d]{24}$/i.test(s)) return { id: s, name: '', email: '' };
  if (s.includes('@')) return { id: '', name: '', email: s.toLowerCase() };
  return { id: '', name: s, email: '' };
}

function resolveMember(value, users, client = null) {
  const target = normalizePerson(value);
  if (!target) return null;

  // 1. Direct ID match
  if (target.id && /^[a-f\d]{24}$/i.test(target.id)) {
    const found = users.find(u => String(u._id) === target.id);
    if (found) return found._id;
  }

  // 2. Direct Email match
  if (target.email) {
    const found = users.find(u => String(u.email || '').trim().toLowerCase() === target.email);
    if (found) return found._id;
  }

  // 3. Name match
  if (target.name) {
    const targetName = target.name.trim().toLowerCase();
    // 3a. Exact match
    const exact = users.find(u => String(u.name || '').trim().toLowerCase() === targetName);
    if (exact) return exact._id;

    // 3b. Clean alphanumeric prefix match (only when unique)
    const cleanTarget = targetName.replace(/[^a-z0-9]/g, '');
    if (cleanTarget.length >= 3) {
      let candidates = users.filter(u => {
        const cleanUser = String(u.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        return cleanUser.length >= 3 && cleanUser.startsWith(cleanTarget);
      });
      const clientDept = String(client?.department || client?.team || '').trim().toLowerCase();
      if (clientDept && candidates.length > 1) {
        candidates = candidates.filter(u => {
          const userDept = String(u.department || u.team || u.departmentName || '').trim().toLowerCase();
          return userDept && userDept === clientDept;
        });
      }
      if (candidates.length === 1) return candidates[0]._id;
    }
    console.warn('[client-chat] unmatched member name:', target.name, 'for client:', client?.client || client?._id || 'unknown');
  }

  return null;
}

function collectClientManagerValues(client) {
  const list = [];
  const add = (val) => {
    if (!val) return;
    if (Array.isArray(val)) val.forEach(add);
    else list.push(val);
  };
  add(client.projectManager);
  add(client.projectManagers);
  add(client.assignedTo);
  add(client.accountManager);
  return list;
}

async function companyFor(client) {
  if (!client?.companyCode) return null;
  return require('../../models/Company').findOne({ companyCode: client.companyCode }).select('_id companyCode');
}

const RESYNC_AFTER_MS = 10 * 60 * 1000;
const notSyncedSince = (ms = RESYNC_AFTER_MS) => ({ clientSyncedAt: { $not: { $gte: new Date(Date.now() - ms) } } });

async function syncClient(clientId) {
  if (!clientId || !mongoose.isValidObjectId(clientId)) return null;
  const startedAt = new Date();
  const client = await Client().findById(clientId).lean();
  const existing = await Conversation.findOne({ clientId, projectId: { $exists: false } });
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
  const users = (await User.find({ company: company._id, isActive: { $ne: false } }).select('_id name email companyRole role jobRoleName employeeType department departmentName team')).filter(user => internal(user, client));
  const tasks = await Task().find({ clientId }).select('assigneeId assignee').lean();
  const rawManagers = collectClientManagerValues(client);
  const managers = ids(rawManagers.map(value => resolveMember(value, users, client)));
  const taskAssignees = ids(tasks.map(task => task.assigneeId ? users.find(user => id(user) === id(task.assigneeId))?._id : resolveMember(task.assignee, users, client)));
  const candidates = ids([...managers, ...taskAssignees]);
  const members = client.status === 'Inactive' ? [] : candidates;
  const query = { companyId: company._id, clientId, projectId: { $exists: false } };
  let conversation;
  const updatePayload = {
    $set: {
      groupName: client.client,
      isGroup: true,
      members,
      admins: managers.filter(member => members.includes(member)),
      clientSyncedAt: new Date(),
    },
    $setOnInsert: { createdAt: new Date(), updatedAt: new Date() },
  };
  try {
    conversation = await Conversation.findOneAndUpdate(query, updatePayload, { upsert: true, new: true, timestamps: false, setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    conversation = await Conversation.findOneAndUpdate(query, { $set: updatePayload.$set }, { new: true });
  }
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
  if (!taskId || !mongoose.isValidObjectId(taskId)) return;
  const task = await Task().findById(taskId).select('+chatOutbox').lean();
  if (!task) return;
  if (!task.clientId || !mongoose.isValidObjectId(task.clientId)) {
    console.warn('[client-chat] task has missing or invalid clientId', id(taskId));
    return;
  }
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
  // Client and task saves sync right away, so this pass only needs to catch
  // what they miss (deleted clients, deactivated users) and skips recent ones.
  for await (const conversation of Conversation.find({ clientId: { $exists: true }, 'members.0': { $exists: true }, ...notSyncedSince() }).select('clientId').lean().cursor()) {
    try { await syncClient(conversation.clientId); } catch (error) { console.error('[client-chat] refresh pending', error.message); }
  }
}

async function syncAllClients() {
  for await (const client of Client().find({}).select('_id').lean().cursor()) {
    try { await syncClient(client._id); }
    catch (error) { console.error('[client-chat] sync all error', id(client), error.message); }
  }
}

module.exports = { syncClient, RESYNC_AFTER_MS, drainTask, syncForUser, syncAllClients, sweep, companyFor, resolveMember, collectClientManagerValues, internal };


