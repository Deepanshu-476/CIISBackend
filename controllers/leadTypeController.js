const mongoose = require('mongoose');
const LeadType = require('../models/LeadType');

const validate = body => {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const status = body?.status ?? 'Active';
  if (!name || name.length > 100) throw new Error('Enter a lead type name between 1 and 100 characters.');
  if (!['Active', 'Inactive'].includes(status)) throw new Error('Choose Active or Inactive status.');
  return { name, normalizedName: name.toLowerCase(), status };
};
const fail = (res, error) => {
  if (error.code === 11000) return res.status(409).json({ message: 'A lead type with this name already exists.' });
  return res.status(500).json({ message: 'Unable to save lead types. Please try again.' });
};
exports.list = async (req, res) => {
  try {
    const items = await LeadType.find({ company: req.leadTypeCompany }).sort({ name: 1, _id: 1 }).lean();
    res.json({ items });
  } catch (error) { fail(res, error); }
};
exports.create = async (req, res) => {
  let data;
  try { data = validate(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const item = await LeadType.create({ ...data, company: req.leadTypeCompany, createdBy: req.user._id || req.user.id, isSystem: data.normalizedName === 'marketing' });
    res.status(201).json({ item });
  } catch (error) { fail(res, error); }
};
exports.update = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead type ID.' });
  let data;
  try { data = validate(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const item = await LeadType.findOneAndUpdate({ _id: req.params.id, company: req.leadTypeCompany }, { $set: data }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: 'Lead type not found.' });
    res.json({ item });
  } catch (error) { fail(res, error); }
};
exports.remove = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid lead type ID.' });
  try {
    // Raw collection query also covers future leadType references before the Lead schema is extended.
    const used = await mongoose.connection.collection('leads').findOne({ company: req.leadTypeCompany, leadType: { $in: [new mongoose.Types.ObjectId(req.params.id), req.params.id] } }, { projection: { _id: 1 } });
    if (used) return res.status(409).json({ message: 'This type is used by leads. Set it to Inactive instead.' });
    const item = await LeadType.findOneAndDelete({ _id: req.params.id, company: req.leadTypeCompany, isSystem: false });
    if (!item) return res.status(409).json({ message: 'Lead type was not found or is a protected system type.' });
    res.json({ success: true });
  } catch (error) { fail(res, error); }
};
exports.validate = validate;
