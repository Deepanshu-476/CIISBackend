const mongoose = require('mongoose');
const LeadSource = require('../models/LeadSource');

const validate = body => {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const status = body?.status ?? 'Active';
  if (!name || name.length > 100) throw new Error('Enter a lead source name between 1 and 100 characters.');
  if (!['Active', 'Inactive'].includes(status)) throw new Error('Choose Active or Inactive status.');
  return { name, normalizedName: name.toLowerCase(), status };
};
const fail = (res, error) => {
  if (error.code === 11000) return res.status(409).json({ message: 'A lead source with this name already exists.' });
  return res.status(500).json({ message: 'Unable to save lead sources. Please try again.' });
};
exports.list = async (req, res) => {
  try {
    const items = await LeadSource.find({ company: req.leadSourceCompany }).sort({ name: 1, _id: 1 }).lean();
    res.json({ items });
  } catch (error) { fail(res, error); }
};
exports.create = async (req, res) => {
  let data;
  try { data = validate(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const item = await LeadSource.create({ ...data, company: req.leadSourceCompany, createdBy: req.user._id || req.user.id, isSystem: data.normalizedName === 'self' });
    res.status(201).json({ item });
  } catch (error) { fail(res, error); }
};
exports.update = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead source ID.' });
  let data;
  try { data = validate(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const item = await LeadSource.findOneAndUpdate({ _id: req.params.id, company: req.leadSourceCompany }, { $set: data }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: 'Lead type not found.' });
    res.json({ item });
  } catch (error) { fail(res, error); }
};
exports.remove = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead source ID.' });
  try {
    // Raw collection query also covers future leadSource references before the Lead schema is extended.
    const used = await mongoose.connection.collection('leads').findOne({ company: req.leadSourceCompany, leadSource: { $in: [new mongoose.Types.ObjectId(req.params.id), req.params.id] } }, { projection: { _id: 1 } });
    if (used) return res.status(409).json({ message: 'This source is used by leads. Set it to Inactive instead.' });
    const item = await LeadSource.findOneAndDelete({ _id: req.params.id, company: req.leadSourceCompany, isSystem: false });
    if (!item) return res.status(409).json({ message: 'Lead type was not found or is a protected system source.' });
    res.json({ success: true });
  } catch (error) { fail(res, error); }
};
exports.validate = validate;
