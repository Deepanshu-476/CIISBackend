const mongoose = require('mongoose');
const Lead = require('../models/Lead');
require('../models/LeadSource');
require('../models/LeadType');
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
const populated = query => query.populate('leadSource', 'name').populate('leadType', 'name').populate('assignedTo', 'name').lean();

const parseDate = value => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
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
    recordingUrl: req.body.recordingUrl || '',
    callType: req.body.callType || 'Outgoing'
  };
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

exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead ID.' });
    const item = await populated(Lead.findOne({ ...scope(req), _id: req.params.id }));
    if (!item) return res.status(404).json({ message: 'Assigned lead not found.' });
    res.json({ item: formatLeadForClient(item) });
  } catch (error) { next(error); }
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

    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 200, 1), 500);
    const items = await CallLog.find(filter)
      .populate('lead', 'name phone email source leadSource leadType status address gender remarks')
      .populate('agent', 'name email role companyRole')
      .sort({ startTime: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ items: (items || []).map(formatCallLogForClient) });
  } catch (error) { next(error); }
};

exports.save = async (req, res, next) => {
  try {
    const { id, outcome, callType = 'Outgoing', notes = '', followUp } = req.body;
    const allowedCallTypes = ['Inbound', 'Outbound', 'Outgoing', 'Incoming', 'Missed', 'Unknown'];
    if (!mongoose.isValidObjectId(req.params.id) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) return res.status(400).json({ message: 'Invalid lead or call ID.' });
    if (!outcomes.includes(outcome) || !allowedCallTypes.includes(callType)) return res.status(400).json({ message: 'Choose a valid call outcome and direction.' });
    if (typeof notes !== 'string' || notes.length > 5000 || (outcome === 'Note Added' && !notes.trim())) return res.status(400).json({ message: 'Enter notes of at most 5,000 characters.' });
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
      if (req.body.recordingUrl) setExistingCall['callHistory.$.recordingUrl'] = req.body.recordingUrl;
      if (Number(req.body.duration) >= 0) setExistingCall['callHistory.$.duration'] = Number(req.body.duration) || 0;
      if (notes.trim()) setExistingCall['callHistory.$.notes'] = notes.trim();
      if (callType) setExistingCall['callHistory.$.callType'] = callType;
      const callDate = parseDate(req.body.startTime) || parseDate(req.body.endTime);
      if (callDate) setExistingCall['callHistory.$.date'] = callDate;
      if (Object.keys(setExistingCall).length && typeof Lead.updateOne === 'function') {
        await Lead.updateOne({ ...filter, 'callHistory.id': id }, { $set: setExistingCall });
      }
      await syncCallArtifacts(req, { id, outcome, notes, nextDate, noteOnly }, existing);
      const latestExisting = await populated(Lead.findOne(filter));
      return res.json({ item: formatLeadForClient(latestExisting) });
    }
    const callDate = parseDate(req.body.startTime) || parseDate(req.body.endTime) || new Date();
    const call = { id, outcome, callType, notes: notes.trim(), agent: req.user._id || req.user.id, createdByName: req.user.name || 'User', date: callDate, followUp: noteOnly || terminal.includes(outcome) ? null : nextDate, recordingUrl: req.body.recordingUrl || '', duration: Number(req.body.duration) || 0 };
    const mutation = { $push: { callHistory: call }, $inc: { __v: 1 } };
    if (!noteOnly) {
      const status = outcome === 'Converted' ? 'converted' : outcome === 'Call Closed' ? 'closed' : outcome === 'Interested' ? 'interested' : outcome === 'Not Interested' ? 'not interested' : callbacks.includes(outcome) ? 'follow-up' : existing.status;
      const nextFollowUp = terminal.includes(outcome) ? null : (nextDate || existing.nextFollowUp || null);
      mutation.$set = { status, nextFollowUp };
    }
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
