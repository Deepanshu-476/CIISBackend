const { id } = require('./projectChatEvents');
const { resolveMember, collectClientManagerValues, internal } = require('./clientChatService');

async function chatListAccess(companyId, userId) {
  const company = await require('../../models/Company').findById(companyId).select('companyCode').lean();
  if (!company) return { projects: [], clients: [] };
  const [{ Project }, Client, Task, User] = [
    require('../models/Project'), require('../models/Client'),
    require('../models/ClientTask'), require('../../models/User'),
  ];
  const [projects, clients, users] = await Promise.all([
    Project.find({ $and: [
      { $or: [{ company: companyId }, { company: null, companyCode: company.companyCode }] },
      { $or: [{ createdBy: userId }, { users: userId }, { managers: userId },
        { 'tasks.assignedTo': userId }, { 'tasks.assignedUsers': userId }] },
    ] }).select('_id').lean(),
    Client.find({ companyCode: company.companyCode, status: { $ne: 'Inactive' } })
      .select('_id userId client company projectManager projectManagers assignedTo accountManager status').lean(),
    User.find({ company: companyId, isActive: { $ne: false } })
      .select('_id name email companyRole role jobRoleName employeeType').lean(),
  ]);
  // An inactive user must never retain access through an old conversation.
  const currentUser = users.find(user => id(user) === id(userId));
  if (!currentUser) return { projects: [], clients: [] };
  const nameParts = String(currentUser.name || '').trim().split(/\s+/).filter(p => p.length >= 3);
  const aliasValues = [id(currentUser), currentUser.email, currentUser.name, ...nameParts].filter(Boolean);
  const aliases = aliasValues.map(value =>
    new RegExp(`^\\s*${String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  // Read distinct assignment relationships for this user, not every task in the
  // company. Thousands of tasks can share the same client/member relationship.
  const tasks = clients.length ? await Task.aggregate([
    { $match: { clientId: { $in: clients.map(client => client._id) },
      $or: [{ assigneeId: currentUser._id }, { assignee: { $in: aliases } }],
    } },
    { $group: { _id: { clientId: '$clientId', assigneeId: '$assigneeId', assignee: '$assignee' } } },
    { $project: { _id: 0, clientId: '$_id.clientId', assigneeId: '$_id.assigneeId', assignee: '$_id.assignee' } },
  ]) : [];
  const tasksByClient = new Map();
  for (const task of tasks) {
    const key = id(task.clientId);
    if (!tasksByClient.has(key)) tasksByClient.set(key, []);
    tasksByClient.get(key).push(task);
  }
  return {
    projects: projects.map(project => project._id),
    clients: clients.filter(client => {
      const candidates = users.filter(user => internal(user, client));
      const matchesUser = value => id(resolveMember(value, candidates)) === id(userId);
      const managerValues = collectClientManagerValues(client);
      return managerValues.some(matchesUser) ||
        (tasksByClient.get(id(client)) || []).some(task => task.assigneeId
          ? candidates.some(user => id(user) === id(task.assigneeId) && id(user) === id(userId))
          : matchesUser(task.assignee));
    }).map(client => client._id),
  };
}

const pendingAccessReads = new Map();
module.exports = function readAccess(companyId, userId) {
  const key = `${id(companyId)}:${id(userId)}`;
  if (pendingAccessReads.has(key)) return pendingAccessReads.get(key);
  const request = chatListAccess(companyId, userId).finally(() => pendingAccessReads.delete(key));
  pendingAccessReads.set(key, request);
  return request;
};

module.exports.filter = access => ({ $or: [
  { projectId: { $exists: false }, clientId: { $exists: false } },
  { projectId: { $in: access.projects } },
  { clientId: { $in: access.clients } },
] });
