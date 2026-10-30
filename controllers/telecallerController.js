const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const LeadSource = require('../models/LeadSource');
const LeadType = require('../models/LeadType');
require('../models/User');
let formatLeadForClient = item => item;
let formatCallLogForClient = item => item;
let cascadeLeadUpdate = async () => {};
try {
  const cascade = require('../services/cascadeSyncEngine');
  if (typeof cascade.formatLeadForClient === 'function') formatLeadForClient = cascade.formatLeadForClient;
  if (typeof cascade.formatCallLogForClient === 'function') formatCallLogForClient = cascade.formatCallLogForClient;
  if (typeof cascade.cascadeLeadUpdate === 'function') cascadeLeadUpdate = cascade.cascadeLeadUpdate;
} catch (e) {}

const outcomes = ['Connected', 'Interested', 'Not Interested', 'Need Callback', 'Follow-up', 'Call Later', 'No Answer', 'Busy', 'Switched Off', 'Not Reachable', 'Wrong Number', 'Wrong Person', 'Invalid Number', 'Language Barrier', 'Do Not Call', 'Duplicate', 'Spam', 'Call Closed', 'Converted', 'Note Added'];
const callbacks = ['Need Callback', 'Follow-up', 'Call Later'];
const terminal = ['Converted', 'Call Closed'];
const scope = req => {
  const role = String(req.user?.role || req.user?.companyRole || '').toLowerCase();
  const isAdmin = ['admin', 'owner', 'superadmin', 'company_admin', 'company admin'].includes(role);
  if (isAdmin) {
    return { company: req.telecallerCompany };
  }
  return { company: req.telecallerCompany, assignedTo: req.user._id || req.user.id };
};
const populated = query => query.populate('leadSource', 'name').populate('leadType', 'name').populate('assignedTo', 'name').populate('campaign', 'name outcomes status').lean();
const CUSTOM_FIELD_KEYS = ['customField1', 'customField2', 'customField3', 'customField4', 'customField5'];

// Custom field values sent with a call (after-call form); only the five slots, checked against the admin's types.
const customFieldUpdate = async (req) => {
  const input = req.body?.customFields;
  if (!input || typeof input !== 'object') return { values: {} };
  const values = {};
  for (const key of CUSTOM_FIELD_KEYS) {
    if (input[key] === undefined) continue;
    const value = String(input[key] ?? '').trim();
    if (value.length > 1000) return { error: 'Custom field values can be at most 1,000 characters.' };
    values[key] = value;
  }
  if (!Object.keys(values).length) return { values };
  const pipeline = require('./crmPipelineController');
  const errors = pipeline.validateCustomValues(await pipeline.loadFieldConfig(req.telecallerCompany), values);
  const first = Object.values(errors)[0];
  return first ? { error: first } : { values };
};

const parseDate = value => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

// Only a file from POST /:id/recording or a web link is stored; a phone-local path cannot be played.
const cleanRecordingUrl = value => {
  const url = String(value || '').trim();
  return /^\/uploads\/recordings\/[\w.-]+$/.test(url) || /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
};

const syncCallArtifacts = async (req, { id, outcome, notes, nextDate, noteOnly }, leadDoc = null) => {
  if (noteOnly) return;
  const CallLog = require('../models/CallLog');
  const FollowUp = require('../models/Followup');
  const agent = req.user._id || req.user.id;
  const validStatuses = ['answered', 'missed', 'not reachable', 'rejected'];
  const lower = outcome.toLowerCase();
  let status = validStatuses.includes(lower) ? lower : 'answered';
  if (['no answer', 'busy'].includes(lower)) status = 'missed';
  else if (['switched off', 'not reachable'].includes(lower)) status = 'not reachable';
  else if (['wrong number', 'wrong person', 'invalid number', 'language barrier', 'do not call', 'duplicate', 'spam'].includes(lower)) status = 'rejected';

  const values = {
    company: req.telecallerCompany,
    lead: req.params.id,
    leadName: leadDoc?.name || '',
    leadPhone: leadDoc?.phone || '',
    leadEmail: leadDoc?.email || '',
    leadSource: leadDoc?.leadSource || null,
    leadSourceName: leadDoc?.leadSourceName || leadDoc?.source || '',
    leadType: leadDoc?.leadType || null,
    leadTypeName: leadDoc?.leadTypeName || '',
    leadStatus: leadDoc?.status || '',
    leadAddress: leadDoc?.address || '',
    leadGender: leadDoc?.gender || '',
    leadRemarks: leadDoc?.remarks || '',
    agent,
    agentName: req.user?.name || '',
    agentEmail: req.user?.email || '',
    agentRole: req.user?.role || req.user?.companyRole || '',
    clientCallId: id,
    startTime: parseDate(req.body.startTime) || parseDate(req.body.endTime) || new Date(),
    endTime: parseDate(req.body.endTime) || new Date(),
    duration: Number(req.body.duration) || 0,
    status,
    notes: notes.trim(),
    callType: req.body.callType || 'Outgoing'
  };
  // A retry or edit without a recording must not wipe one saved earlier.
  if (cleanRecordingUrl(req.body.recordingUrl)) values.recordingUrl = cleanRecordingUrl(req.body.recordingUrl);
  if (req.body.callLogId && mongoose.isValidObjectId(req.body.callLogId)) {
    const log = await CallLog.findOneAndUpdate({ _id: req.body.callLogId, agent }, { $set: values }, { new: true });
    if (!log) throw new Error('The active call log could not be finalized.');
  } else {
    await CallLog.findOneAndUpdate(
      { company: req.telecallerCompany, agent, clientCallId: id },
      { $set: values },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const pendingFilter = { company: req.telecallerCompany, lead: req.params.id, agent, status: 'pending' };
  if (nextDate && !terminal.includes(outcome)) {
    const replacement = await FollowUp.findOneAndUpdate(
      { company: req.telecallerCompany, lead: req.params.id, agent, sourceCallId: id },
      {
        $set: {
          date: nextDate,
          note: notes.trim() || outcome,
          status: 'pending',
          leadName: leadDoc?.name || '',
          leadPhone: leadDoc?.phone || '',
          leadEmail: leadDoc?.email || '',
          leadSource: leadDoc?.leadSource || null,
          leadSourceName: leadDoc?.leadSourceName || leadDoc?.source || '',
          leadType: leadDoc?.leadType || null,
          leadTypeName: leadDoc?.leadTypeName || '',
          leadStatus: leadDoc?.status || '',
          agentName: req.user?.name || '',
          agentEmail: req.user?.email || ''
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await FollowUp.updateMany({ ...pendingFilter, _id: { $ne: replacement._id } }, { $set: { status: 'done' } });
  } else if (terminal.includes(outcome)) {
    await FollowUp.updateMany(pendingFilter, { $set: { status: 'done' } });
  }
};

exports.list = async (req, res, next) => {
  try {
    const items = await populated(Lead.find(scope(req)).sort({ assignedAt: -1, _id: -1 }));
    res.json({ items: (items || []).map(formatLeadForClient) });
  } catch (error) { next(error); }
};

// Caller ID popup: the lead (within the caller's scope) whose phone ends with the same 10 digits, plus its pending follow-ups.
exports.lookup = async (req, res, next) => {
  try {
    const digits = String(req.query?.phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length < 6) return res.status(400).json({ message: 'Enter a valid phone number.' });
    const phonePattern = new RegExp(`${digits.split('').join('\\D*')}\\D*$`);
    const lead = await populated(Lead.findOne({ ...scope(req), phone: phonePattern }).sort({ updatedAt: -1 }));
    const templates = await require('./messageTemplateController').listForCompany(req.telecallerCompany);
    const fieldConfig = (await require('./crmPipelineController').loadFieldConfig(req.telecallerCompany))
      .filter(field => field.label && field.showInCallForm);
    if (!lead) {
      // An unknown number: what the popup needs to create the lead.
      const filter = { company: req.telecallerCompany, status: 'Active' };
      const [types, sources] = await Promise.all([
        LeadType.find(filter).select('name').sort({ name: 1 }).lean(),
        LeadSource.find(filter).select('name').sort({ name: 1 }).lean()
      ]);
      return res.json({
        found: false,
        phone: digits,
        leadTypes: types.map(item => ({ id: String(item._id), name: item.name })),
        leadSources: sources.map(item => ({ id: String(item._id), name: item.name })),
        outcomes: outcomes.filter(outcome => outcome !== 'Note Added'),
        templates,
        fieldConfig
      });
    }
    const FollowUp = require('../models/Followup');
    const followUps = await FollowUp.find({ company: req.telecallerCompany, lead: lead._id, status: 'pending' })
      .sort({ date: 1 })
      .limit(5)
      .lean();
    const item = formatLeadForClient(lead);
    const lastCall = [...(lead.callHistory || [])]
      .filter(call => call.outcome !== 'Note Added')
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    res.json({
      found: true,
      lead: {
        id: String(lead._id),
        name: lead.name || '',
        phone: lead.phone || '',
        email: lead.email || '',
        status: lead.status || 'new',
        leadType: item.leadTypeName || '',
        leadSource: item.leadSourceName || '',
        assignedTo: item.assignedToName || '',
        remarks: lead.remarks || '',
        nextFollowUp: lead.nextFollowUp || null,
        campaign: lead.campaign?.name || lead.campaignName || '',
        customFields: Object.fromEntries(CUSTOM_FIELD_KEYS.map(key => [key, lead[key] || ''])),
        lastCall: lastCall ? { date: lastCall.date, outcome: lastCall.outcome || '', notes: lastCall.notes || '' } : null
      },
      followUps: followUps.map(item => ({ id: String(item._id), date: item.date, note: item.note || '' })),
      // A campaign can limit the outcomes its leads are given.
      outcomes: (lead.campaign?.outcomes?.length ? lead.campaign.outcomes : outcomes).filter(outcome => outcome !== 'Note Added'),
      templates,
      fieldConfig
    });
  } catch (error) { next(error); }
};

// "Create new customer" from the caller ID popup: a lead from an unknown number, assigned to the caller.
exports.quickLead = async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!name || name.length > 100) return res.status(400).json({ message: 'Enter the customer name.' });
    if (phone.length !== 10) return res.status(400).json({ message: 'Enter a valid 10-digit phone number.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    const company = req.telecallerCompany;
    const phonePattern = new RegExp(`${phone.split('').join('\\D*')}\\D*$`);
    if (await Lead.exists({ company, phone: phonePattern })) return res.status(409).json({ message: 'A lead with this phone number already exists.' });
    const [type, source] = await Promise.all([
      mongoose.isValidObjectId(req.body?.leadType) ? LeadType.findOne({ _id: req.body.leadType, company, status: 'Active' }).lean() : null,
      mongoose.isValidObjectId(req.body?.leadSource) ? LeadSource.findOne({ _id: req.body.leadSource, company, status: 'Active' }).lean() : null
    ]);
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const item = await Lead.create({
      company,
      name: name.replace(/(?:^|\s|-|\.)\S/g, char => char.toUpperCase()),
      phone,
      email,
      remarks: String(req.body?.remarks || '').trim().slice(0, 5000),
      leadDate: now.toISOString().slice(0, 10),
      leadType: type?._id || undefined,
      leadTypeName: type?.name || '',
      leadSource: source?._id || undefined,
      leadSourceName: source?.name || 'Incoming Call',
      source: source?.name || 'Incoming Call',
      status: 'new',
      assignedTo: userId,
      assignedToName: req.user.name || '',
      assignedToEmail: req.user.email || '',
      assignedToRole: req.user.role || req.user.companyRole || '',
      assignedAt: now,
      createdBy: userId,
      createdByName: req.user.name || '',
      createdByEmail: req.user.email || ''
    });
    res.status(201).json({ item: { id: String(item._id), name: item.name, phone: item.phone } });
  } catch (error) { next(error); }
};

// Custom fields shown in the after-call form (names and types set by the admin on Add Lead).
exports.fieldConfig = async (req, res, next) => {
  try {
    const fields = await require('./crmPipelineController').loadFieldConfig(req.telecallerCompany);
    res.json({ fields: fields.filter(field => field.label) });
  } catch (error) { next(error); }
};

exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead ID.' });
    const item = await populated(Lead.findOne({ ...scope(req), _id: req.params.id }));
    if (!item) return res.status(404).json({ message: 'Assigned lead not found.' });
    res.json({ item: formatLeadForClient(item) });
  } catch (error) { next(error); }
};

// Call bucket used by the app's Call History (missed / outgoing / incoming / unknown), same rules as the client.
const CALL_TYPE_LOWER = { $toLower: { $ifNull: ['$callType', ''] } };
const CALL_BUCKET_EXPR = {
  $switch: {
    branches: [
      { case: { $or: [{ $eq: [CALL_TYPE_LOWER, 'missed'] }, { $in: ['$status', ['missed', 'not reachable']] }] }, then: 'missed' },
      { case: { $in: [CALL_TYPE_LOWER, ['', 'outgoing', 'outbound']] }, then: 'outgoing' },
      { case: { $in: [CALL_TYPE_LOWER, ['incoming', 'inbound']] }, then: 'incoming' },
      { case: { $eq: [CALL_TYPE_LOWER, 'unknown'] }, then: 'unknown' }
    ],
    default: 'other'
  }
};

exports.callLogs = async (req, res, next) => {
  try {
    const CallLog = require('../models/CallLog');
    const filter = { company: req.telecallerCompany };
    const role = String(req.user?.role || req.user?.companyRole || '').toLowerCase();
    const isAdmin = ['admin', 'owner', 'superadmin', 'company_admin', 'company admin'].includes(role);
    if (!isAdmin) filter.agent = req.user._id || req.user.id;
    if (req.query?.leadId && mongoose.isValidObjectId(req.query.leadId)) filter.lead = req.query.leadId;
    if (req.query?.type) filter.callType = new RegExp(`^${String(req.query.type).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (req.query?.status) filter.status = String(req.query.status).toLowerCase();
    // direction: the stored callType is either spelling (Inbound/Incoming, Outbound/Outgoing).
    if (req.query?.direction === 'inbound') filter.callType = { $in: [/^inbound$/i, /^incoming$/i] };
    if (req.query?.direction === 'outbound') filter.callType = { $in: [/^outbound$/i, /^outgoing$/i] };
    // from/to: ISO times bounding startTime (the web page sends the viewer's local day).
    const from = parseDate(req.query?.from), to = parseDate(req.query?.to);
    if (from || to) filter.startTime = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };

    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 200, 1), 500);
    // ?page enables paging (older clients asked for one capped list of up to 500 and never saw older calls).
    const paged = req.query?.page !== undefined;
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    if (req.query?.search) {
      const pattern = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ leadName: pattern }, { leadPhone: pattern }, { agentName: pattern }, { notes: pattern }];
    }
    const baseFilter = { ...filter };
    if (paged && ['missed', 'outgoing', 'incoming', 'unknown'].includes(String(req.query?.bucket || ''))) {
      filter.$expr = { $eq: [CALL_BUCKET_EXPR, String(req.query.bucket)] };
    }
    const [items, total, buckets] = await Promise.all([
      CallLog.find(filter)
        .populate('lead', 'name phone email source leadSource leadType status address gender remarks')
        .populate('agent', 'name email role companyRole')
        .sort({ startTime: -1, createdAt: -1, _id: -1 })
        .skip(paged ? (page - 1) * limit : 0)
        .limit(limit)
        .lean(),
      paged ? CallLog.countDocuments(filter) : Promise.resolve(null),
      paged
        ? CallLog.aggregate([
          { $match: { ...baseFilter, company: new mongoose.Types.ObjectId(String(baseFilter.company)), ...(baseFilter.agent ? { agent: new mongoose.Types.ObjectId(String(baseFilter.agent)) } : {}), ...(baseFilter.lead ? { lead: new mongoose.Types.ObjectId(String(baseFilter.lead)) } : {}) } },
          { $group: { _id: CALL_BUCKET_EXPR, count: { $sum: 1 }, seconds: { $sum: { $ifNull: ['$duration', 0] } } } }
        ])
        : Promise.resolve(null)
    ]);
    const body = { items: (items || []).map(formatCallLogForClient) };
    if (paged) {
      const summary = { total: 0, totalSeconds: 0 };
      ['missed', 'outgoing', 'incoming', 'unknown'].forEach(key => { summary[key] = { count: 0, seconds: 0 }; });
      (buckets || []).forEach(row => {
        summary.total += row.count;
        summary.totalSeconds += row.seconds;
        if (summary[row._id]) summary[row._id] = { count: row.count, seconds: row.seconds };
      });
      Object.assign(body, { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), summary });
    }
    res.json(body);
  } catch (error) { next(error); }
};

exports.recordingLead = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead ID.' });
    const lead = await Lead.exists({ ...scope(req), _id: req.params.id });
    if (!lead) return res.status(404).json({ message: 'Assigned lead not found.' });
    next();
  } catch (error) { next(error); }
};

exports.save = async (req, res, next) => {
  try {
    const { id, outcome, callType = 'Outgoing', notes = '', followUp } = req.body;
    const allowedCallTypes = ['Inbound', 'Outbound', 'Outgoing', 'Incoming', 'Missed', 'Unknown'];
    if (!mongoose.isValidObjectId(req.params.id) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) return res.status(400).json({ message: 'Invalid lead or call ID.' });
    if (!outcomes.includes(outcome) || !allowedCallTypes.includes(callType)) return res.status(400).json({ message: 'Choose a valid call outcome and direction.' });
    if (typeof notes !== 'string' || notes.length > 5000 || (outcome === 'Note Added' && !notes.trim())) return res.status(400).json({ message: 'Enter notes of at most 5,000 characters.' });
    const custom = await customFieldUpdate(req);
    if (custom.error) return res.status(400).json({ message: custom.error });
    const filter = { ...scope(req), _id: req.params.id };
    const existing = await Lead.findOne(filter).lean();
    if (!existing) return res.status(404).json({ message: 'Assigned lead not found.' });
    // A retry after a lost response must not record the same call twice.
    const noteOnly = outcome === 'Note Added';
    if (!noteOnly && ['converted', 'closed'].includes(existing.status)) return res.status(409).json({ message: 'This lead is already converted or closed.' });
    const nextDate = followUp ? new Date(followUp) : null;
    if (!noteOnly && !terminal.includes(outcome) && ((callbacks.includes(outcome) && !nextDate) || (nextDate && (!Number.isFinite(nextDate.getTime()) || nextDate <= new Date())))) return res.status(400).json({ message: 'Choose a future follow-up date and time.' });
    if (existing.callHistory?.some(call => call.id === id)) {
      const setExistingCall = {};
      if (cleanRecordingUrl(req.body.recordingUrl)) setExistingCall['callHistory.$.recordingUrl'] = cleanRecordingUrl(req.body.recordingUrl);
      if (Number(req.body.duration) >= 0) setExistingCall['callHistory.$.duration'] = Number(req.body.duration) || 0;
      if (notes.trim()) setExistingCall['callHistory.$.notes'] = notes.trim();
      if (callType) setExistingCall['callHistory.$.callType'] = callType;
      const callDate = parseDate(req.body.startTime) || parseDate(req.body.endTime);
      if (callDate) setExistingCall['callHistory.$.date'] = callDate;
      // updateOutcome: the caller ID popup corrects the outcome of a call the call-log sync saved first.
      if (req.body.updateOutcome === true && !noteOnly) {
        setExistingCall['callHistory.$.outcome'] = outcome;
        setExistingCall['callHistory.$.followUp'] = terminal.includes(outcome) ? null : nextDate;
        setExistingCall.status = outcome === 'Converted' ? 'converted' : outcome === 'Call Closed' ? 'closed' : outcome === 'Interested' ? 'interested' : outcome === 'Not Interested' ? 'not interested' : callbacks.includes(outcome) ? 'follow-up' : existing.status;
        setExistingCall.nextFollowUp = terminal.includes(outcome) ? null : (nextDate || existing.nextFollowUp || null);
        setExistingCall.lastMissedCallAt = callType === 'Missed' ? (callDate || existing.lastMissedCallAt || new Date()) : null;
      }
      Object.assign(setExistingCall, custom.values);
      if (Object.keys(setExistingCall).length && typeof Lead.updateOne === 'function') {
        await Lead.updateOne({ ...filter, 'callHistory.id': id }, { $set: setExistingCall });
        if (setExistingCall.status && setExistingCall.status !== existing.status) {
          cascadeLeadUpdate(req.params.id, { status: setExistingCall.status }).catch(() => {});
        }
      }
      await syncCallArtifacts(req, { id, outcome, notes, nextDate, noteOnly }, existing);
      const latestExisting = await populated(Lead.findOne(filter));
      return res.json({ item: formatLeadForClient(latestExisting) });
    }
    const callDate = parseDate(req.body.startTime) || parseDate(req.body.endTime) || new Date();
    const call = { id, outcome, callType, notes: notes.trim(), agent: req.user._id || req.user.id, createdByName: req.user.name || 'User', date: callDate, followUp: noteOnly || terminal.includes(outcome) ? null : nextDate, recordingUrl: cleanRecordingUrl(req.body.recordingUrl), duration: Number(req.body.duration) || 0 };
    const mutation = { $push: { callHistory: call }, $inc: { __v: 1 } };
    if (!noteOnly) {
      mutation.$set = { lastMissedCallAt: callType === 'Missed' ? callDate : null };
      const status = outcome === 'Converted' ? 'converted' : outcome === 'Call Closed' ? 'closed' : outcome === 'Interested' ? 'interested' : outcome === 'Not Interested' ? 'not interested' : callbacks.includes(outcome) ? 'follow-up' : existing.status;
      const nextFollowUp = terminal.includes(outcome) ? null : (nextDate || existing.nextFollowUp || null);
      Object.assign(mutation.$set, { status, nextFollowUp });
    }
    if (Object.keys(custom.values).length) mutation.$set = { ...(mutation.$set || {}), ...custom.values };
    // Status and history are persisted together in one atomic document update.
    const item = await populated(Lead.findOneAndUpdate({ ...filter, __v: existing.__v ?? 0, status: existing.status, 'callHistory.id': { $ne: id } }, mutation, { new: true, runValidators: true }));
    if (!item) {
      const latest = await populated(Lead.findOne(filter));
      if (latest?.callHistory?.some(call => call.id === id)) return res.json({ item: formatLeadForClient(latest) });
      return res.status(409).json({ message: 'The lead changed while saving. Refresh and try again.' });
    }

    await syncCallArtifacts(req, { id, outcome, notes, nextDate, noteOnly }, item || existing);
    if (mutation.$set?.status) {
      cascadeLeadUpdate(req.params.id, { status: mutation.$set.status }).catch(() => {});
    }

    res.json({ item: formatLeadForClient(item) });
  } catch (error) { next(error); }
};
