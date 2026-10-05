const mongoose = require('mongoose');

/**
 * Enterprise Hybrid Denormalization & Real-Time Cascade Synchronization Engine
 * 
 * 1. Dual-Storage: Maintains relational Foreign Key IDs alongside indexed denormalized cached fields.
 * 2. Real-Time Cascade Engine: Batch updates (updateMany) all dependent child collections on primary updates.
 * 3. Auto-Resolution: Resolves string names -> ObjectIds and ObjectIds -> cached strings at creation/update.
 * 4. Zero Breaking Changes: Formats responses to match populated object structures with 0ms overhead.
 */

// Helper to check if a value is a valid ObjectId
const isObjectId = (val) => {
  if (!val) return false;
  if (val instanceof mongoose.Types.ObjectId) return true;
  return typeof val === 'string' && /^[a-fA-F0-9]{24}$/.test(val);
};

// Safe string trimmer
const safeString = (val) => (typeof val === 'string' ? val.trim() : '');

function safeUpdateMany(Model, filter, update) {
  if (!Model || typeof Model.updateMany !== 'function') return null;
  // If disconnected from MongoDB and Model.updateMany is the unmocked default, do not buffer
  if (mongoose.connection?.readyState === 0 && Model.updateMany === mongoose.Model.updateMany) {
    return null;
  }
  return Model.updateMany(filter, update);
}

function pushUpdate(updates, Model, filter, update) {
  const p = safeUpdateMany(Model, filter, update);
  if (p) updates.push(p);
}

/**
 * ============================================================================
 * 1. CASCADE ENGINE (DOUBLE-LAYER SYNC)
 * ============================================================================
 */

/**
 * Cascade updates when a User (agent / employee) is updated
 */
async function cascadeUserUpdate(userId, userData = {}) {
  if (!isObjectId(userId)) return;
  const uid = new mongoose.Types.ObjectId(String(userId));
  const name = safeString(userData.name);
  const email = safeString(userData.email);
  const role = safeString(userData.jobRole || userData.role || userData.companyRole);

  const updates = [];

  // 1. Sync Lead assignedTo, transferredFrom, transferredBy, createdBy fields
  const leadSet = {};
  if (name) leadSet.assignedToName = name;
  if (email) leadSet.assignedToEmail = email;
  if (role) leadSet.assignedToRole = role;
  if (Object.keys(leadSet).length > 0) {
    try {
      const Lead = mongoose.models.Lead || require('../models/Lead');
      pushUpdate(updates, Lead, { assignedTo: uid }, { $set: leadSet });
      if (name) {
        pushUpdate(updates, Lead, { transferredFrom: uid }, { $set: { transferredFromName: name } });
        pushUpdate(updates, Lead, { transferredBy: uid }, { $set: { transferredByName: name } });
        pushUpdate(updates, Lead, { createdBy: uid }, { $set: { createdByName: name, ...(email ? { createdByEmail: email } : {}) } });
      }
    } catch (e) {
      console.error('Error syncing Lead on User update:', e.message);
    }
  }

  // 2. Sync CallLog agent fields
  const callSet = {};
  if (name) callSet.agentName = name;
  if (email) callSet.agentEmail = email;
  if (role) callSet.agentRole = role;
  if (Object.keys(callSet).length > 0) {
    try {
      const CallLog = mongoose.models.CallLog || require('../models/CallLog');
      pushUpdate(updates, CallLog, { $or: [{ agent: uid }, { agentId: uid }] }, { $set: callSet });
    } catch (e) {
      console.error('Error syncing CallLog on User update:', e.message);
    }
  }

  // 3. Sync FollowUp agent fields
  const followSet = {};
  if (name) followSet.agentName = name;
  if (email) followSet.agentEmail = email;
  if (Object.keys(followSet).length > 0) {
    try {
      const FollowUp = mongoose.models.FollowUp || require('../models/Followup');
      pushUpdate(updates, FollowUp, { $or: [{ agent: uid }, { agentId: uid }] }, { $set: followSet });
    } catch (e) {
      console.error('Error syncing FollowUp on User update:', e.message);
    }
  }

  // 4. Sync LeadAssignmentHistory (fromUser, toUser, performedBy)
  try {
    const History = mongoose.models.LeadAssignmentHistory || require('../models/LeadAssignmentHistory');
    if (name || email) {
      const fromSet = {};
      const toSet = {};
      const perfSet = {};
      if (name) { fromSet.fromUserName = name; toSet.toUserName = name; perfSet.performedByName = name; }
      if (email) { fromSet.fromUserEmail = email; toSet.toUserEmail = email; perfSet.performedByEmail = email; }
      pushUpdate(updates, History, { fromUser: uid }, { $set: fromSet });
      pushUpdate(updates, History, { toUser: uid }, { $set: toSet });
      pushUpdate(updates, History, { performedBy: uid }, { $set: perfSet });
    }
  } catch (e) {
    console.error('Error syncing LeadAssignmentHistory on User update:', e.message);
  }

  // 5. Sync Department supportHead
  if (name) {
    try {
      const Department = mongoose.models.Department || require('../models/Department');
      pushUpdate(updates, Department, { supportHead: uid }, { $set: { supportHeadName: name } });
    } catch (e) {
      console.error('Error syncing Department on User update:', e.message);
    }
  }

  // 6. Sync SupportTicket requester & assignedTo
  try {
    const SupportTicket = mongoose.models.SupportTicket || require('../models/SupportTicket');
    const reqSet = {};
    const assignSet = {};
    if (name) { reqSet.requesterName = name; assignSet.assignedToName = name; }
    if (email) { reqSet.requesterEmail = email; assignSet.assignedToEmail = email; }
    if (Object.keys(reqSet).length > 0) pushUpdate(updates, SupportTicket, { requester: uid }, { $set: reqSet });
    if (Object.keys(assignSet).length > 0) pushUpdate(updates, SupportTicket, { assignedTo: uid }, { $set: assignSet });
  } catch (e) {
    console.error('Error syncing SupportTicket on User update:', e.message);
  }

  await Promise.allSettled(updates);
}

/**
 * Cascade updates when a Lead is updated (name, phone, email, source, type, status, address, gender, remarks)
 */
async function cascadeLeadUpdate(leadId, leadData = {}) {
  if (!isObjectId(leadId)) return;
  const lid = new mongoose.Types.ObjectId(String(leadId));

  const updates = [];

  const leadSet = {};
  if (leadData.name !== undefined) leadSet.leadName = safeString(leadData.name);
  if (leadData.phone !== undefined) leadSet.leadPhone = safeString(leadData.phone);
  if (leadData.email !== undefined) leadSet.leadEmail = safeString(leadData.email);
  if (leadData.status !== undefined) leadSet.leadStatus = safeString(leadData.status);
  if (leadData.leadSource !== undefined) leadSet.leadSource = leadData.leadSource;
  if (leadData.leadSourceName !== undefined || leadData.source !== undefined) {
    leadSet.leadSourceName = safeString(leadData.leadSourceName || leadData.source);
  }
  if (leadData.leadType !== undefined) leadSet.leadType = leadData.leadType;
  if (leadData.leadTypeName !== undefined) leadSet.leadTypeName = safeString(leadData.leadTypeName);
  if (leadData.address !== undefined) leadSet.leadAddress = safeString(leadData.address);
  if (leadData.gender !== undefined) leadSet.leadGender = safeString(leadData.gender);
  if (leadData.remarks !== undefined) leadSet.leadRemarks = safeString(leadData.remarks);

  if (Object.keys(leadSet).length === 0) return;

  // 1. Sync CallLog
  try {
    const CallLog = mongoose.models.CallLog || require('../models/CallLog');
    pushUpdate(updates, CallLog, { $or: [{ lead: lid }, { leadId: lid }] }, { $set: leadSet });
  } catch (e) {
    console.error('Error syncing CallLog on Lead update:', e.message);
  }

  // 2. Sync FollowUp
  try {
    const FollowUp = mongoose.models.FollowUp || require('../models/Followup');
    const followSet = { ...leadSet };
    delete followSet.leadAddress;
    delete followSet.leadGender;
    delete followSet.leadRemarks;
    pushUpdate(updates, FollowUp, { $or: [{ lead: lid }, { leadId: lid }] }, { $set: followSet });
  } catch (e) {
    console.error('Error syncing FollowUp on Lead update:', e.message);
  }

  // 3. Sync LeadAssignmentHistory
  try {
    const History = mongoose.models.LeadAssignmentHistory || require('../models/LeadAssignmentHistory');
    const histSet = {};
    if (leadSet.leadName) histSet.leadName = leadSet.leadName;
    if (leadSet.leadPhone) histSet.leadPhone = leadSet.leadPhone;
    if (leadSet.leadEmail) histSet.leadEmail = leadSet.leadEmail;
    if (leadSet.leadStatus) histSet.leadStatus = leadSet.leadStatus;
    if (leadSet.leadRemarks) histSet.leadRemarks = leadSet.leadRemarks;
    if (Object.keys(histSet).length > 0) {
      pushUpdate(updates, History, { $or: [{ lead: lid }, { leadId: lid }] }, { $set: histSet });
    }
  } catch (e) {
    console.error('Error syncing History on Lead update:', e.message);
  }

  await Promise.allSettled(updates);
}

/**
 * Cascade updates when a LeadSource is updated / renamed
 */
async function cascadeLeadSourceUpdate(sourceId, sourceData = {}) {
  if (!isObjectId(sourceId)) return;
  const sid = new mongoose.Types.ObjectId(String(sourceId));
  const name = safeString(typeof sourceData === 'string' ? sourceData : sourceData?.name);
  if (!name) return;

  const updates = [];
  try {
    const Lead = mongoose.models.Lead || require('../models/Lead');
    pushUpdate(updates, Lead, { leadSource: sid }, { $set: { leadSourceName: name, source: name } });
  } catch (e) {
    console.error('Error syncing Lead on LeadSource update:', e.message);
  }

  try {
    const CallLog = mongoose.models.CallLog || require('../models/CallLog');
    pushUpdate(updates, CallLog, { leadSource: sid }, { $set: { leadSourceName: name } });
  } catch (e) {
    console.error('Error syncing CallLog on LeadSource update:', e.message);
  }

  try {
    const FollowUp = mongoose.models.FollowUp || require('../models/Followup');
    pushUpdate(updates, FollowUp, { leadSource: sid }, { $set: { leadSourceName: name } });
  } catch (e) {
    console.error('Error syncing FollowUp on LeadSource update:', e.message);
  }

  await Promise.allSettled(updates);
}

/**
 * Cascade updates when a LeadType is updated / renamed
 */
async function cascadeLeadTypeUpdate(typeId, typeData = {}) {
  if (!isObjectId(typeId)) return;
  const tid = new mongoose.Types.ObjectId(String(typeId));
  const name = safeString(typeof typeData === 'string' ? typeData : typeData?.name);
  if (!name) return;

  const updates = [];
  try {
    const Lead = mongoose.models.Lead || require('../models/Lead');
    pushUpdate(updates, Lead, { leadType: tid }, { $set: { leadTypeName: name } });
  } catch (e) {
    console.error('Error syncing Lead on LeadType update:', e.message);
  }

  try {
    const CallLog = mongoose.models.CallLog || require('../models/CallLog');
    pushUpdate(updates, CallLog, { leadType: tid }, { $set: { leadTypeName: name } });
  } catch (e) {
    console.error('Error syncing CallLog on LeadType update:', e.message);
  }

  try {
    const FollowUp = mongoose.models.FollowUp || require('../models/Followup');
    pushUpdate(updates, FollowUp, { leadType: tid }, { $set: { leadTypeName: name } });
  } catch (e) {
    console.error('Error syncing FollowUp on LeadType update:', e.message);
  }

  await Promise.allSettled(updates);
}

/**
 * Cascade updates when a Department is updated / renamed
 */
async function cascadeDepartmentUpdate(deptId, deptData = {}) {
  if (!isObjectId(deptId)) return;
  const did = new mongoose.Types.ObjectId(String(deptId));
  const name = safeString(typeof deptData === 'string' ? deptData : deptData?.name);
  if (!name) return;

  const updates = [];
  try {
    const JobRole = mongoose.models.JobRole || require('../models/JobRole');
    pushUpdate(updates, JobRole, { department: did }, { $set: { departmentName: name } });
  } catch (e) {
    console.error('Error syncing JobRole on Department update:', e.message);
  }

  try {
    const SupportTicket = mongoose.models.SupportTicket || require('../models/SupportTicket');
    pushUpdate(updates, SupportTicket, { departmentId: did }, { $set: { department: name } });
  } catch (e) {
    console.error('Error syncing SupportTicket on Department update:', e.message);
  }

  try {
    const User = mongoose.models.User || require('../models/User');
    pushUpdate(updates, User, { department: String(deptId) }, { $set: { department: name } });
  } catch (e) {
    console.error('Error syncing User on Department update:', e.message);
  }

  await Promise.allSettled(updates);
}

/**
 * Cascade updates when a Branch is updated / renamed
 */
async function cascadeBranchUpdate(branchId, branchData = {}) {
  if (!isObjectId(branchId)) return;
  const bid = new mongoose.Types.ObjectId(String(branchId));
  const name = safeString(typeof branchData === 'string' ? branchData : branchData?.name);
  const code = safeString(branchData?.branchCode);

  const updates = [];
  const setObj = {};
  if (name) setObj.branchName = name;
  if (code) setObj.branchCode = code;

  if (Object.keys(setObj).length === 0) return;

  try {
    const Department = mongoose.models.Department || require('../models/Department');
    pushUpdate(updates, Department, { branch: bid }, { $set: setObj });
  } catch (e) {
    console.error('Error syncing Department on Branch update:', e.message);
  }

  if (code) {
    try {
      const User = mongoose.models.User || require('../models/User');
      pushUpdate(updates, User, { branch: bid }, { $set: { branchCode: code } });
    } catch (e) {
      console.error('Error syncing User on Branch update:', e.message);
    }
  }

  await Promise.allSettled(updates);
}

/**
 * ============================================================================
 * 2. CREATION TIME AUTO-RESOLUTION
 * ============================================================================
 */

/**
 * Auto-resolves foreign key ObjectIds and cached string names for Lead
 */
async function autoResolveLead(lead, companyId) {
  const company = companyId || lead.company;

  // 1. Resolve LeadSource
  if (lead.leadSource && isObjectId(lead.leadSource)) {
    if (!lead.leadSourceName || !lead.source) {
      try {
        const Source = mongoose.models.LeadSource || require('../models/LeadSource');
        const s = await Source.findById(lead.leadSource).select('name').lean();
        if (s) {
          lead.leadSourceName = s.name;
          if (!lead.source) lead.source = s.name;
        }
      } catch (e) {}
    }
  } else if (lead.source || lead.leadSourceName || (typeof lead.leadSource === 'string' && lead.leadSource)) {
    // Client sent string name instead of ObjectId
    const sourceName = lead.leadSourceName || lead.source || lead.leadSource;
    if (typeof sourceName === 'string' && !isObjectId(sourceName)) {
      try {
        const Source = mongoose.models.LeadSource || require('../models/LeadSource');
        const filter = { normalizedName: sourceName.trim().toLowerCase() };
        if (company) filter.company = company;
        const s = await Source.findOne(filter).select('_id name').lean();
        if (s) {
          lead.leadSource = s._id;
          lead.leadSourceName = s.name;
          lead.source = s.name;
        } else {
          lead.leadSourceName = sourceName;
          lead.source = sourceName;
        }
      } catch (e) {}
    }
  }

  // 2. Resolve LeadType
  if (lead.leadType && isObjectId(lead.leadType)) {
    if (!lead.leadTypeName) {
      try {
        const Type = mongoose.models.LeadType || require('../models/LeadType');
        const t = await Type.findById(lead.leadType).select('name').lean();
        if (t) lead.leadTypeName = t.name;
      } catch (e) {}
    }
  } else if (lead.leadTypeName || (typeof lead.leadType === 'string' && lead.leadType)) {
    // Client sent string name instead of ObjectId
    const typeName = lead.leadTypeName || lead.leadType;
    if (typeof typeName === 'string' && !isObjectId(typeName)) {
      try {
        const Type = mongoose.models.LeadType || require('../models/LeadType');
        const filter = { normalizedName: typeName.trim().toLowerCase() };
        if (company) filter.company = company;
        const t = await Type.findOne(filter).select('_id name').lean();
        if (t) {
          lead.leadType = t._id;
          lead.leadTypeName = t.name;
        } else {
          lead.leadTypeName = typeName;
        }
      } catch (e) {}
    }
  }

  // 3. Resolve assignedTo User
  if (lead.assignedTo && isObjectId(lead.assignedTo)) {
    if (!lead.assignedToName || !lead.assignedToEmail) {
      try {
        const User = mongoose.models.User || require('../models/User');
        const u = await User.findById(lead.assignedTo).select('name email jobRole role companyRole').lean();
        if (u) {
          lead.assignedToName = u.name;
          lead.assignedToEmail = u.email;
          lead.assignedToRole = u.jobRole || u.role || u.companyRole || 'Telecaller';
        }
      } catch (e) {}
    }
  } else if (typeof lead.assignedTo === 'string' && lead.assignedTo && !isObjectId(lead.assignedTo)) {
    // Client sent employee name or email
    try {
      const User = mongoose.models.User || require('../models/User');
      const query = {
        $or: [
          { email: lead.assignedTo.trim().toLowerCase() },
          { name: new RegExp(`^${lead.assignedTo.trim()}$`, 'i') }
        ]
      };
      if (company) query.company = company;
      const u = await User.findOne(query).select('_id name email jobRole role companyRole').lean();
      if (u) {
        lead.assignedTo = u._id;
        lead.assignedToName = u.name;
        lead.assignedToEmail = u.email;
        lead.assignedToRole = u.jobRole || u.role || u.companyRole || 'Telecaller';
      }
    } catch (e) {}
  }

  // 4. Resolve createdBy User
  if (lead.createdBy && isObjectId(lead.createdBy) && !lead.createdByName) {
    try {
      const User = mongoose.models.User || require('../models/User');
      const u = await User.findById(lead.createdBy).select('name email').lean();
      if (u) {
        lead.createdByName = u.name;
        lead.createdByEmail = u.email;
      }
    } catch (e) {}
  }

  return lead;
}

/**
 * Auto-resolves foreign key ObjectIds and cached string names for CallLog
 */
async function autoResolveCallLog(callLog) {
  // 1. Resolve Lead details
  if (callLog.lead && isObjectId(callLog.lead)) {
    if (!callLog.leadName || !callLog.leadPhone) {
      try {
        const Lead = mongoose.models.Lead || require('../models/Lead');
        const l = await Lead.findById(callLog.lead)
          .select('name phone email source leadSource leadSourceName leadType leadTypeName status address gender remarks')
          .lean();
        if (l) {
          callLog.leadName = l.name || '';
          callLog.leadPhone = l.phone || '';
          callLog.leadEmail = l.email || '';
          callLog.leadSource = l.leadSource || null;
          callLog.leadSourceName = l.leadSourceName || l.source || '';
          callLog.leadType = l.leadType || null;
          callLog.leadTypeName = l.leadTypeName || '';
          callLog.leadStatus = l.status || '';
          callLog.leadAddress = l.address || '';
          callLog.leadGender = l.gender || '';
          callLog.leadRemarks = l.remarks || '';
        }
      } catch (e) {}
    }
  }

  // 2. Resolve Agent User details
  if (callLog.agent && isObjectId(callLog.agent)) {
    if (!callLog.agentName || !callLog.agentEmail) {
      try {
        const User = mongoose.models.User || require('../models/User');
        const u = await User.findById(callLog.agent).select('name email jobRole role companyRole').lean();
        if (u) {
          callLog.agentName = u.name;
          callLog.agentEmail = u.email;
          callLog.agentRole = u.jobRole || u.role || u.companyRole || 'Telecaller';
        }
      } catch (e) {}
    }
  }

  return callLog;
}

/**
 * Auto-resolves foreign key ObjectIds and cached string names for FollowUp
 */
async function autoResolveFollowUp(followUp) {
  // 1. Resolve Lead details
  if (followUp.lead && isObjectId(followUp.lead)) {
    if (!followUp.leadName || !followUp.leadPhone) {
      try {
        const Lead = mongoose.models.Lead || require('../models/Lead');
        const l = await Lead.findById(followUp.lead)
          .select('name phone email source leadSource leadSourceName leadType leadTypeName status')
          .lean();
        if (l) {
          followUp.leadName = l.name || '';
          followUp.leadPhone = l.phone || '';
          followUp.leadEmail = l.email || '';
          followUp.leadSource = l.leadSource || null;
          followUp.leadSourceName = l.leadSourceName || l.source || '';
          followUp.leadType = l.leadType || null;
          followUp.leadTypeName = l.leadTypeName || '';
          followUp.leadStatus = l.status || '';
        }
      } catch (e) {}
    }
  }

  // 2. Resolve Agent User details
  if (followUp.agent && isObjectId(followUp.agent)) {
    if (!followUp.agentName || !followUp.agentEmail) {
      try {
        const User = mongoose.models.User || require('../models/User');
        const u = await User.findById(followUp.agent).select('name email').lean();
        if (u) {
          followUp.agentName = u.name;
          followUp.agentEmail = u.email;
        }
      } catch (e) {}
    }
  }

  return followUp;
}

/**
 * Auto-resolves foreign key ObjectIds and cached string names for LeadAssignmentHistory
 */
async function autoResolveLeadAssignmentHistory(history) {
  // 1. Resolve Lead
  if (history.lead && isObjectId(history.lead)) {
    if (!history.leadName || !history.leadPhone) {
      try {
        const Lead = mongoose.models.Lead || require('../models/Lead');
        const l = await Lead.findById(history.lead).select('name phone email status remarks').lean();
        if (l) {
          history.leadName = l.name || '';
          history.leadPhone = l.phone || '';
          history.leadEmail = l.email || '';
          history.leadStatus = l.status || '';
          history.leadRemarks = l.remarks || '';
        }
      } catch (e) {}
    }
  }

  // 2. Resolve Users
  try {
    const User = mongoose.models.User || require('../models/User');
    const userIds = [history.fromUser, history.toUser, history.performedBy].filter(isObjectId);
    if (userIds.length > 0) {
      const users = await User.find({ _id: { $in: userIds } }).select('name email').lean();
      const uMap = new Map(users.map(u => [String(u._id), u]));
      if (history.fromUser && uMap.has(String(history.fromUser))) {
        history.fromUserName = uMap.get(String(history.fromUser)).name;
        history.fromUserEmail = uMap.get(String(history.fromUser)).email;
      }
      if (history.toUser && uMap.has(String(history.toUser))) {
        history.toUserName = uMap.get(String(history.toUser)).name;
        history.toUserEmail = uMap.get(String(history.toUser)).email;
      }
      if (history.performedBy && uMap.has(String(history.performedBy))) {
        history.performedByName = uMap.get(String(history.performedBy)).name;
        history.performedByEmail = uMap.get(String(history.performedBy)).email;
      }
    }
  } catch (e) {}

  return history;
}

/**
 * Auto-resolves foreign key ObjectIds and cached string names for Department
 */
async function autoResolveDepartment(dept) {
  if (dept.branch && isObjectId(dept.branch) && (!dept.branchName || !dept.branchCode)) {
    try {
      const Branch = mongoose.models.Branch || require('../models/Branch');
      const b = await Branch.findById(dept.branch).select('name branchCode').lean();
      if (b) {
        dept.branchName = b.name;
        dept.branchCode = b.branchCode;
      }
    } catch (e) {}
  }
  if (dept.supportHead && isObjectId(dept.supportHead) && !dept.supportHeadName) {
    try {
      const User = mongoose.models.User || require('../models/User');
      const u = await User.findById(dept.supportHead).select('name').lean();
      if (u) dept.supportHeadName = u.name;
    } catch (e) {}
  }
  if (dept.createdBy && isObjectId(dept.createdBy) && !dept.createdByName) {
    try {
      const User = mongoose.models.User || require('../models/User');
      const u = await User.findById(dept.createdBy).select('name').lean();
      if (u) dept.createdByName = u.name;
    } catch (e) {}
  }
  return dept;
}

/**
 * Auto-resolves foreign key ObjectIds and cached string names for JobRole
 */
async function autoResolveJobRole(jobRole) {
  if (jobRole.department && isObjectId(jobRole.department) && !jobRole.departmentName) {
    try {
      const Department = mongoose.models.Department || require('../models/Department');
      const d = await Department.findById(jobRole.department).select('name').lean();
      if (d) jobRole.departmentName = d.name;
    } catch (e) {}
  }
  if (jobRole.createdBy && isObjectId(jobRole.createdBy) && !jobRole.createdByName) {
    try {
      const User = mongoose.models.User || require('../models/User');
      const u = await User.findById(jobRole.createdBy).select('name').lean();
      if (u) jobRole.createdByName = u.name;
    } catch (e) {}
  }
  return jobRole;
}

/**
 * ============================================================================
 * 3. ZERO BREAKING CHANGES RESPONSE FORMATTERS
 * ============================================================================
 * Formats plain documents into populated API shape in <0.001ms without DB calls.
 */

function formatLeadForClient(item) {
  if (!item) return item;

  const leadSourceId = item.leadSource?._id || item.leadSourceId || (isObjectId(item.leadSource) ? item.leadSource : null);
  const leadTypeId = item.leadType?._id || item.leadTypeId || (isObjectId(item.leadType) ? item.leadType : null);
  const assignedToId = item.assignedTo?._id || item.assignedToId || (isObjectId(item.assignedTo) ? item.assignedTo : null);

  // Preserve existing populated object if present, otherwise build from cached denormalized fields
  const leadSourceObj = (item.leadSource && typeof item.leadSource === 'object' && item.leadSource.name)
    ? item.leadSource
    : (leadSourceId || item.leadSourceName ? { _id: leadSourceId, name: item.leadSourceName || item.source || '' } : null);

  const leadTypeObj = (item.leadType && typeof item.leadType === 'object' && item.leadType.name)
    ? item.leadType
    : (leadTypeId || item.leadTypeName ? { _id: leadTypeId, name: item.leadTypeName || '' } : null);

  const assignedToObj = (item.assignedTo && typeof item.assignedTo === 'object' && item.assignedTo.name)
    ? item.assignedTo
    : (assignedToId || item.assignedToName ? {
        _id: assignedToId,
        name: item.assignedToName || '',
        email: item.assignedToEmail || '',
        jobRole: item.assignedToRole || 'Telecaller',
        role: item.assignedToRole || 'Telecaller'
      } : null);

  return {
    ...item,
    leadSourceId: leadSourceId ? String(leadSourceId) : (item.leadSourceId || null),
    leadSourceName: item.leadSourceName || (leadSourceObj ? leadSourceObj.name : '') || item.source || '',
    leadSource: leadSourceObj,
    source: item.source || item.leadSourceName || (leadSourceObj ? leadSourceObj.name : ''),
    leadTypeId: leadTypeId ? String(leadTypeId) : (item.leadTypeId || null),
    leadTypeName: item.leadTypeName || (leadTypeObj ? leadTypeObj.name : '') || '',
    leadType: leadTypeObj,
    assignedToId: assignedToId ? String(assignedToId) : (item.assignedToId || null),
    assignedToName: item.assignedToName || (assignedToObj ? assignedToObj.name : '') || '',
    assignedToEmail: item.assignedToEmail || (assignedToObj ? assignedToObj.email : '') || '',
    assignedTo: assignedToObj
  };
}

function formatCallLogForClient(item) {
  if (!item) return item;

  const leadId = item.lead?._id || item.leadId || (isObjectId(item.lead) ? item.lead : null);
  const agentId = item.agent?._id || item.agentId || (isObjectId(item.agent) ? item.agent : null);

  const leadSourceObj = (item.leadSource || item.leadSourceName)
    ? { _id: item.leadSource, name: item.leadSourceName || '' }
    : null;

  const leadTypeObj = (item.leadType || item.leadTypeName)
    ? { _id: item.leadType, name: item.leadTypeName || '' }
    : null;

  const leadObj = (item.lead && typeof item.lead === 'object' && item.lead.name)
    ? item.lead
    : {
        _id: leadId,
        name: item.leadName || '',
        phone: item.leadPhone || '',
        email: item.leadEmail || '',
        source: item.leadSourceName || '',
        leadSource: leadSourceObj,
        leadType: leadTypeObj,
        status: item.leadStatus || '',
        address: item.leadAddress || '',
        gender: item.leadGender || '',
        remarks: item.leadRemarks || ''
      };

  const agentObj = (item.agent && typeof item.agent === 'object' && item.agent.name)
    ? item.agent
    : (agentId || item.agentName ? {
        _id: agentId,
        name: item.agentName || '',
        email: item.agentEmail || '',
        jobRole: item.agentRole || ''
      } : null);

  return {
    ...item,
    leadId: leadId ? String(leadId) : (item.leadId || null),
    leadName: item.leadName || leadObj.name || '',
    leadPhone: item.leadPhone || leadObj.phone || '',
    leadEmail: item.leadEmail || leadObj.email || '',
    leadSourceName: item.leadSourceName || (leadSourceObj ? leadSourceObj.name : '') || '',
    leadTypeName: item.leadTypeName || (leadTypeObj ? leadTypeObj.name : '') || '',
    agentId: agentId ? String(agentId) : (item.agentId || null),
    agentName: item.agentName || (agentObj ? agentObj.name : '') || '',
    agentEmail: item.agentEmail || (agentObj ? agentObj.email : '') || '',
    lead: leadObj,
    agent: agentObj
  };
}

function formatFollowUpForClient(item) {
  if (!item) return item;

  const leadId = item.lead?._id || item.leadId || (isObjectId(item.lead) ? item.lead : null);
  const agentId = item.agent?._id || item.agentId || (isObjectId(item.agent) ? item.agent : null);

  const leadSourceObj = (item.leadSource || item.leadSourceName)
    ? { _id: item.leadSource, name: item.leadSourceName || '' }
    : null;

  const leadTypeObj = (item.leadType || item.leadTypeName)
    ? { _id: item.leadType, name: item.leadTypeName || '' }
    : null;

  const leadObj = (item.lead && typeof item.lead === 'object' && item.lead.name)
    ? item.lead
    : {
        _id: leadId,
        name: item.leadName || '',
        phone: item.leadPhone || '',
        email: item.leadEmail || '',
        source: item.leadSourceName || '',
        leadSource: leadSourceObj,
        leadType: leadTypeObj,
        status: item.leadStatus || ''
      };

  const agentObj = (item.agent && typeof item.agent === 'object' && item.agent.name)
    ? item.agent
    : (agentId || item.agentName ? {
        _id: agentId,
        name: item.agentName || '',
        email: item.agentEmail || ''
      } : null);

  return {
    ...item,
    leadId: leadId ? String(leadId) : (item.leadId || null),
    leadName: item.leadName || leadObj.name || '',
    leadPhone: item.leadPhone || leadObj.phone || '',
    leadEmail: item.leadEmail || leadObj.email || '',
    leadSourceName: item.leadSourceName || (leadSourceObj ? leadSourceObj.name : '') || '',
    leadTypeName: item.leadTypeName || (leadTypeObj ? leadTypeObj.name : '') || '',
    agentId: agentId ? String(agentId) : (item.agentId || null),
    agentName: item.agentName || (agentObj ? agentObj.name : '') || '',
    agentEmail: item.agentEmail || (agentObj ? agentObj.email : '') || '',
    lead: leadObj,
    agent: agentObj
  };
}

function formatAssignmentHistoryForClient(item) {
  if (!item) return item;

  const leadId = item.lead?._id || item.leadId || (isObjectId(item.lead) ? item.lead : null);
  const fromUserId = item.fromUser?._id || item.fromUserId || (isObjectId(item.fromUser) ? item.fromUser : null);
  const toUserId = item.toUser?._id || item.toUserId || (isObjectId(item.toUser) ? item.toUser : null);
  const performedById = item.performedBy?._id || item.performedById || (isObjectId(item.performedBy) ? item.performedBy : null);

  const leadObj = (item.lead && typeof item.lead === 'object' && item.lead.name)
    ? item.lead
    : {
        _id: leadId,
        name: item.leadName || '',
        phone: item.leadPhone || '',
        email: item.leadEmail || '',
        status: item.leadStatus || '',
        remarks: item.leadRemarks || ''
      };

  const fromUserObj = (item.fromUser && typeof item.fromUser === 'object' && item.fromUser.name)
    ? item.fromUser
    : (fromUserId || item.fromUserName ? {
        _id: fromUserId,
        name: item.fromUserName || '',
        email: item.fromUserEmail || ''
      } : null);

  const toUserObj = (item.toUser && typeof item.toUser === 'object' && item.toUser.name)
    ? item.toUser
    : (toUserId || item.toUserName ? {
        _id: toUserId,
        name: item.toUserName || '',
        email: item.toUserEmail || ''
      } : null);

  const performedByObj = (item.performedBy && typeof item.performedBy === 'object' && item.performedBy.name)
    ? item.performedBy
    : (performedById || item.performedByName ? {
        _id: performedById,
        name: item.performedByName || '',
        email: item.performedByEmail || ''
      } : null);

  return {
    ...item,
    leadId: leadId ? String(leadId) : (item.leadId || null),
    leadName: item.leadName || leadObj.name || '',
    leadPhone: item.leadPhone || leadObj.phone || '',
    fromUserId: fromUserId ? String(fromUserId) : (item.fromUserId || null),
    fromUserName: item.fromUserName || (fromUserObj ? fromUserObj.name : '') || '',
    toUserId: toUserId ? String(toUserId) : (item.toUserId || null),
    toUserName: item.toUserName || (toUserObj ? toUserObj.name : '') || '',
    performedById: performedById ? String(performedById) : (item.performedById || null),
    performedByName: item.performedByName || (performedByObj ? performedByObj.name : '') || '',
    lead: leadObj,
    fromUser: fromUserObj,
    toUser: toUserObj,
    performedBy: performedByObj
  };
}

module.exports = {
  isObjectId,
  cascadeUserUpdate,
  cascadeLeadUpdate,
  cascadeLeadSourceUpdate,
  cascadeLeadTypeUpdate,
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
};
