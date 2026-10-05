/**
 * Enterprise Hybrid Denormalization Backfill Script
 * Backfills denormalized fields across historical records in:
 * - Lead
 * - CallLog
 * - FollowUp
 * - LeadAssignmentHistory
 * - Department
 * - JobRole
 */

const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const LeadAssignmentHistory = require('../models/LeadAssignmentHistory');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const User = require('../models/User');
const LeadSource = require('../models/LeadSource');
const LeadType = require('../models/LeadType');
const Branch = require('../models/Branch');

async function backfillDenormalizedData(options = {}) {
  const isDirectRun = require.main === module;
  if (mongoose.connection.readyState !== 1 && isDirectRun) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ciis';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB for backfill.');
  }

  const stats = {
    leadsUpdated: 0,
    callLogsUpdated: 0,
    followUpsUpdated: 0,
    historiesUpdated: 0,
    departmentsUpdated: 0,
    jobRolesUpdated: 0
  };

  console.log('🚀 Starting Enterprise Hybrid Denormalization Backfill...');

  // 1. Backfill Lead
  try {
    const leadsToUpdate = await Lead.find({
      $or: [
        { leadSourceName: { $exists: false } },
        { leadSourceName: '' },
        { leadTypeName: { $exists: false } },
        { leadTypeName: '' },
        { assignedToName: { $exists: false } },
        { createdByName: { $exists: false } }
      ]
    }).select('_id leadSource leadType assignedTo createdBy source leadSourceName leadTypeName assignedToName createdByName').lean();

    if (leadsToUpdate.length > 0) {
      console.log(`Processing ${leadsToUpdate.length} leads for backfill...`);
      const sourceIds = leadsToUpdate.map(l => l.leadSource).filter(Boolean);
      const typeIds = leadsToUpdate.map(l => l.leadType).filter(Boolean);
      const userIds = [
        ...leadsToUpdate.map(l => l.assignedTo).filter(Boolean),
        ...leadsToUpdate.map(l => l.createdBy).filter(Boolean)
      ];

      const [sources, types, users] = await Promise.all([
        LeadSource.find({ _id: { $in: sourceIds } }).select('name').lean(),
        LeadType.find({ _id: { $in: typeIds } }).select('name').lean(),
        User.find({ _id: { $in: userIds } }).select('name email role companyRole').lean()
      ]);

      const sourceMap = new Map(sources.map(s => [String(s._id), s.name]));
      const typeMap = new Map(types.map(t => [String(t._id), t.name]));
      const userMap = new Map(users.map(u => [String(u._id), u]));

      const bulkOps = [];
      for (const lead of leadsToUpdate) {
        const setFields = {};
        if (lead.leadSource && sourceMap.has(String(lead.leadSource))) {
          setFields.leadSourceName = sourceMap.get(String(lead.leadSource));
        } else if (lead.source && !lead.leadSourceName) {
          setFields.leadSourceName = lead.source;
        }

        if (lead.leadType && typeMap.has(String(lead.leadType))) {
          setFields.leadTypeName = typeMap.get(String(lead.leadType));
        }

        if (lead.assignedTo && userMap.has(String(lead.assignedTo))) {
          const u = userMap.get(String(lead.assignedTo));
          setFields.assignedToName = u.name || '';
          setFields.assignedToEmail = u.email || '';
          setFields.assignedToRole = u.role || u.companyRole || '';
        }

        if (lead.createdBy && userMap.has(String(lead.createdBy))) {
          const u = userMap.get(String(lead.createdBy));
          setFields.createdByName = u.name || '';
          setFields.createdByEmail = u.email || '';
        }

        if (Object.keys(setFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: lead._id },
              update: { $set: setFields }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const res = await Lead.bulkWrite(bulkOps);
        stats.leadsUpdated = res.modifiedCount || bulkOps.length;
      }
    }
  } catch (err) {
    console.error('Error backfilling leads:', err.message);
  }

  // 2. Backfill CallLog
  try {
    const callLogsToUpdate = await CallLog.find({
      $or: [
        { leadName: { $exists: false } },
        { leadName: '' },
        { agentName: { $exists: false } },
        { agentName: '' }
      ]
    }).select('_id lead agent leadName agentName').lean();

    if (callLogsToUpdate.length > 0) {
      console.log(`Processing ${callLogsToUpdate.length} call logs for backfill...`);
      const leadIds = callLogsToUpdate.map(c => c.lead).filter(Boolean);
      const agentIds = callLogsToUpdate.map(c => c.agent).filter(Boolean);

      const [leads, agents] = await Promise.all([
        Lead.find({ _id: { $in: leadIds } })
          .select('name phone email status source leadSource leadSourceName leadType leadTypeName address gender remarks')
          .lean(),
        User.find({ _id: { $in: agentIds } }).select('name email role companyRole').lean()
      ]);

      const leadMap = new Map(leads.map(l => [String(l._id), l]));
      const agentMap = new Map(agents.map(a => [String(a._id), a]));

      const bulkOps = [];
      for (const log of callLogsToUpdate) {
        const setFields = {};
        if (log.lead && leadMap.has(String(log.lead))) {
          const l = leadMap.get(String(log.lead));
          setFields.leadName = l.name || '';
          setFields.leadPhone = l.phone || '';
          setFields.leadEmail = l.email || '';
          setFields.leadStatus = l.status || '';
          setFields.leadSource = l.leadSource || null;
          setFields.leadSourceName = l.leadSourceName || l.source || '';
          setFields.leadType = l.leadType || null;
          setFields.leadTypeName = l.leadTypeName || '';
          setFields.leadAddress = l.address || '';
          setFields.leadGender = l.gender || '';
          setFields.leadRemarks = l.remarks || '';
        }

        if (log.agent && agentMap.has(String(log.agent))) {
          const a = agentMap.get(String(log.agent));
          setFields.agentName = a.name || '';
          setFields.agentEmail = a.email || '';
          setFields.agentRole = a.role || a.companyRole || '';
        }

        if (Object.keys(setFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: log._id },
              update: { $set: setFields }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const res = await CallLog.bulkWrite(bulkOps);
        stats.callLogsUpdated = res.modifiedCount || bulkOps.length;
      }
    }
  } catch (err) {
    console.error('Error backfilling call logs:', err.message);
  }

  // 3. Backfill FollowUp
  try {
    const followUpsToUpdate = await FollowUp.find({
      $or: [
        { leadName: { $exists: false } },
        { leadName: '' },
        { agentName: { $exists: false } },
        { agentName: '' }
      ]
    }).select('_id lead agent leadName agentName').lean();

    if (followUpsToUpdate.length > 0) {
      console.log(`Processing ${followUpsToUpdate.length} follow-ups for backfill...`);
      const leadIds = followUpsToUpdate.map(f => f.lead).filter(Boolean);
      const agentIds = followUpsToUpdate.map(f => f.agent).filter(Boolean);

      const [leads, agents] = await Promise.all([
        Lead.find({ _id: { $in: leadIds } })
          .select('name phone email status source leadSource leadSourceName leadType leadTypeName')
          .lean(),
        User.find({ _id: { $in: agentIds } }).select('name email').lean()
      ]);

      const leadMap = new Map(leads.map(l => [String(l._id), l]));
      const agentMap = new Map(agents.map(a => [String(a._id), a]));

      const bulkOps = [];
      for (const follow of followUpsToUpdate) {
        const setFields = {};
        if (follow.lead && leadMap.has(String(follow.lead))) {
          const l = leadMap.get(String(follow.lead));
          setFields.leadName = l.name || '';
          setFields.leadPhone = l.phone || '';
          setFields.leadEmail = l.email || '';
          setFields.leadStatus = l.status || '';
          setFields.leadSource = l.leadSource || null;
          setFields.leadSourceName = l.leadSourceName || l.source || '';
          setFields.leadType = l.leadType || null;
          setFields.leadTypeName = l.leadTypeName || '';
        }

        if (follow.agent && agentMap.has(String(follow.agent))) {
          const a = agentMap.get(String(follow.agent));
          setFields.agentName = a.name || '';
          setFields.agentEmail = a.email || '';
        }

        if (Object.keys(setFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: follow._id },
              update: { $set: setFields }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const res = await FollowUp.bulkWrite(bulkOps);
        stats.followUpsUpdated = res.modifiedCount || bulkOps.length;
      }
    }
  } catch (err) {
    console.error('Error backfilling follow-ups:', err.message);
  }

  // 4. Backfill LeadAssignmentHistory
  try {
    const historiesToUpdate = await LeadAssignmentHistory.find({
      $or: [
        { leadName: { $exists: false } },
        { leadName: '' },
        { toUserName: { $exists: false } },
        { toUserName: '' }
      ]
    }).select('_id lead fromUser toUser performedBy leadName toUserName').lean();

    if (historiesToUpdate.length > 0) {
      console.log(`Processing ${historiesToUpdate.length} assignment history rows for backfill...`);
      const leadIds = historiesToUpdate.map(h => h.lead).filter(Boolean);
      const userIds = [
        ...historiesToUpdate.map(h => h.fromUser).filter(Boolean),
        ...historiesToUpdate.map(h => h.toUser).filter(Boolean),
        ...historiesToUpdate.map(h => h.performedBy).filter(Boolean)
      ];

      const [leads, users] = await Promise.all([
        Lead.find({ _id: { $in: leadIds } }).select('name phone email status remarks').lean(),
        User.find({ _id: { $in: userIds } }).select('name email').lean()
      ]);

      const leadMap = new Map(leads.map(l => [String(l._id), l]));
      const userMap = new Map(users.map(u => [String(u._id), u]));

      const bulkOps = [];
      for (const history of historiesToUpdate) {
        const setFields = {};
        if (history.lead && leadMap.has(String(history.lead))) {
          const l = leadMap.get(String(history.lead));
          setFields.leadName = l.name || '';
          setFields.leadPhone = l.phone || '';
          setFields.leadEmail = l.email || '';
          setFields.leadStatus = l.status || '';
          setFields.leadRemarks = l.remarks || '';
        }

        if (history.fromUser && userMap.has(String(history.fromUser))) {
          const u = userMap.get(String(history.fromUser));
          setFields.fromUserName = u.name || '';
          setFields.fromUserEmail = u.email || '';
        }

        if (history.toUser && userMap.has(String(history.toUser))) {
          const u = userMap.get(String(history.toUser));
          setFields.toUserName = u.name || '';
          setFields.toUserEmail = u.email || '';
        }

        if (history.performedBy && userMap.has(String(history.performedBy))) {
          const u = userMap.get(String(history.performedBy));
          setFields.performedByName = u.name || '';
          setFields.performedByEmail = u.email || '';
        }

        if (Object.keys(setFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: history._id },
              update: { $set: setFields }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const res = await LeadAssignmentHistory.bulkWrite(bulkOps);
        stats.historiesUpdated = res.modifiedCount || bulkOps.length;
      }
    }
  } catch (err) {
    console.error('Error backfilling assignment histories:', err.message);
  }

  // 5. Backfill Department
  try {
    const deptsToUpdate = await Department.find({
      $or: [
        { branchName: { $exists: false } },
        { branchName: '' },
        { createdByName: { $exists: false } }
      ]
    }).select('_id branch createdBy branchName createdByName').lean();

    if (deptsToUpdate.length > 0) {
      console.log(`Processing ${deptsToUpdate.length} departments for backfill...`);
      const branchIds = deptsToUpdate.map(d => d.branch).filter(Boolean);
      const userIds = deptsToUpdate.map(d => d.createdBy).filter(Boolean);

      const [branches, users] = await Promise.all([
        Branch.find({ _id: { $in: branchIds } }).select('name branchCode').lean(),
        User.find({ _id: { $in: userIds } }).select('name email').lean()
      ]);

      const branchMap = new Map(branches.map(b => [String(b._id), b]));
      const userMap = new Map(users.map(u => [String(u._id), u]));

      const bulkOps = [];
      for (const dept of deptsToUpdate) {
        const setFields = {};
        if (dept.branch && branchMap.has(String(dept.branch))) {
          const b = branchMap.get(String(dept.branch));
          setFields.branchName = b.name;
          if (!dept.branchCode) setFields.branchCode = b.branchCode;
        }
        if (dept.createdBy && userMap.has(String(dept.createdBy))) {
          setFields.createdByName = userMap.get(String(dept.createdBy)).name;
        }

        if (Object.keys(setFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: dept._id },
              update: { $set: setFields }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const res = await Department.bulkWrite(bulkOps);
        stats.departmentsUpdated = res.modifiedCount || bulkOps.length;
      }
    }
  } catch (err) {
    console.error('Error backfilling departments:', err.message);
  }

  // 6. Backfill JobRole
  try {
    const jobRolesToUpdate = await JobRole.find({
      $or: [
        { departmentName: { $exists: false } },
        { departmentName: '' },
        { createdByName: { $exists: false } }
      ]
    }).select('_id department createdBy departmentName createdByName').lean();

    if (jobRolesToUpdate.length > 0) {
      console.log(`Processing ${jobRolesToUpdate.length} job roles for backfill...`);
      const deptIds = jobRolesToUpdate.map(j => j.department).filter(Boolean);
      const userIds = jobRolesToUpdate.map(j => j.createdBy).filter(Boolean);

      const [depts, users] = await Promise.all([
        Department.find({ _id: { $in: deptIds } }).select('name').lean(),
        User.find({ _id: { $in: userIds } }).select('name').lean()
      ]);

      const deptMap = new Map(depts.map(d => [String(d._id), d.name]));
      const userMap = new Map(users.map(u => [String(u._id), u.name]));

      const bulkOps = [];
      for (const role of jobRolesToUpdate) {
        const setFields = {};
        if (role.department && deptMap.has(String(role.department))) {
          setFields.departmentName = deptMap.get(String(role.department));
        }
        if (role.createdBy && userMap.has(String(role.createdBy))) {
          setFields.createdByName = userMap.get(String(role.createdBy));
        }

        if (Object.keys(setFields).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: role._id },
              update: { $set: setFields }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const res = await JobRole.bulkWrite(bulkOps);
        stats.jobRolesUpdated = res.modifiedCount || bulkOps.length;
      }
    }
  } catch (err) {
    console.error('Error backfilling job roles:', err.message);
  }

  console.log('✅ Backfill complete. Stats:', stats);
  return stats;
}

if (require.main === module) {
  backfillDenormalizedData()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Backfill error:', err);
      process.exit(1);
    });
}

module.exports = backfillDenormalizedData;
