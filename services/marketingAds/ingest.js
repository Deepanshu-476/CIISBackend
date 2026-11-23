const Integration = require('../../models/AdIntegration');
const Delivery = require('../../models/AdLeadWebhookLog');
const Lead = require('../../models/Lead');
const User = require('../../models/User');
const Company = require('../../models/Company');
const Client = require('../../HR-CDS/models/Client');
const History = require('../../models/LeadAssignmentHistory');
const { invalidateCrmListSummaries } = require('../crmListQuery');
const { canSeeAllBranches } = require('../../utils/branchScope');
const { normalize, numericId, phoneKey } = require('./normalize');
const { metaLead } = require('./providers');
const { open, problem, random, seal } = require('./security');

const MAX_ATTEMPTS = 5;
const DAY = 86400000;

async function enqueue(connection, externalLeadId, payload, test = false) {
  const scope = { company: connection.company, platform: connection.platform };
  const formId = numericId(payload.form_id);
  if (test) {
    const now = new Date();
    await Promise.all([
      Delivery.create({ ...scope, integration: connection._id, formId, status: 'test', processedAt: now, expiresAt: new Date(+now + 30 * DAY) }),
      Integration.updateOne({ _id: connection._id, company: connection.company }, { $max: { lastWebhookTestAt: now } })
    ]);
    return;
  }
  const filter = { ...scope, externalLeadId };
  try {
    await Delivery.create({
      ...filter, integration: connection._id, formId, payload: seal(payload),
      status: 'queued', availableAt: new Date()
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await Delivery.updateOne(filter, { $inc: { duplicates: 1 } });
  }
}

function phonePattern(phone) {
  const digits = phone.replace(/\D/g, '');
  const local = phoneKey(phone);
  const joined = number => number.split('').join('[ ().-]*');
  const body = local.length === 10 && /^[6-9]/.test(local) && (phone === local || phone.startsWith('+91'))
    ? `(?:(?:\\+|00)?91[ ().-]*)?${joined(local)}`
    : `${phone.startsWith('+') ? '(?:\\+|00)?' : ''}${joined(digits)}`;
  return new RegExp(`^[ ().-]*${body}[ ().-]*$`);
}

function duplicateContact(company, data) {
  const matches = [];
  if (data.email) {
    const escaped = data.email.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    matches.push({ email: new RegExp(`^${escaped}$`, 'i') });
  }
  if (data.phone) matches.push({ phone: phonePattern(data.phone) });
  return matches.length
    ? Lead.findOne({ company, $or: matches }).sort({ createdAt: 1 }).select('_id').lean()
    : null;
}

async function chooseAssignee(connection) {
  const { company, assignedTo, department, branch } = connection;
  if (!assignedTo && !department && !branch) return null;
  const filter = { company, isActive: true, companyRole: { $not: /^client$/i } };
  const fields = 'name email jobRole companyRole role';
  if (assignedTo) {
    const user = await User.findOne({ ...filter, _id: assignedTo }).select(fields).lean();
    if (user && !await Client.exists({ userId: user._id })) return user;
  }
  if (!department && !branch) return null;
  if (department) filter.department = department;
  if (branch) filter.$or = [{ branch }, { assignedBranches: branch }];
  const candidates = await User.find(filter).select(fields).lean();
  const clients = new Set((await Client.distinct('userId', { userId: { $in: candidates.map(user => user._id) } })).map(String));
  const eligible = candidates.filter(user => !clients.has(String(user._id)));
  if (!eligible.length) return null;
  const loads = await Lead.aggregate([
    { $match: { company, assignedTo: { $in: eligible.map(user => user._id) }, status: { $nin: ['closed', 'converted', 'not interested'] } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
  ]);
  const counts = new Map(loads.map(row => [String(row._id), row.count]));
  return eligible.sort((a, b) => (counts.get(String(a._id)) || 0) - (counts.get(String(b._id)) || 0) ||
    String(a._id).localeCompare(String(b._id)))[0];
}

async function recordActivity(lead, assignee, connection) {
  const notifications = require('../../HR-CDS/utils/systemNotificationService');
  const common = {
    title: 'New ads lead', message: `${lead.name || 'A lead'} arrived from ${lead.source}.`,
    type: 'lead_assigned', company: lead.company, actor: connection.createdBy,
    data: { leadId: String(lead._id) }
  };
  if (assignee) {
    return Promise.all([
      History.create({
        company: lead.company, lead: lead._id, toUser: assignee._id,
        performedBy: connection.createdBy, action: 'assigned', method: 'single', reason: 'Marketing Ads connection'
      }),
      notifications.notifyDirectUsers({ ...common, userIds: [assignee._id],
        targetPath: '/ciisUser/telecaller/assigned-calls', targetScreen: 'My Assigned Calls' })
    ]);
  }
  const admins = (await User.find({ company: lead.company, isActive: true }).select('companyRole isSuperAdmin superAdmin').lean())
    .filter(canSeeAllBranches);
  return notifications.notifyDirectUsers({
    ...common, userIds: admins.map(user => user._id), targetPath: '/ciisUser/crm/admin/all-leads'
  });
}

async function processDelivery(delivery) {
  const { company, platform, externalLeadId } = delivery;
  const externalFilter = { company, 'marketing.platform': platform, 'marketing.externalLeadId': externalLeadId };
  const existing = await Lead.findOne(externalFilter).select('_id').lean();
  if (existing) return { status: 'created', lead: existing._id };
  const [connection, tenant] = await Promise.all([
    Integration.findOne({ _id: delivery.integration, company, platform }).select('+credentials').lean(),
    Company.findOne({ _id: company, isActive: { $ne: false } }).select('_id').lean()
  ]);
  if (!tenant || !connection || connection.status === 'disconnected') throw problem(409, 'The ads connection is disconnected.');
  if (platform === 'meta' && connection.status !== 'connected') throw problem(409, 'Reconnect Meta before retrying this lead.');
  const payload = open(delivery.payload);
  let data = payload;
  if (platform === 'meta') {
    try {
      data = await metaLead(externalLeadId, open(connection.credentials).pageToken);
    } catch (error) {
      if (error.reconnect) {
        await Integration.updateOne({ _id: connection._id, credentials: connection.credentials }, { status: 'reconnect' });
      }
      throw error;
    }
    const formId = numericId(data.form_id) || numericId(payload.form_id);
    if (!connection.forms.some(form => form.id === formId)) throw problem(409, 'The Meta lead form is no longer selected on this connection.');
  }
  const fields = normalize(platform, data, payload, connection);
  const match = await duplicateContact(company, fields);
  if (match) return { status: 'duplicate', lead: match._id };

  const assignee = await chooseAssignee(connection);
  let lead;
  try {
    lead = await Lead.create({
      ...fields,
      marketing: { ...fields.marketing, externalLeadId },
      company, status: connection.leadStatus || 'new', assignedTo: assignee?._id || null,
      assignedAt: assignee ? new Date() : undefined, createdByName: 'Marketing Ads',
      adContactEmail: fields.email || undefined, adContactPhone: phoneKey(fields.phone) || undefined
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const same = await Lead.findOne(externalFilter).select('_id').lean();
    if (same) return { status: 'created', lead: same._id };
    const contact = await Lead.findOne({ company, $or: [
      ...(fields.email ? [{ adContactEmail: fields.email }] : []),
      ...(fields.phone ? [{ adContactPhone: phoneKey(fields.phone) }] : [])
    ] }).select('_id').lean();
    if (!contact) throw error;
    return { status: 'duplicate', lead: contact._id };
  }
  invalidateCrmListSummaries();
  let warning;
  try {
    await recordActivity(lead, assignee, connection);
  } catch {
    warning = 'Lead created. Assignment history or notification could not be delivered.';
  }
  // Retain a protected copy of the provider record for troubleshooting.
  return { status: 'created', lead: lead._id, error: warning, payload: seal(data) };
}

async function processNext() {
  const now = new Date();
  const claim = random();
  const job = await Delivery.findOneAndUpdate({
    status: { $in: ['queued', 'retrying', 'processing'] }, availableAt: { $lte: now }
  }, {
    $set: { status: 'processing', claim, availableAt: new Date(+now + 5 * 60 * 1000) }, $inc: { attempts: 1 }
  }, { new: true, sort: { availableAt: 1 } }).select('+payload').lean();
  if (!job) return false;

  let result;
  try {
    const expiredClaim = job.attempts > MAX_ATTEMPTS;
    if (expiredClaim) throw problem(409, 'Lead processing exceeded its retry limit.');
    result = await processDelivery(job);
    await Integration.updateOne({ _id: job.integration, company: job.company }, {
      $max: { lastLeadReceivedAt: job.receivedAt }
    });
  } catch (error) {
    const retry = job.attempts < MAX_ATTEMPTS && !error.reconnect && error.status !== 409;
    result = {
      status: retry ? 'retrying' : 'failed',
      error: error.adsError ? error.message : 'Lead could not be processed. Retry from Marketing Ads.',
      ...(retry && { availableAt: new Date(Date.now() + 30000 * 2 ** (job.attempts - 1)) })
    };
  }
  const terminal = result.status !== 'retrying';
  await Delivery.updateOne({ _id: job._id, claim }, {
    $set: { ...result, ...(terminal && { processedAt: new Date(), expiresAt: new Date(Date.now() + 30 * DAY) }) },
    $unset: { claim: 1, ...(!result.error && { error: 1 }), ...(terminal && { availableAt: 1 }) }
  });
  return true;
}

function start() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (let count = 0; count < 20 && await processNext(); count += 1) {
        // Each claim is shared by all backend instances.
      }
    } catch {
      console.error('Marketing Ads queue could not be processed.');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  void tick();
}

module.exports = { enqueue, processNext, start };
