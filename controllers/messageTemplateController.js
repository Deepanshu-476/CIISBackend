const mongoose = require('mongoose');
const MessageTemplate = require('../models/MessageTemplate');

const CHANNELS = ['whatsapp', 'sms', 'both'];
const isAdmin = req => ['admin', 'owner', 'superadmin', 'company_admin', 'company admin']
  .includes(String(req.user?.role || req.user?.companyRole || '').toLowerCase());

const format = item => ({
  id: String(item._id),
  title: item.title,
  body: item.body,
  channel: item.channel,
  updatedAt: item.updatedAt
});

const validate = body => {
  const title = String(body?.title || '').trim();
  const text = String(body?.body || '').trim();
  const channel = CHANNELS.includes(body?.channel) ? body.channel : 'both';
  if (!title || title.length > 60) return { error: 'Enter a template name of at most 60 characters.' };
  if (!text || text.length > 1000) return { error: 'Enter a message of at most 1,000 characters.' };
  return { data: { title, body: text, channel } };
};

exports.list = async (req, res, next) => {
  try {
    const items = await MessageTemplate.find({ company: req.telecallerCompany }).sort({ title: 1 }).lean();
    res.json({ items: items.map(format), canManage: isAdmin(req) });
  } catch (error) { next(error); }
};

exports.listForCompany = async company =>
  (await MessageTemplate.find({ company }).sort({ title: 1 }).lean()).map(format);

exports.requireAdmin = (req, res, next) => (isAdmin(req)
  ? next()
  : res.status(403).json({ message: 'Only admins can manage message templates.' }));

exports.create = async (req, res, next) => {
  try {
    const { data, error } = validate(req.body);
    if (error) return res.status(400).json({ message: error });
    const item = await MessageTemplate.create({
      ...data,
      company: req.telecallerCompany,
      createdBy: req.user._id || req.user.id,
      createdByName: req.user.name || ''
    });
    res.status(201).json({ item: format(item) });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.templateId)) return res.status(400).json({ message: 'Invalid template ID.' });
    const { data, error } = validate(req.body);
    if (error) return res.status(400).json({ message: error });
    const item = await MessageTemplate.findOneAndUpdate(
      { _id: req.params.templateId, company: req.telecallerCompany },
      { $set: data },
      { new: true, runValidators: true }
    ).lean();
    if (!item) return res.status(404).json({ message: 'Template not found.' });
    res.json({ item: format(item) });
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.templateId)) return res.status(400).json({ message: 'Invalid template ID.' });
    const result = await MessageTemplate.deleteOne({ _id: req.params.templateId, company: req.telecallerCompany });
    if (!result.deletedCount) return res.status(404).json({ message: 'Template not found.' });
    res.json({ success: true });
  } catch (error) { next(error); }
};
