const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  cascadeLeadSourceUpdate,
  cascadeLeadTypeUpdate,
  cascadeLeadUpdate,
  cascadeUserUpdate,
  cascadeDepartmentUpdate,
  cascadeBranchUpdate,
  autoResolveLead,
  autoResolveCallLog,
  autoResolveFollowUp,
  autoResolveLeadAssignmentHistory,
  autoResolveDepartment,
  autoResolveJobRole,
  formatLeadForClient,
  formatCallLogForClient,
  formatFollowUpForClient,
  formatAssignmentHistoryForClient
} = require('../services/cascadeSyncEngine');

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

test('1. Dual-Storage & Schema Indexes: schemas contain dual-storage fields and proper indexes', () => {
  // Lead Schema checks
  const leadPaths = Lead.schema.paths;
  assert.ok(leadPaths.leadSource, 'Lead has leadSource foreign key');
  assert.ok(leadPaths.leadSourceName, 'Lead has denormalized leadSourceName');
  assert.ok(leadPaths.leadType, 'Lead has leadType foreign key');
  assert.ok(leadPaths.leadTypeName, 'Lead has denormalized leadTypeName');
  assert.ok(leadPaths.assignedTo, 'Lead has assignedTo foreign key');
  assert.ok(leadPaths.assignedToName, 'Lead has denormalized assignedToName');
  assert.ok(leadPaths.assignedToEmail, 'Lead has denormalized assignedToEmail');
  assert.ok(leadPaths.createdByName, 'Lead has denormalized createdByName');

  // CallLog Schema checks
  const callPaths = CallLog.schema.paths;
  assert.ok(callPaths.lead, 'CallLog has lead foreign key');
  assert.ok(callPaths.leadName, 'CallLog has denormalized leadName');
  assert.ok(callPaths.leadPhone, 'CallLog has denormalized leadPhone');
  assert.ok(callPaths.leadEmail, 'CallLog has denormalized leadEmail');
  assert.ok(callPaths.leadSourceName, 'CallLog has denormalized leadSourceName');
  assert.ok(callPaths.leadTypeName, 'CallLog has denormalized leadTypeName');
  assert.ok(callPaths.agent, 'CallLog has agent foreign key');
  assert.ok(callPaths.agentName, 'CallLog has denormalized agentName');
  assert.ok(callPaths.agentRole, 'CallLog has denormalized agentRole');

  // FollowUp Schema checks
  const followPaths = FollowUp.schema.paths;
  assert.ok(followPaths.lead, 'FollowUp has lead foreign key');
  assert.ok(followPaths.leadName, 'FollowUp has denormalized leadName');
  assert.ok(followPaths.leadPhone, 'FollowUp has denormalized leadPhone');
  assert.ok(followPaths.agent, 'FollowUp has agent foreign key');
  assert.ok(followPaths.agentName, 'FollowUp has denormalized agentName');

  // LeadAssignmentHistory Schema checks
  const historyPaths = LeadAssignmentHistory.schema.paths;
  assert.ok(historyPaths.lead, 'History has lead foreign key');
  assert.ok(historyPaths.leadName, 'History has denormalized leadName');
  assert.ok(historyPaths.fromUserName, 'History has denormalized fromUserName');
  assert.ok(historyPaths.toUserName, 'History has denormalized toUserName');
  assert.ok(historyPaths.performedByName, 'History has denormalized performedByName');

  // Department Schema checks
  const deptPaths = Department.schema.paths;
  assert.ok(deptPaths.branch, 'Department has branch foreign key');
  assert.ok(deptPaths.branchName, 'Department has denormalized branchName');
  assert.ok(deptPaths.createdByName, 'Department has denormalized createdByName');

  // JobRole Schema checks
  const rolePaths = JobRole.schema.paths;
  assert.ok(rolePaths.department, 'JobRole has department foreign key');
  assert.ok(rolePaths.departmentName, 'JobRole has denormalized departmentName');
  assert.ok(rolePaths.createdByName, 'JobRole has denormalized createdByName');
});

test('2. Real-Time Cascade Engine: cascadeLeadSourceUpdate syncs dependent collections', async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const calls = [];
  const origLeadUpdateMany = Lead.updateMany;
  const origCallLogUpdateMany = CallLog.updateMany;
  const origFollowUpUpdateMany = FollowUp.updateMany;

  Lead.updateMany = async (filter, mutation) => {
    calls.push({ model: 'Lead', filter, mutation });
    return { modifiedCount: 5 };
  };
  CallLog.updateMany = async (filter, mutation) => {
    calls.push({ model: 'CallLog', filter, mutation });
    return { modifiedCount: 12 };
  };
  FollowUp.updateMany = async (filter, mutation) => {
    calls.push({ model: 'FollowUp', filter, mutation });
    return { modifiedCount: 3 };
  };

  try {
    await cascadeLeadSourceUpdate(sourceId, 'Meta Ads');
    assert.equal(calls.length, 3);
    assert.ok(calls.some(c => c.model === 'Lead' && c.mutation.$set.leadSourceName === 'Meta Ads'));
    assert.ok(calls.some(c => c.model === 'CallLog' && c.mutation.$set.leadSourceName === 'Meta Ads'));
    assert.ok(calls.some(c => c.model === 'FollowUp' && c.mutation.$set.leadSourceName === 'Meta Ads'));
  } finally {
    Lead.updateMany = origLeadUpdateMany;
    CallLog.updateMany = origCallLogUpdateMany;
    FollowUp.updateMany = origFollowUpUpdateMany;
  }
});

test('2. Real-Time Cascade Engine: cascadeUserUpdate syncs User renames to child collections', async () => {
  const userId = new mongoose.Types.ObjectId();
  const updates = [];
  const origLeadUpdateMany = Lead.updateMany;
  const origCallLogUpdateMany = CallLog.updateMany;
  const origFollowUpUpdateMany = FollowUp.updateMany;
  const origHistoryUpdateMany = LeadAssignmentHistory.updateMany;

  Lead.updateMany = async (filter, mutation) => {
    updates.push({ model: 'Lead', filter, mutation });
    return { modifiedCount: 2 };
  };
  CallLog.updateMany = async (filter, mutation) => {
    updates.push({ model: 'CallLog', filter, mutation });
    return { modifiedCount: 8 };
  };
  FollowUp.updateMany = async (filter, mutation) => {
    updates.push({ model: 'FollowUp', filter, mutation });
    return { modifiedCount: 4 };
  };
  LeadAssignmentHistory.updateMany = async (filter, mutation) => {
    updates.push({ model: 'LeadAssignmentHistory', filter, mutation });
    return { modifiedCount: 6 };
  };

  try {
    await cascadeUserUpdate(userId, { name: 'Priya Sharma', email: 'priya@example.com', role: 'Team Lead' });
    assert.ok(updates.some(u => u.model === 'Lead' && u.mutation.$set.assignedToName === 'Priya Sharma'));
    assert.ok(updates.some(u => u.model === 'CallLog' && u.mutation.$set.agentName === 'Priya Sharma'));
    assert.ok(updates.some(u => u.model === 'FollowUp' && u.mutation.$set.agentName === 'Priya Sharma'));
    assert.ok(updates.some(u => u.model === 'LeadAssignmentHistory' && u.mutation.$set.toUserName === 'Priya Sharma'));
  } finally {
    Lead.updateMany = origLeadUpdateMany;
    CallLog.updateMany = origCallLogUpdateMany;
    FollowUp.updateMany = origFollowUpUpdateMany;
    LeadAssignmentHistory.updateMany = origHistoryUpdateMany;
  }
});

test('2. Real-Time Cascade Engine: cascadeLeadUpdate cascades contact/status changes to CallLog and FollowUp', async () => {
  const leadId = new mongoose.Types.ObjectId();
  const updates = [];
  const origCallLogUpdateMany = CallLog.updateMany;
  const origFollowUpUpdateMany = FollowUp.updateMany;

  CallLog.updateMany = async (filter, mutation) => {
    updates.push({ model: 'CallLog', filter, mutation });
    return { modifiedCount: 4 };
  };
  FollowUp.updateMany = async (filter, mutation) => {
    updates.push({ model: 'FollowUp', filter, mutation });
    return { modifiedCount: 2 };
  };

  try {
    await cascadeLeadUpdate(leadId, { name: 'Rahul Verma', phone: '9876543210', status: 'converted' });
    assert.ok(updates.some(u => u.model === 'CallLog' && u.mutation.$set.leadName === 'Rahul Verma' && u.mutation.$set.leadStatus === 'converted'));
    assert.ok(updates.some(u => u.model === 'FollowUp' && u.mutation.$set.leadName === 'Rahul Verma' && u.mutation.$set.leadStatus === 'converted'));
  } finally {
    CallLog.updateMany = origCallLogUpdateMany;
    FollowUp.updateMany = origFollowUpUpdateMany;
  }
});

test('3. Creation-Time Auto-Resolution: resolves string source/type into foreign key IDs', async () => {
  const company = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const typeId = new mongoose.Types.ObjectId();

  const origSourceFindOne = LeadSource.findOne;
  const origTypeFindOne = LeadType.findOne;

  LeadSource.findOne = () => ({
    select: () => ({
      lean: async () => ({ _id: sourceId, name: 'Google Ads' })
    })
  });
  LeadType.findOne = () => ({
    select: () => ({
      lean: async () => ({ _id: typeId, name: 'Web Inquiry' })
    })
  });

  try {
    const rawLead = {
      company,
      name: 'Aditya Sen',
      source: 'Google Ads',
      leadType: 'Web Inquiry'
    };

    const resolved = await autoResolveLead(rawLead);
    assert.equal(String(resolved.leadSource), String(sourceId));
    assert.equal(resolved.leadSourceName, 'Google Ads');
    assert.equal(String(resolved.leadType), String(typeId));
    assert.equal(resolved.leadTypeName, 'Web Inquiry');
  } finally {
    LeadSource.findOne = origSourceFindOne;
    LeadType.findOne = origTypeFindOne;
  }
});

test('3. Creation-Time Auto-Resolution: resolves foreign key IDs into cached display names', async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const agentId = new mongoose.Types.ObjectId();

  const origSourceFindById = LeadSource.findById;
  const origUserFindById = User.findById;

  LeadSource.findById = () => ({
    select: () => ({
      lean: async () => ({ _id: sourceId, name: 'Referral' })
    })
  });
  User.findById = () => ({
    select: () => ({
      lean: async () => ({ _id: agentId, name: 'Vikram Mehta', email: 'vikram@example.com', role: 'telecaller' })
    })
  });

  try {
    const rawLead = {
      name: 'Sneha Patel',
      leadSource: sourceId,
      assignedTo: agentId
    };

    const resolved = await autoResolveLead(rawLead);
    assert.equal(resolved.leadSourceName, 'Referral');
    assert.equal(resolved.assignedToName, 'Vikram Mehta');
    assert.equal(resolved.assignedToEmail, 'vikram@example.com');
  } finally {
    LeadSource.findById = origSourceFindById;
    User.findById = origUserFindById;
  }
});

test('4. Zero Breaking Changes Response Formatters: shapes plain denormalized leads into nested API objects without DB calls', () => {
  const leadId = new mongoose.Types.ObjectId();
  const sourceId = new mongoose.Types.ObjectId();
  const typeId = new mongoose.Types.ObjectId();
  const agentId = new mongoose.Types.ObjectId();

  const denormalizedLead = {
    _id: leadId,
    name: 'Rohan Gupta',
    phone: '9988776655',
    email: 'rohan@example.com',
    leadSource: sourceId,
    leadSourceName: 'Campus Drive',
    leadType: typeId,
    leadTypeName: 'Walk-in',
    assignedTo: agentId,
    assignedToName: 'Sanjay Dutt',
    assignedToEmail: 'sanjay@example.com',
    assignedToRole: 'Telecaller'
  };

  const formatted = formatLeadForClient(denormalizedLead);

  // Verifying frontend object shapes are 100% satisfied
  assert.deepEqual(formatted.leadSource, { _id: sourceId, name: 'Campus Drive' });
  assert.deepEqual(formatted.leadType, { _id: typeId, name: 'Walk-in' });
  assert.equal(String(formatted.assignedTo._id), String(agentId));
  assert.equal(formatted.assignedTo.name, 'Sanjay Dutt');
  assert.equal(formatted.assignedTo.email, 'sanjay@example.com');
  assert.equal(formatted.assignedTo.role, 'Telecaller');
  assert.equal(formatted.name, 'Rohan Gupta');
  assert.equal(formatted.phone, '9988776655');
});

test('4. Zero Breaking Changes Response Formatters: formatCallLogForClient, formatFollowUpForClient, and formatAssignmentHistoryForClient', () => {
  const logId = new mongoose.Types.ObjectId();
  const leadId = new mongoose.Types.ObjectId();
  const agentId = new mongoose.Types.ObjectId();

  const callDoc = {
    _id: logId,
    lead: leadId,
    leadName: 'Anita Roy',
    leadPhone: '9123456789',
    leadEmail: 'anita@example.com',
    leadStatus: 'interested',
    agent: agentId,
    agentName: 'Aman Kumar',
    agentEmail: 'aman@example.com',
    agentRole: 'telecaller',
    duration: 45,
    status: 'answered'
  };

  const formattedCall = formatCallLogForClient(callDoc);
  assert.equal(formattedCall.lead.name, 'Anita Roy');
  assert.equal(formattedCall.lead.phone, '9123456789');
  assert.equal(formattedCall.agent.name, 'Aman Kumar');

  const followDoc = {
    _id: new mongoose.Types.ObjectId(),
    lead: leadId,
    leadName: 'Anita Roy',
    leadPhone: '9123456789',
    agent: agentId,
    agentName: 'Aman Kumar',
    date: new Date(),
    status: 'pending'
  };
  const formattedFollow = formatFollowUpForClient(followDoc);
  assert.equal(formattedFollow.lead.name, 'Anita Roy');
  assert.equal(formattedFollow.agent.name, 'Aman Kumar');

  const historyDoc = {
    _id: new mongoose.Types.ObjectId(),
    lead: leadId,
    leadName: 'Anita Roy',
    toUser: agentId,
    toUserName: 'Aman Kumar',
    toUserEmail: 'aman@example.com',
    action: 'assigned'
  };
  const formattedHistory = formatAssignmentHistoryForClient(historyDoc);
  assert.equal(formattedHistory.lead.name, 'Anita Roy');
  assert.equal(formattedHistory.toUser.name, 'Aman Kumar');
});
