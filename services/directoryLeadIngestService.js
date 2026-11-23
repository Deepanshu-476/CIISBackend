const mongoose = require('mongoose');
const Company = require('../models/Company');
const Lead = require('../models/Lead');
const LeadSource = require('../models/LeadSource');
const User = require('../models/User');
const Client = require('../HR-CDS/models/Client');
const History = require('../models/LeadAssignmentHistory');
const { invalidateCrmListSummaries } = require('./crmListQuery');
const { canSeeAllBranches } = require('../utils/branchScope');

function phoneKey(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function phonePattern(phone = '') {
  const local = phoneKey(phone);
  if (!local || local.length < 10) return null;
  const joined = local.split('').join('[ ().-]*');
  return new RegExp(`(?:(?:\\+|00)?91[ ().-]*)?${joined}`);
}

async function findCompany(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).trim();
  if (mongoose.isValidObjectId(cleanId)) {
    const comp = await Company.findById(cleanId);
    if (comp) return comp;
  }
  return Company.findOne({ companyCode: cleanId.toUpperCase() });
}

async function getOrCreateLeadSource(companyId, sourceName) {
  try {
    let source = await LeadSource.findOne({
      company: companyId,
      name: { $regex: new RegExp(`^${sourceName}$`, 'i') }
    });
    if (!source) {
      source = await LeadSource.create({
        company: companyId,
        name: sourceName,
        status: 'Active',
        isSystem: true
      });
    }
    return source;
  } catch (err) {
    return null;
  }
}

async function chooseAssignee(companyId) {
  try {
    const filter = { company: companyId, isActive: true, companyRole: { $not: /^client$/i } };
    const candidates = await User.find(filter).select('name email jobRole companyRole role').lean();
    if (!candidates.length) return null;

    const clients = new Set(
      (await Client.distinct('userId', { userId: { $in: candidates.map(u => u._id) } })).map(String)
    );
    const eligible = candidates.filter(u => !clients.has(String(u._id)));
    if (!eligible.length) return null;

    // Pick assignee with least active leads
    const loads = await Lead.aggregate([
      {
        $match: {
          company: companyId,
          assignedTo: { $in: eligible.map(u => u._id) },
          status: { $nin: ['closed', 'converted', 'not interested'] }
        }
      },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
    ]);
    const counts = new Map(loads.map(r => [String(r._id), r.count]));
    return eligible.sort((a, b) => (counts.get(String(a._id)) || 0) - (counts.get(String(b._id)) || 0))[0];
  } catch {
    return null;
  }
}

async function notifyUsers(lead, company, sourceName) {
  try {
    const notifications = require('../HR-CDS/utils/systemNotificationService');
    const common = {
      title: `New ${sourceName} Lead`,
      message: `${lead.name || 'A customer'} sent an enquiry from ${sourceName}.`,
      type: 'lead_assigned',
      company: company._id,
      data: { leadId: String(lead._id) }
    };

    if (lead.assignedTo) {
      await Promise.all([
        History.create({
          company: company._id,
          lead: lead._id,
          toUser: lead.assignedTo,
          action: 'assigned',
          method: 'single',
          reason: `${sourceName} Auto Lead Integration`
        }),
        notifications.notifyDirectUsers({
          ...common,
          userIds: [lead.assignedTo],
          targetPath: '/ciisUser/telecaller/assigned-calls',
          targetScreen: 'My Assigned Calls'
        })
      ]);
    } else {
      const admins = (
        await User.find({ company: company._id, isActive: true })
          .select('companyRole isSuperAdmin superAdmin')
          .lean()
      ).filter(canSeeAllBranches);

      if (admins.length) {
        await notifications.notifyDirectUsers({
          ...common,
          userIds: admins.map(u => u._id),
          targetPath: '/ciisUser/crm/admin/all-leads'
        });
      }
    }
  } catch (err) {
    console.error(`Failed to send ${sourceName} notifications:`, err.message);
  }
}

/**
 * Ingest IndiaMART enquiry
 */
async function ingestIndiaMartLead(companyIdentifier, rawPayload) {
  const company = await findCompany(companyIdentifier);
  if (!company || company.isActive === false) {
    throw new Error('Company was not found or is currently inactive.');
  }

  // Handle single item or array of items
  const payload = Array.isArray(rawPayload)
    ? rawPayload[0]
    : rawPayload?.response && Array.isArray(rawPayload.response)
    ? rawPayload.response[0]
    : rawPayload;

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid IndiaMART payload.');
  }

  const name =
    payload.SENDER_NAME ||
    payload.SENDERNAME ||
    payload.sender_name ||
    payload.GLUSR_USR_COMPANYNAME ||
    'IndiaMART Buyer';

  const phone =
    payload.SENDER_MOBILE ||
    payload.SENDERMOBILE ||
    payload.sender_mobile ||
    payload.MOBILE ||
    payload.GLUSR_USR_MOBILE ||
    '';

  const email =
    payload.SENDER_EMAIL ||
    payload.SENDEREMAIL ||
    payload.sender_email ||
    payload.EMAIL ||
    '';

  const address = [
    payload.SENDER_ADDRESS || payload.address,
    payload.SENDER_CITY || payload.city,
    payload.SENDER_STATE || payload.state,
    payload.SENDER_PINCODE || payload.pincode,
    payload.SENDER_COUNTRY_ISO || payload.country
  ]
    .filter(Boolean)
    .join(', ');

  const product =
    payload.PRODUCT_NAME ||
    payload.PRODUCTNAME ||
    payload.product_name ||
    payload.SUBJECT ||
    payload.subject ||
    '';

  const message =
    payload.QUERY_MESSAGE ||
    payload.QUERYMESSAGE ||
    payload.query_message ||
    payload.ENQ_MESSAGE ||
    payload.message ||
    payload.ENQ_DESC ||
    '';

  const externalLeadId = String(
    payload.QUERY_ID ||
    payload.QUERYID ||
    payload.query_id ||
    payload.ENQ_ID ||
    payload.GLUSR_USR_ID ||
    Date.now()
  );

  // Capture all fields into Ad Form Answers
  const answers = [];
  if (product) answers.push({ label: 'Product Name', value: String(product) });
  if (message) answers.push({ label: 'Requirement / Query', value: String(message) });
  if (payload.SENDER_COMPANY || payload.company_name) {
    answers.push({ label: 'Buyer Company', value: String(payload.SENDER_COMPANY || payload.company_name) });
  }
  if (payload.SENDER_CITY || payload.city) {
    answers.push({ label: 'City', value: String(payload.SENDER_CITY || payload.city) });
  }
  if (payload.SENDER_STATE || payload.state) {
    answers.push({ label: 'State', value: String(payload.SENDER_STATE || payload.state) });
  }
  if (payload.SENDER_PINCODE || payload.pincode) {
    answers.push({ label: 'Pincode', value: String(payload.SENDER_PINCODE || payload.pincode) });
  }
  if (payload.CALL_DURATION) {
    answers.push({ label: 'Call Duration', value: `${payload.CALL_DURATION} seconds` });
  }
  if (payload.QUERY_TIME || payload.query_time) {
    answers.push({ label: 'Query Time', value: String(payload.QUERY_TIME || payload.query_time) });
  }

  // Also include any extra custom keys
  for (const [key, val] of Object.entries(payload)) {
    if (
      val &&
      typeof val === 'string' &&
      !['SENDER_NAME', 'SENDER_MOBILE', 'SENDER_EMAIL', 'PRODUCT_NAME', 'QUERY_MESSAGE', 'QUERY_ID'].includes(key) &&
      !answers.some(a => a.label.toLowerCase() === key.toLowerCase())
    ) {
      if (answers.length < 15) {
        answers.push({ label: key.replace(/_/g, ' '), value: String(val).slice(0, 200) });
      }
    }
  }

  const remarks = [
    product ? `Product: ${product}` : '',
    message ? `Requirement: ${message}` : '',
    address ? `Location: ${address}` : '',
    payload.SENDER_COMPANY ? `Company: ${payload.SENDER_COMPANY}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  // Check duplicate externalLeadId
  const existingExternal = await Lead.findOne({
    company: company._id,
    'marketing.platform': 'indiamart',
    'marketing.externalLeadId': externalLeadId
  });
  if (existingExternal) {
    return { success: true, status: 'duplicate', leadId: existingExternal._id };
  }

  // Duplicate contact check
  const pPattern = phonePattern(phone);
  const matchFilter = [];
  if (email) matchFilter.push({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (pPattern) matchFilter.push({ phone: pPattern });

  let isDuplicate = false;
  if (matchFilter.length) {
    const matchedContact = await Lead.findOne({ company: company._id, $or: matchFilter }).select('_id').lean();
    if (matchedContact) isDuplicate = true;
  }

  const leadSourceDoc = await getOrCreateLeadSource(company._id, 'IndiaMART');
  const assignee = await chooseAssignee(company._id);

  const newLead = await Lead.create({
    company: company._id,
    name: name.slice(0, 100),
    phone: phoneKey(phone) || phone,
    email: email ? email.toLowerCase().trim() : undefined,
    address: address.slice(0, 250),
    remarks: remarks.slice(0, 1000),
    source: 'IndiaMART',
    leadSource: leadSourceDoc?._id || undefined,
    leadSourceName: 'IndiaMART',
    status: isDuplicate ? 'follow-up' : 'new',
    assignedTo: assignee?._id || null,
    assignedAt: assignee ? new Date() : undefined,
    createdByName: 'IndiaMART Integration',
    adContactEmail: email || undefined,
    adContactPhone: phoneKey(phone) || undefined,
    marketing: {
      platform: 'indiamart',
      channel: 'IndiaMART Marketplace',
      formName: product ? `IndiaMART - ${product}` : 'IndiaMART Direct Lead',
      externalLeadId: externalLeadId,
      answers: answers
    }
  });

  // Update company last received timestamp
  await Company.updateOne(
    { _id: company._id },
    { $set: { 'leadIntegrations.indiamart.lastLeadReceivedAt': new Date() } }
  );

  invalidateCrmListSummaries();
  await notifyUsers(newLead, company, 'IndiaMART');

  return { success: true, status: isDuplicate ? 'duplicate' : 'created', leadId: newLead._id };
}

/**
 * Ingest Justdial lead
 */
async function ingestJustdialLead(companyIdentifier, rawPayload) {
  const company = await findCompany(companyIdentifier);
  if (!company || company.isActive === false) {
    throw new Error('Company was not found or is currently inactive.');
  }

  const payload = rawPayload || {};

  const name =
    [payload.prefix, payload.name || payload.leadname].filter(Boolean).join(' ') ||
    payload.customer_name ||
    'Justdial Lead';

  const phone =
    payload.mobile ||
    payload.phone ||
    payload.leadmobile ||
    payload.dncmobile ||
    '';

  const email =
    payload.email ||
    payload.leademail ||
    '';

  const address = [
    payload.area,
    payload.city,
    payload.pincode,
    payload.branch
  ]
    .filter(Boolean)
    .join(', ');

  const category =
    payload.category ||
    payload.search_key ||
    payload.leadtype ||
    payload.product ||
    '';

  const comments =
    payload.comments ||
    payload.requirement ||
    payload.search_key ||
    '';

  const externalLeadId = String(
    payload.leadid ||
    payload.lead_id ||
    payload.id ||
    Date.now()
  );

  // Capture all fields into Ad Form Answers
  const answers = [];
  if (category) answers.push({ label: 'Category / Service', value: String(category) });
  if (comments) answers.push({ label: 'Comments / Requirement', value: String(comments) });
  if (payload.area) answers.push({ label: 'Area', value: String(payload.area) });
  if (payload.city) answers.push({ label: 'City', value: String(payload.city) });
  if (payload.pincode) answers.push({ label: 'Pincode', value: String(payload.pincode) });
  if (payload.leadtype) answers.push({ label: 'Lead Type', value: String(payload.leadtype) });
  if (payload.date || payload.time) {
    answers.push({ label: 'Enquiry Date/Time', value: `${payload.date || ''} ${payload.time || ''}`.trim() });
  }

  // Include extra fields
  for (const [key, val] of Object.entries(payload)) {
    if (
      val &&
      typeof val === 'string' &&
      !['name', 'mobile', 'phone', 'email', 'category', 'comments', 'leadid', 'prefix'].includes(key) &&
      !answers.some(a => a.label.toLowerCase() === key.toLowerCase())
    ) {
      if (answers.length < 15) {
        answers.push({ label: key.replace(/_/g, ' '), value: String(val).slice(0, 200) });
      }
    }
  }

  const remarks = [
    category ? `Category: ${category}` : '',
    comments ? `Requirement: ${comments}` : '',
    address ? `Location: ${address}` : '',
    payload.leadtype ? `Lead Type: ${payload.leadtype}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  // Check duplicate externalLeadId
  const existingExternal = await Lead.findOne({
    company: company._id,
    'marketing.platform': 'justdial',
    'marketing.externalLeadId': externalLeadId
  });
  if (existingExternal) {
    return { success: true, status: 'duplicate', leadId: existingExternal._id };
  }

  // Duplicate contact check
  const pPattern = phonePattern(phone);
  const matchFilter = [];
  if (email) matchFilter.push({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (pPattern) matchFilter.push({ phone: pPattern });

  let isDuplicate = false;
  if (matchFilter.length) {
    const matchedContact = await Lead.findOne({ company: company._id, $or: matchFilter }).select('_id').lean();
    if (matchedContact) isDuplicate = true;
  }

  const leadSourceDoc = await getOrCreateLeadSource(company._id, 'Justdial');
  const assignee = await chooseAssignee(company._id);

  const newLead = await Lead.create({
    company: company._id,
    name: name.slice(0, 100),
    phone: phoneKey(phone) || phone,
    email: email ? email.toLowerCase().trim() : undefined,
    address: address.slice(0, 250),
    remarks: remarks.slice(0, 1000),
    source: 'Justdial',
    leadSource: leadSourceDoc?._id || undefined,
    leadSourceName: 'Justdial',
    status: isDuplicate ? 'follow-up' : 'new',
    assignedTo: assignee?._id || null,
    assignedAt: assignee ? new Date() : undefined,
    createdByName: 'Justdial Integration',
    adContactEmail: email || undefined,
    adContactPhone: phoneKey(phone) || undefined,
    marketing: {
      platform: 'justdial',
      channel: 'Justdial Local Search',
      formName: category ? `Justdial - ${category}` : 'Justdial Direct Lead',
      externalLeadId: externalLeadId,
      answers: answers
    }
  });

  // Update company last received timestamp
  await Company.updateOne(
    { _id: company._id },
    { $set: { 'leadIntegrations.justdial.lastLeadReceivedAt': new Date() } }
  );

  invalidateCrmListSummaries();
  await notifyUsers(newLead, company, 'Justdial');

  return { success: true, status: isDuplicate ? 'duplicate' : 'created', leadId: newLead._id };
}

module.exports = {
  ingestIndiaMartLead,
  ingestJustdialLead
};
