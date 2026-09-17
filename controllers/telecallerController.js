const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const outcomes = ['Connected', 'Interested', 'Not Interested', 'Need Callback', 'Follow-up', 'Call Later', 'No Answer', 'Busy', 'Switched Off', 'Not Reachable', 'Wrong Number', 'Wrong Person', 'Invalid Number', 'Language Barrier', 'Do Not Call', 'Duplicate', 'Spam', 'Call Closed', 'Converted', 'Note Added'];
const callbacks = ['Need Callback', 'Follow-up', 'Call Later'];
const terminal = ['Converted', 'Call Closed'];
const scope = req => ({ company: req.telecallerCompany, assignedTo: req.user._id || req.user.id });
const populated = query => query.populate('leadSource', 'name').populate('leadType', 'name').populate('assignedTo', 'name').lean();

exports.list = async (req, res, next) => {
  try {
    const items = await populated(Lead.find(scope(req)).sort({ assignedAt: -1, _id: -1 }));
    res.json({ items });
  } catch (error) { next(error); }
};

exports.save = async (req, res, next) => {
  try {
    const { id, outcome, callType = 'Outbound', notes = '', followUp } = req.body;
    if (!mongoose.isValidObjectId(req.params.id) || typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) return res.status(400).json({ message: 'Invalid lead or call ID.' });
    if (!outcomes.includes(outcome) || !['Inbound', 'Outbound'].includes(callType)) return res.status(400).json({ message: 'Choose a valid call outcome and direction.' });
    if (typeof notes !== 'string' || notes.length > 5000 || (outcome === 'Note Added' && !notes.trim())) return res.status(400).json({ message: 'Enter notes of at most 5,000 characters.' });
    const filter = { ...scope(req), _id: req.params.id };
    const existing = await Lead.findOne(filter).lean();
    if (!existing) return res.status(404).json({ message: 'This lead is not assigned to you.' });
    // A retry after a lost response must not record the same call twice.
    if (existing.callHistory?.some(call => call.id === id)) return res.json({ item: await populated(Lead.findOne(filter)) });
    const noteOnly = outcome === 'Note Added';
    if (!noteOnly && ['converted', 'closed'].includes(existing.status)) return res.status(409).json({ message: 'This lead is already converted or closed.' });
    const nextDate = followUp ? new Date(followUp) : null;
    if (!noteOnly && !terminal.includes(outcome) && ((callbacks.includes(outcome) && !nextDate) || (nextDate && (!Number.isFinite(nextDate.getTime()) || nextDate <= new Date())))) return res.status(400).json({ message: 'Choose a future follow-up date and time.' });
    const call = { id, outcome, callType, notes: notes.trim(), agent: req.user._id || req.user.id, createdByName: req.user.name || 'User', date: new Date(), followUp: noteOnly || terminal.includes(outcome) ? null : nextDate };
    const mutation = { $push: { callHistory: call }, $inc: { __v: 1 } };
    if (!noteOnly) {
      const status = outcome === 'Converted' ? 'converted' : outcome === 'Call Closed' ? 'closed' : outcome === 'Interested' ? 'interested' : outcome === 'Not Interested' ? 'not interested' : callbacks.includes(outcome) ? 'follow-up' : existing.status;
      mutation.$set = { status, nextFollowUp: call.followUp };
    }
    // Status and history are persisted together in one atomic document update.
    const item = await populated(Lead.findOneAndUpdate({ ...filter, __v: existing.__v ?? 0, status: existing.status, 'callHistory.id': { $ne: id } }, mutation, { new: true, runValidators: true }));
    if (!item) {
      const latest = await populated(Lead.findOne(filter));
      if (latest?.callHistory?.some(call => call.id === id)) return res.json({ item: latest });
      return res.status(409).json({ message: 'The lead changed while saving. Refresh and try again.' });
    }
    res.json({ item });
  } catch (error) { next(error); }
};
