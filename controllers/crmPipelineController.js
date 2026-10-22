const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');
const CrmFieldConfig = require('../models/CrmFieldConfig');
const { applyLeadFilters } = require('../services/crmListQuery');
let cascadeLeadUpdate = async () => {};
try {
  const engine = require('../services/cascadeSyncEngine');
  if (typeof engine.cascadeLeadUpdate === 'function') cascadeLeadUpdate = engine.cascadeLeadUpdate;
} catch (e) {}

// Pipeline order shown on the Kanban board.
const LEAD_STATUSES = ['new', 'contacted', 'follow-up', 'interested', 'negotiation', 'converted', 'not interested', 'closed'];
const STATUS_LABELS = { new: 'New', contacted: 'Contacted', 'follow-up': 'Follow-up', interested: 'Interested', negotiation: 'Negotiation', converted: 'Converted', 'not interested': 'Not Interested', closed: 'Closed' };
const TERMINAL = ['converted', 'closed'];
const CALL_OUTCOMES = ['Connected', 'Interested', 'Not Interested', 'Need Callback', 'Follow-up', 'Call Later', 'No Answer', 'Busy', 'Switched Off', 'Not Reachable', 'Wrong Number', 'Wrong Person', 'Invalid Number', 'Language Barrier', 'Do Not Call', 'Duplicate', 'Spam', 'Call Closed', 'Converted'];
const FIELD_KEYS = ['customField1', 'customField2', 'customField3', 'customField4', 'customField5'];
const FIELD_TYPES = ['text', 'number', 'date', 'dropdown'];

exports.LEAD_STATUSES = LEAD_STATUSES;

/* ------------------------------------------------------------- Pipeline */

// Kanban drag and drop: move a lead to another stage and note who moved it.
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid lead ID.' });
    if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ message: 'Choose a valid stage.' });
    const lead = await Lead.findOne({ _id: id, company: req.crmCompany }).select('status').lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found.' });
    if (lead.status === status) return res.json({ item: { _id: id, status } });
    const update = {
      $set: { status, ...(TERMINAL.includes(status) ? { nextFollowUp: null } : {}) },
      $push: { notes: { message: `Stage changed from ${STATUS_LABELS[lead.status] || lead.status} to ${STATUS_LABELS[status]} by ${req.user?.name || 'Admin'}`, createdAt: new Date() } }
    };
    const item = await Lead.findOneAndUpdate({ _id: id, company: req.crmCompany }, update, { new: true, runValidators: true }).lean();
    if (TERMINAL.includes(status)) {
      const FollowUp = require('../models/Followup');
      await FollowUp.updateMany({ company: req.crmCompany, lead: id, status: 'pending' }, { $set: { status: 'done' } });
    }
    cascadeLeadUpdate(id, { status }).catch(() => {});
    res.json({ item: { _id: id, status: item.status } });
  } catch (error) { next(error); }
};

/* ------------------------------------------------------------ Campaigns */

const campaignInput = body => {
  const name = String(body?.name || '').trim();
  if (!name || name.length > 80) return { error: 'Enter a campaign name of at most 80 characters.' };
  const target = Number(body?.target || 0);
  if (!Number.isInteger(target) || target < 0) return { error: 'Target must be a whole number.' };
  const dateOk = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  const startDate = String(body?.startDate || '').trim();
  const endDate = String(body?.endDate || '').trim();
  if (!dateOk(startDate) || !dateOk(endDate)) return { error: 'Enter valid start and end dates.' };
  if (startDate && endDate && endDate < startDate) return { error: 'The end date must be after the start date.' };
  const outcomes = (Array.isArray(body?.outcomes) ? body.outcomes : []).filter(item => CALL_OUTCOMES.includes(item));
  const status = ['active', 'paused', 'completed'].includes(body?.status) ? body.status : 'active';
  return { data: { name, description: String(body?.description || '').trim().slice(0, 500), target, startDate, endDate, outcomes: [...new Set(outcomes)], status } };
};

const formatCampaign = (item, stats = {}) => {
  const converted = stats.converted || 0;
  return {
    id: String(item._id),
    name: item.name,
    description: item.description || '',
    target: item.target || 0,
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    outcomes: item.outcomes || [],
    status: item.status,
    stats: {
      total: stats.total || 0,
      called: stats.called || 0,
      interested: stats.interested || 0,
      converted,
      lost: stats.lost || 0,
      pending: Math.max(0, (stats.total || 0) - (stats.called || 0))
    },
    // Conversions against the target, or calls made against the leads when there is no target.
    progress: item.target ? Math.min(100, Math.round((converted / item.target) * 100))
      : stats.total ? Math.round(((stats.called || 0) / stats.total) * 100) : 0
  };
};

const campaignStats = async (company, ids) => {
  if (!ids.length) return {};
  const rows = await Lead.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(String(company)), campaign: { $in: ids } } },
    { $group: {
      _id: '$campaign',
      total: { $sum: 1 },
      called: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$callHistory', []] } }, 0] }, 1, 0] } },
      interested: { $sum: { $cond: [{ $in: ['$status', ['interested', 'negotiation']] }, 1, 0] } },
      converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
      lost: { $sum: { $cond: [{ $in: ['$status', ['not interested', 'closed']] }, 1, 0] } }
    } }
  ]);
  return Object.fromEntries(rows.map(row => [String(row._id), row]));
};

exports.listCampaigns = async (req, res, next) => {
  try {
    const items = await Campaign.find({ company: req.crmCompany }).sort({ status: 1, createdAt: -1 }).lean();
    const stats = await campaignStats(req.crmCompany, items.map(item => item._id));
    res.json({ items: items.map(item => formatCampaign(item, stats[String(item._id)])), outcomes: CALL_OUTCOMES });
  } catch (error) { next(error); }
};

exports.createCampaign = async (req, res, next) => {
  try {
    const { data, error } = campaignInput(req.body);
    if (error) return res.status(400).json({ message: error });
    const item = await Campaign.create({ ...data, company: req.crmCompany, createdBy: req.user?._id || req.user?.id, createdByName: req.user?.name || '' });
    res.status(201).json({ item: formatCampaign(item.toObject()) });
  } catch (error) { next(error); }
};

exports.updateCampaign = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.campaignId)) return res.status(400).json({ message: 'Invalid campaign ID.' });
    const { data, error } = campaignInput(req.body);
    if (error) return res.status(400).json({ message: error });
    const item = await Campaign.findOneAndUpdate({ _id: req.params.campaignId, company: req.crmCompany }, { $set: data }, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ message: 'Campaign not found.' });
    await Lead.updateMany({ company: req.crmCompany, campaign: item._id }, { $set: { campaignName: item.name } });
    const stats = await campaignStats(req.crmCompany, [item._id]);
    res.json({ item: formatCampaign(item, stats[String(item._id)]) });
  } catch (error) { next(error); }
};

exports.deleteCampaign = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.campaignId)) return res.status(400).json({ message: 'Invalid campaign ID.' });
    const item = await Campaign.findOneAndDelete({ _id: req.params.campaignId, company: req.crmCompany }).lean();
    if (!item) return res.status(404).json({ message: 'Campaign not found.' });
    // The leads stay; they just leave the campaign.
    await Lead.updateMany({ company: req.crmCompany, campaign: item._id }, { $set: { campaign: null, campaignName: '' } });
    res.json({ success: true });
  } catch (error) { next(error); }
};

// Adds leads to a campaign (or removes them): by IDs, or every lead matching the All Leads filters.
exports.setCampaignLeads = async (req, res, next) => {
  try {
    const remove = req.body?.remove === true;
    let campaign = null;
    if (!remove) {
      if (!mongoose.isValidObjectId(req.params.campaignId)) return res.status(400).json({ message: 'Invalid campaign ID.' });
      campaign = await Campaign.findOne({ _id: req.params.campaignId, company: req.crmCompany }).lean();
      if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });
    }
    const company = new mongoose.Types.ObjectId(String(req.crmCompany));
    let filter;
    if (Array.isArray(req.body?.leadIds)) {
      const ids = req.body.leadIds.filter(id => mongoose.isValidObjectId(id)).slice(0, 5000);
      if (!ids.length) return res.status(400).json({ message: 'Select at least one lead.' });
      filter = { company, _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } };
    } else if (req.body?.filters && typeof req.body.filters === 'object') {
      filter = applyLeadFilters({ query: req.body.filters }, { company });
    } else {
      return res.status(400).json({ message: 'Select the leads to add.' });
    }
    if (remove && mongoose.isValidObjectId(req.params.campaignId)) filter.campaign = new mongoose.Types.ObjectId(req.params.campaignId);
    const result = await Lead.updateMany(filter, { $set: remove ? { campaign: null, campaignName: '' } : { campaign: campaign._id, campaignName: campaign.name } });
    res.json({ success: true, updated: result.modifiedCount ?? result.nModified ?? 0 });
  } catch (error) { next(error); }
};

/* -------------------------------------------------------- Custom fields */

const defaultFields = () => FIELD_KEYS.map(key => ({ key, label: '', type: 'text', options: [], required: false, showInCallForm: false }));

// The five slots, with the admin's names and types where set (label '' means the slot is unused).
const loadFieldConfig = async company => {
  const record = await CrmFieldConfig.findOne({ company }).lean();
  const saved = Object.fromEntries((record?.fields || []).map(field => [field.key, field]));
  return defaultFields().map(field => ({ ...field, ...(saved[field.key] || {}) }));
};
exports.loadFieldConfig = loadFieldConfig;

// Type checks for custom field values; `requireRequired` also enforces required fields (Add Lead).
const validateCustomValues = (fields, values, { requireRequired = false } = {}) => {
  const errors = {};
  fields.forEach(field => {
    if (!field.label) return;
    const value = String(values?.[field.key] ?? '').trim();
    if (!value) {
      if (requireRequired && field.required) errors[field.key] = `${field.label} is required.`;
      return;
    }
    if (field.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) errors[field.key] = `${field.label} must be a number.`;
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[field.key] = `${field.label} must be a date.`;
    if (field.type === 'dropdown' && field.options.length && !field.options.includes(value)) errors[field.key] = `Choose a valid ${field.label}.`;
  });
  return errors;
};
exports.validateCustomValues = validateCustomValues;

exports.getFieldConfig = async (req, res, next) => {
  try {
    res.json({ fields: await loadFieldConfig(req.crmCompany || req.telecallerCompany) });
  } catch (error) { next(error); }
};

exports.saveFieldConfig = async (req, res, next) => {
  try {
    const input = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const fields = [];
    for (const key of FIELD_KEYS) {
      const field = input.find(item => item?.key === key) || {};
      const label = String(field.label || '').trim().slice(0, 40);
      const type = FIELD_TYPES.includes(field.type) ? field.type : 'text';
      const options = type === 'dropdown'
        ? [...new Set((Array.isArray(field.options) ? field.options : []).map(option => String(option || '').trim().slice(0, 60)).filter(Boolean))].slice(0, 30)
        : [];
      if (label && type === 'dropdown' && !options.length) return res.status(400).json({ message: `Add at least one option for ${label}.` });
      fields.push({ key, label, type, options, required: Boolean(label && field.required), showInCallForm: Boolean(label && field.showInCallForm) });
    }
    await CrmFieldConfig.findOneAndUpdate({ company: req.crmCompany }, { $set: { fields } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ fields });
  } catch (error) { next(error); }
};
