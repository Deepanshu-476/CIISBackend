const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const JobRole = require('../models/JobRole');
const LeadAssignmentHistory = require('../models/LeadAssignmentHistory');
const { telecallerFilter, telecallerUserIds } = require('../utils/telecallerUsers');

const activeEmployeeFilter = (company, userIds, excludedClientIds = []) => ({
  ...telecallerFilter(company, userIds),
  ...(excludedClientIds.length ? { _id: { $nin: excludedClientIds } } : {}),
});

const validActor = req => {
  const id = req.user?._id || req.user?.id;
  return mongoose.isValidObjectId(id) ? id : null;
};

const teamFields = 'name email role jobRole companyRole';

const excludedClientIds = async () => {
  try {
    const Client = mongoose.models.Client || require('../HR-CDS/models/Client');
    const clients = await Client.find({ userId: { $exists: true, $ne: null } }).select('userId').lean();
    return clients.map(client => client.userId).filter(Boolean);
  } catch {
    return [];
  }
};

exports.overview = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const excluded = await excludedClientIds();
    const eligibleIds = await telecallerUserIds(company);
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 100);
    const search = String(req.query.search || '').trim().slice(0, 100);
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filterType = req.query.filter || 'unassigned';
    const statusFilter = filterType === 'assigned'
      ? { assignedTo: { $ne: null } }
      : filterType === 'all'
        ? {}
        : { assignedTo: null };
    const unassignedFilter = { company, ...statusFilter, ...(search ? { $or: [
      { name: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } }, { address: { $regex: escaped, $options: 'i' } }
    ] } : {}) };
    const [total, assigned, team, unassignedTotal, unassigned, recent, jobRoles] = await Promise.all([
      Lead.countDocuments({ company }),
      Lead.countDocuments({ company, assignedTo: { $ne: null } }),
      User.find(activeEmployeeFilter(company, eligibleIds, excluded)).select(teamFields).sort({ name: 1 }).lean(),
      Lead.countDocuments(unassignedFilter),
      Lead.find(unassignedFilter).select('name email phone address source status leadDate leadType leadSource assignedTo gender remarks createdAt')
        .populate('leadType', 'name').populate('leadSource', 'name').populate('assignedTo', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      LeadAssignmentHistory.find({ company }).sort({ createdAt: -1 }).limit(20)
        .populate('lead', 'name phone').populate('fromUser', 'name').populate('toUser', 'name')
        .populate('performedBy', 'name').lean(),
      JobRole.find({ company }).select('name').lean()
    ]);
    const roleNamesById = new Map(jobRoles.map(role => [String(role._id), role.name]));
    const resolvedTeam = team.map(user => {
      const rawRoles = [user.jobRole, user.companyRole, user.role].filter(Boolean);
      const assignmentRole = rawRoles.map(value => roleNamesById.get(String(value))).find(Boolean)
        || rawRoles.find(value => !mongoose.isValidObjectId(String(value)))
        || 'Other';
      return { ...user, assignmentRole };
    });
    res.json({
      metrics: { total, assigned, unassigned: total - assigned, activeAgents: resolvedTeam.length },
      unassigned,
      pagination: { page, limit, total: unassignedTotal, pages: Math.max(Math.ceil(unassignedTotal / limit), 1) },
      recent,
      team: resolvedTeam
    });
  } catch (error) { next(error); }
};

exports.bulkAssign = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const excluded = await excludedClientIds();
    const eligibleIds = await telecallerUserIds(company);
    const leadIds = [...new Set(Array.isArray(req.body.leadIds) ? req.body.leadIds.map(String) : [])];
    const method = req.body.method;
    const reason = String(req.body?.reason || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!leadIds.length || leadIds.length > 500 || leadIds.some(id => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'Select between 1 and 500 valid leads.' });
    }
    if (!['specific', 'round-robin', 'load-balanced', 'equal-distribution'].includes(method)) {
      return res.status(400).json({ message: 'Choose a valid assignment method.' });
    }

    const foundLeads = await Lead.find({ _id: { $in: leadIds }, company }).select('_id assignedTo assignedAt').lean();
    const leadsById = new Map(foundLeads.map(lead => [String(lead._id), lead]));
    const leads = leadIds.map(id => leadsById.get(id)).filter(Boolean);
    if (leads.length !== leadIds.length) return res.status(404).json({ message: 'One or more selected leads were not found.' });
    if (leads.some(lead => lead.assignedTo) && !reason) {
      return res.status(400).json({ message: 'Enter a transfer reason before reassigning selected leads.' });
    }

    let agents;
    if (method === 'equal-distribution') {
      const agentIds = [...new Set(Array.isArray(req.body.agentIds) ? req.body.agentIds.map(String) : [])];
      if (!agentIds.length || agentIds.length > 500 || agentIds.some(id => !mongoose.isValidObjectId(id))) {
        return res.status(400).json({ message: 'Select at least one valid user for equal distribution.' });
      }
      agents = await User.find({ $and: [
        activeEmployeeFilter(company, eligibleIds, excluded),
        { _id: { $in: agentIds } }
      ] }).select(teamFields).lean();
      if (agents.length !== agentIds.length) {
        return res.status(400).json({ message: 'One or more selected users are not eligible for lead assignment.' });
      }
      const agentsById = new Map(agents.map(agent => [String(agent._id), agent]));
      agents = agentIds.map(id => agentsById.get(id));
    } else if (method === 'specific') {
      if (!mongoose.isValidObjectId(req.body.agentId)) return res.status(400).json({ message: 'Select a valid telecaller.' });
      if (excluded.some(id => String(id) === String(req.body.agentId))) {
        return res.status(400).json({ message: 'Client accounts cannot receive lead assignments.' });
      }
      agents = await User.find({ $and: [
        activeEmployeeFilter(company, eligibleIds, excluded),
        { _id: req.body.agentId }
      ] }).select(teamFields).lean();
    } else {
      agents = await User.find(activeEmployeeFilter(company, eligibleIds, excluded)).select(teamFields).sort({ name: 1, _id: 1 }).lean();
    }
    if (!agents.length) return res.status(400).json({ message: 'No active telecallers are available for assignment.' });

    const counts = new Map(agents.map(agent => [String(agent._id), 0]));
    if (method === 'load-balanced') {
      const workload = await Lead.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)), assignedTo: { $in: agents.map(agent => agent._id) }, status: { $nin: ['converted', 'closed'] } } },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
      ]);
      workload.forEach(item => counts.set(String(item._id), item.count));
    }

    const now = new Date();
    const actor = validActor(req);
    const assignments = leads.map((lead, index) => {
      let agent;
      if (method === 'specific') agent = agents[0];
      else if (method === 'round-robin' || method === 'equal-distribution') agent = agents[index % agents.length];
      else {
        agent = agents.reduce((best, candidate) => counts.get(String(candidate._id)) < counts.get(String(best._id)) ? candidate : best, agents[0]);
        counts.set(String(agent._id), counts.get(String(agent._id)) + 1);
      }
      return { lead, agent };
    });

    if (assignments.some(({ lead, agent }) => lead.assignedTo && String(lead.assignedTo) === String(agent._id))) {
      return res.status(400).json({ message: 'One or more leads are already assigned to the selected telecaller. Choose a different telecaller.' });
    }

    await Lead.bulkWrite(assignments.map(({ lead, agent }) => ({
      updateOne: { filter: { _id: lead._id, company }, update: { $set: { assignedTo: agent._id, assignedAt: now } } }
    })));
    try {
      await LeadAssignmentHistory.insertMany(assignments.map(({ lead, agent }) => ({
        company,
        lead: lead._id,
        fromUser: lead.assignedTo || null,
        toUser: agent._id,
        performedBy: actor,
        action: lead.assignedTo ? 'reassigned' : 'assigned',
        method,
        reason: lead.assignedTo ? reason : ''
      })));
    } catch (historyError) {
      await Lead.bulkWrite(assignments.map(({ lead }) => ({
        updateOne: { filter: { _id: lead._id, company }, update: { $set: { assignedTo: lead.assignedTo || null, assignedAt: lead.assignedAt || null } } }
      })));
      throw historyError;
    }

    if (mongoose.connection?.readyState === 1) {
      try {
        const { notifyDirectUsers } = require('../HR-CDS/utils/systemNotificationService');
        const assignmentsByAgent = assignments.reduce((map, assignment) => {
          const key = String(assignment.agent._id);
          map.set(key, (map.get(key) || 0) + 1);
          return map;
        }, new Map());
        await Promise.all([...assignmentsByAgent].map(([userId, count]) => notifyDirectUsers({
          userIds: [userId],
          targetPath: '/ciisUser/telecaller/assigned-calls',
          targetScreen: 'My Assigned Calls',
          type: reason ? 'lead_transferred' : 'lead_assigned',
          title: reason ? `${count} lead(s) transferred to you` : (count === 1 ? 'New lead assigned' : `${count} leads assigned`),
          message: reason ? `${count} lead(s) were transferred to you. Reason: ${reason}` : `${count} lead(s) were assigned to you.`,
          actor,
          company,
          data: { count, reason }
        })));
      } catch (notificationError) {
        console.error('Bulk assignment notification failed:', notificationError.message);
      }
    }

    res.json({ message: `${assignments.length} lead(s) assigned successfully.`, assigned: assignments.length });
  } catch (error) { next(error); }
};

exports.history = async (req, res, next) => {
  try {
    const filter = { company: req.crmCompany };
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
    if (req.query.action && ['assigned', 'reassigned', 'unassigned'].includes(req.query.action)) filter.action = req.query.action;
    if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) {
      filter.$or = [{ fromUser: req.query.userId }, { toUser: req.query.userId }];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00.000+05:30`);
      if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999+05:30`);
    }
    const [items, total] = await Promise.all([
      LeadAssignmentHistory.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('lead', 'name phone email status').populate('fromUser', 'name email')
        .populate('toUser', 'name email').populate('performedBy', 'name email').lean(),
      LeadAssignmentHistory.countDocuments(filter)
    ]);
    res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  } catch (error) { next(error); }
};

exports.workload = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const excluded = await excludedClientIds();
    const eligibleIds = await telecallerUserIds(company);
    const [team, grouped] = await Promise.all([
      User.find(activeEmployeeFilter(company, eligibleIds, excluded)).select(teamFields).sort({ name: 1 }).lean(),
      Lead.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)), assignedTo: { $ne: null } } },
        { $group: {
          _id: '$assignedTo',
          assigned: { $sum: 1 },
          completed: { $sum: { $cond: [{ $in: ['$status', ['converted', 'closed']] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          followUps: { $sum: { $cond: [{ $ne: ['$nextFollowUp', null] }, 1, 0] } },
          lastActivity: { $max: '$updatedAt' }
        } }
      ])
    ]);
    const byUser = new Map(grouped.map(item => [String(item._id), item]));
    const agents = team.map(user => {
      const row = byUser.get(String(user._id)) || {};
      const assigned = row.assigned || 0;
      const completed = row.completed || 0;
      return { ...user, assigned, completed, pending: assigned - completed, converted: row.converted || 0,
        followUps: row.followUps || 0, conversion: assigned ? Math.round((row.converted || 0) * 1000 / assigned) / 10 : 0,
        lastActivity: row.lastActivity || null };
    });
    const totals = agents.reduce((sum, agent) => ({ assigned: sum.assigned + agent.assigned, completed: sum.completed + agent.completed,
      pending: sum.pending + agent.pending, converted: sum.converted + agent.converted }), { assigned: 0, completed: 0, pending: 0, converted: 0 });
    res.json({ agents, totals });
  } catch (error) { next(error); }
};
