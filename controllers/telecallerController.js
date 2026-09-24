const mongoose = require('mongoose');
const Lead = require('../models/Lead');
require('../models/LeadSource');
require('../models/LeadType');
require('../models/User');
const outcomes = ['Connected', 'Interested', 'Not Interested', 'Need Callback', 'Follow-up', 'Call Later', 'No Answer', 'Busy', 'Switched Off', 'Not Reachable', 'Wrong Number', 'Wrong Person', 'Invalid Number', 'Language Barrier', 'Do Not Call', 'Duplicate', 'Spam', 'Call Closed', 'Converted', 'Note Added'];
const callbacks = ['Need Callback', 'Follow-up', 'Call Later'];
const terminal = ['Converted', 'Call Closed'];
const scope = req => ({ company: req.telecallerCompany, assignedTo: req.user._id || req.user.id });
const populated = query => query.populate('leadSource', 'name').populate('leadType', 'name').populate('assignedTo', 'name').lean();

const syncCallArtifacts = async (req, { id, outcome, notes, nextDate, noteOnly }) => {
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

  const values = { company: req.telecallerCompany, lead: req.params.id, agent, clientCallId: id,
    endTime: new Date(), duration: Number(req.body.duration) || 0, status, notes: notes.trim(), recordingUrl: req.body.recordingUrl || '', callType: req.body.callType || 'Outgoing' };
  if (req.body.callLogId && mongoose.isValidObjectId(req.body.callLogId)) {
    const log = await CallLog.findOneAndUpdate({ _id: req.body.callLogId, agent }, { $set: values }, { new: true });
    if (!log) throw new Error('The active call log could not be finalized.');
  } else {
    await CallLog.findOneAndUpdate(
      { company: req.telecallerCompany, agent, clientCallId: id },
      { $set: values, $setOnInsert: { startTime: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const pendingFilter = { company: req.telecallerCompany, lead: req.params.id, agent, status: 'pending' };
  if (nextDate && !terminal.includes(outcome)) {
    const replacement = await FollowUp.findOneAndUpdate(
      { company: req.telecallerCompany, lead: req.params.id, agent, sourceCallId: id },
      { $set: { date: nextDate, note: notes.trim() || outcome, status: 'pending' } },
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
    res.json({ items });
  } catch (error) { next(error); }
};

exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead ID.' });
    const item = await populated(Lead.findOne({ ...scope(req), _id: req.params.id }));
    if (!item) return res.status(404).json({ message: 'Assigned lead not found.' });
    res.json({ item });
  } catch (error) { next(error); }
};

exports.save = async (req, res, next) => {
  try {
    const { id, outcome, callType = 'Outgoing', notes = '', followUp } = req.body;
    const allowedCallTypes = ['Inbound', 'Outbound', 'Outgoing', 'Incoming', 'Missed', 'Unknown'];
    if (!mongoose.isValidObjectId(req.params.id) || typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) return res.status(400).json({ message: 'Invalid lead or call ID.' });
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
      await syncCallArtifacts(req, { id, outcome, notes, nextDate, noteOnly });
      return res.json({ item: await populated(Lead.findOne(filter)) });
    }
    const call = { id, outcome, callType, notes: notes.trim(), agent: req.user._id || req.user.id, createdByName: req.user.name || 'User', date: new Date(), followUp: noteOnly || terminal.includes(outcome) ? null : nextDate, recordingUrl: req.body.recordingUrl || '', duration: Number(req.body.duration) || 0 };
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
      if (latest?.callHistory?.some(call => call.id === id)) return res.json({ item: latest });
      return res.status(409).json({ message: 'The lead changed while saving. Refresh and try again.' });
    }

    await syncCallArtifacts(req, { id, outcome, notes, nextDate, noteOnly });

    res.json({ item });
  } catch (error) { next(error); }
};
