const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../../middleware/authMiddleware');
const Company = require('../../models/Company');
const BulkEmailContact = require('../models/BulkEmailContact');
const BulkEmailTemplate = require('../models/BulkEmailTemplate');
const BulkEmailCampaign = require('../models/BulkEmailCampaign');
const service = require('../utils/bulkEmailService');

const router = express.Router();
const TEMPLATE_FIELDS = ['name', 'mode', 'subject', 'heading', 'subheading', 'body', 'buttonText', 'buttonUrl', 'footer', 'html'];
const escapeRegex = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pageParams = query => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Every route works inside the caller's company, and only when that company has the page.
router.use(protect, async (req, res, next) => {
  try {
    const companyId = req.user?.company?._id || req.user?.company;
    if (!companyId || !mongoose.Types.ObjectId.isValid(String(companyId))) return fail(res, 403, 'Company not found for this user');
    const company = await Company.findById(companyId).select('companyName allowedPages bulkEmailLimits').lean();
    if (!company) return fail(res, 404, 'Company not found');
    if (!service.companyHasPage(company)) return fail(res, 403, 'Bulk Email is not enabled for your company');
    req.bulkCompany = company;
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/usage', async (req, res) => {
  const limits = service.getLimits(req.bulkCompany);
  const usage = await service.getUsage(req.bulkCompany._id);
  res.json({
    success: true,
    limits,
    usage: { daily: usage.daily, monthly: usage.monthly },
    remaining: { daily: Math.max(0, limits.daily - usage.daily), monthly: Math.max(0, limits.monthly - usage.monthly) },
    maxPerSend: service.MAX_RECIPIENTS_PER_SEND,
  });
});

/* ---------------- Contacts ---------------- */

router.get('/contacts', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { company: req.bulkCompany._id };
  const search = String(req.query.search || '').trim();
  if (search) filter.$or = [{ email: new RegExp(escapeRegex(search), 'i') }, { name: new RegExp(escapeRegex(search), 'i') }];
  const [contacts, total] = await Promise.all([
    BulkEmailContact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    BulkEmailContact.countDocuments(filter),
  ]);
  res.json({ success: true, contacts, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// Accepts { email, name } or { emails: "a@x.com, B <b@y.com>\n..." } for pasting many at once.
router.post('/contacts', async (req, res) => {
  const entries = [];
  if (req.body.emails) {
    for (const part of String(req.body.emails).split(/[\n,;]+/)) {
      const match = part.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      const email = service.normalizeEmail(match ? match[2] : part);
      if (email) entries.push({ email, name: match ? match[1].replace(/"/g, '').trim() : '' });
    }
  } else {
    entries.push({ email: service.normalizeEmail(req.body.email), name: String(req.body.name || '').trim() });
  }
  const invalid = entries.filter(entry => !service.isValidEmail(entry.email)).map(entry => entry.email || '(empty)');
  if (invalid.length) return fail(res, 400, `Invalid email address: ${invalid.slice(0, 5).join(', ')}`);
  if (!entries.length) return fail(res, 400, 'Enter at least one email address');

  let added = 0;
  for (const entry of entries) {
    const result = await BulkEmailContact.updateOne(
      { company: req.bulkCompany._id, email: entry.email },
      { $setOnInsert: { createdBy: req.user._id || req.user.id }, ...(entry.name ? { $set: { name: entry.name } } : {}) },
      { upsert: true });
    if (result.upsertedCount) added += 1;
  }
  res.status(201).json({ success: true, added, skipped: entries.length - added, message: `${added} contact${added === 1 ? '' : 's'} added` });
});

router.put('/contacts/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 400, 'Invalid contact');
  const update = {};
  if (req.body.name !== undefined) update.name = String(req.body.name || '').trim();
  if (req.body.email !== undefined) {
    update.email = service.normalizeEmail(req.body.email);
    if (!service.isValidEmail(update.email)) return fail(res, 400, 'Invalid email address');
  }
  try {
    const contact = await BulkEmailContact.findOneAndUpdate({ _id: req.params.id, company: req.bulkCompany._id }, { $set: update }, { new: true });
    if (!contact) return fail(res, 404, 'Contact not found');
    res.json({ success: true, contact });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, 'This email is already saved');
    throw error;
  }
});

router.delete('/contacts/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 400, 'Invalid contact');
  const result = await BulkEmailContact.deleteOne({ _id: req.params.id, company: req.bulkCompany._id });
  if (!result.deletedCount) return fail(res, 404, 'Contact not found');
  res.json({ success: true, message: 'Contact deleted' });
});

/* ---------------- Templates ---------------- */

const templateInput = body => {
  const data = {};
  TEMPLATE_FIELDS.forEach(field => { if (body[field] !== undefined) data[field] = field === 'mode' ? (body.mode === 'html' ? 'html' : 'simple') : String(body[field] ?? ''); });
  return data;
};

router.get('/templates', async (req, res) => {
  const templates = await BulkEmailTemplate.find({ company: req.bulkCompany._id }).sort({ updatedAt: -1 }).lean();
  res.json({ success: true, templates });
});

router.post('/templates', async (req, res) => {
  const data = templateInput(req.body);
  if (!String(data.name || '').trim()) return fail(res, 400, 'Template name is required');
  try {
    const template = await BulkEmailTemplate.create({ ...data, company: req.bulkCompany._id, createdBy: req.user._id || req.user.id, updatedBy: req.user._id || req.user.id });
    res.status(201).json({ success: true, template, message: 'Template saved' });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, 'A template with this name already exists');
    if (error.name === 'ValidationError') return fail(res, 400, error.message);
    throw error;
  }
});

router.put('/templates/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 400, 'Invalid template');
  const data = templateInput(req.body);
  if (data.name !== undefined && !data.name.trim()) return fail(res, 400, 'Template name is required');
  try {
    const template = await BulkEmailTemplate.findOneAndUpdate(
      { _id: req.params.id, company: req.bulkCompany._id }, { $set: { ...data, updatedBy: req.user._id || req.user.id } }, { new: true, runValidators: true });
    if (!template) return fail(res, 404, 'Template not found');
    res.json({ success: true, template, message: 'Template updated' });
  } catch (error) {
    if (error.code === 11000) return fail(res, 409, 'A template with this name already exists');
    if (error.name === 'ValidationError') return fail(res, 400, error.message);
    throw error;
  }
});

router.delete('/templates/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 400, 'Invalid template');
  const result = await BulkEmailTemplate.deleteOne({ _id: req.params.id, company: req.bulkCompany._id });
  if (!result.deletedCount) return fail(res, 404, 'Template not found');
  res.json({ success: true, message: 'Template deleted' });
});

/* ---------------- Preview & send ---------------- */

// The page previews exactly what will be sent.
router.post('/preview', (req, res) => {
  const html = req.body.mode === 'html' ? String(req.body.html || '') : service.buildSimpleHtml(req.body, req.bulkCompany.companyName);
  res.json({ success: true, html });
});

router.post('/send', async (req, res) => {
  const result = await service.startCampaign({ user: req.user, input: req.body });
  if (result.status !== 202) return fail(res, result.status, result.message);
  const { campaign } = result;
  res.status(202).json({
    success: true,
    message: `Sending to ${campaign.recipients.length} recipient${campaign.recipients.length === 1 ? '' : 's'}`,
    campaignId: campaign._id,
  });
});

/* ---------------- History ---------------- */

router.get('/campaigns', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { company: req.bulkCompany._id };
  const search = String(req.query.search || '').trim();
  if (search) filter.subject = new RegExp(escapeRegex(search), 'i');
  const [campaigns, total] = await Promise.all([
    BulkEmailCampaign.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select('subject heading mode templateName sentByName status sentCount failedCount createdAt recipients.email').lean(),
    BulkEmailCampaign.countDocuments(filter),
  ]);
  res.json({
    success: true,
    campaigns: campaigns.map(({ recipients, ...campaign }) => ({ ...campaign, recipientCount: recipients.length })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.get('/campaigns/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 400, 'Invalid campaign');
  const campaign = await BulkEmailCampaign.findOne({ _id: req.params.id, company: req.bulkCompany._id }).lean();
  if (!campaign) return fail(res, 404, 'Email not found');
  res.json({ success: true, campaign });
});

// Every email a company has sent to one address.
router.get('/recipients/history', async (req, res) => {
  const email = service.normalizeEmail(req.query.email);
  if (!service.isValidEmail(email)) return fail(res, 400, 'Enter a valid email address');
  const campaigns = await BulkEmailCampaign.find({ company: req.bulkCompany._id, 'recipients.email': email })
    .sort({ createdAt: -1 }).limit(200)
    .select({ subject: 1, heading: 1, mode: 1, templateName: 1, sentByName: 1, createdAt: 1, recipients: { $elemMatch: { email } } }).lean();
  res.json({
    success: true,
    email,
    emails: campaigns.map(({ recipients, ...campaign }) => ({ ...campaign, delivery: recipients?.[0] || null })),
  });
});

router.use((error, req, res, next) => {
  console.error('[bulk-email]', error.message);
  if (res.headersSent) return next(error);
  fail(res, 500, 'Something went wrong. Please try again.');
});

module.exports = router;
