const mongoose = require('mongoose');
const validator = require('validator');
const Lead = require('../models/Lead');
const LeadType = require('../models/LeadType');
const LeadSource = require('../models/LeadSource');

function toTitleCase(str = '') {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s|-|\.)\S/g, char => char.toUpperCase());
}

function validate(body = {}) {
  const errors = {};
  const data = {};
  const limits = { fullName: 100, email: 254, phone: 30, gender: 10, leadDate: 10, address: 1000, remarks: 5000,
    customField1: 1000, customField2: 1000, customField3: 1000, customField4: 1000, customField5: 1000 };
  for (const [key, limit] of Object.entries(limits)) {
    data[key] = typeof body[key] === 'string' ? body[key].trim() : '';
    if (data[key].length > limit) errors[key] = `Maximum ${limit} characters allowed.`;
  }
  if (!data.fullName) {
    errors.fullName = 'Full Name is required.';
  } else {
    data.fullName = toTitleCase(data.fullName);
  }
  data.email = data.email.toLowerCase();
  if (!validator.isEmail(data.email)) errors.email = 'Enter a valid email address.';
  if (!/^\d{10}$/.test(data.phone)) errors.phone = 'Enter a valid 10-digit phone number.';
  if (!['', 'Male', 'Female', 'Other'].includes(data.gender)) errors.gender = 'Choose a valid gender.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.leadDate) || !validator.isDate(data.leadDate, { format: 'YYYY-MM-DD', strictMode: true })) errors.leadDate = 'Enter a valid lead date.';
  for (const key of ['leadType', 'leadSource']) {
    data[key] = typeof body[key] === 'string' ? body[key] : '';
    if (!mongoose.isValidObjectId(data[key])) errors[key] = `Select a valid ${key === 'leadType' ? 'lead type' : 'lead source'}.`;
  }
  const { fullName, ...fields } = data;
  return { data: { ...fields, name: fullName }, errors };
}
exports.validate = validate;
exports.options = async (req, res, next) => {
  try {
    const filter = { company: req.crmCompany, status: 'Active' };
    const [types, sources] = await Promise.all([
      LeadType.find(filter).select('name').sort({ name: 1 }).lean(),
      LeadSource.find(filter).select('name').sort({ name: 1 }).lean()
    ]);
    res.json({ types, sources });
  } catch (error) { next(error); }
};
exports.create = async (req, res, next) => {
  try {
    const { data, errors } = validate(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Please check the highlighted fields.', errors });
    const company = req.crmCompany;
    const [type, source] = await Promise.all([
      LeadType.findOne({ _id: data.leadType, company, status: 'Active' }).lean(),
      LeadSource.findOne({ _id: data.leadSource, company, status: 'Active' }).lean()
    ]);
    if (!type) errors.leadType = 'This lead type is unavailable or inactive. Select an active type.';
    if (!source) errors.leadSource = 'This lead source is unavailable or inactive. Select an active source.';
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Please update the lead classification.', errors });
    const item = await Lead.create({ ...data, company, source: source.name, status: 'new', assignedTo: null,
      createdBy: req.user._id || req.user.id });
    res.status(201).json({ item });
  } catch (error) { next(error); }
};
exports.list = async (req, res, next) => {
  try {
    const items = await Lead.find({ company: req.crmCompany }).sort({ createdAt: -1, _id: -1 })
      .populate('leadType', 'name').populate('leadSource', 'name').populate('assignedTo', 'name').lean();
    res.json({ items });
  } catch (error) { next(error); }
};

exports.team = async (req, res, next) => {
  try {
    const User = require('../models/User');
    let clientUserIds = [];
    try {
      const Client = mongoose.models.Client || require('../HR-CDS/models/Client');
      const clients = await Client.find({ userId: { $exists: true, $ne: null } }).select('userId').lean();
      clientUserIds = clients.map(c => String(c.userId));
    } catch (e) {
      // Ignore if Client model not available
    }

    const users = await User.find({
      company: req.crmCompany,
      isActive: { $ne: false },
      companyRole: { $not: /^client$/i },
      role: { $not: /^client$/i }
    })
      .select('name email role jobRole companyRole')
      .sort({ name: 1 })
      .lean();

    const employees = users.filter(u => {
      const cRole = String(u.companyRole || '').trim().toLowerCase();
      const r = String(u.role || '').trim().toLowerCase();
      const isClientRole = cRole === 'client' || r === 'client';
      const isClientUser = clientUserIds.includes(String(u._id));
      return !isClientRole && !isClientUser;
    });

    res.json({ users: employees });
  } catch (error) { next(error); }
};

exports.assign = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid lead ID.' });
    }

    const lead = await Lead.findOne({ _id: id, company: req.crmCompany });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    const { userId } = req.body;
    if (!userId) {
      lead.assignedTo = null;
      lead.assignedAt = null;
      await lead.save();
      const populatedLead = await Lead.findById(lead._id)
        .populate('leadType', 'name')
        .populate('leadSource', 'name')
        .lean();
      return res.json({ message: 'Lead unassigned successfully.', item: populatedLead });
    }

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid user ID.' });
    }

    const User = require('../models/User');
    const user = await User.findOne({ _id: userId, company: req.crmCompany }).lean();
    if (!user) {
      return res.status(404).json({ message: 'Selected user was not found in your company.' });
    }

    const Client = require('../HR-CDS/models/Client');
    const isClient = ['role', 'companyRole'].some(key => String(user[key] || '').trim().toLowerCase() === 'client');
    const clientRecord = await Client.findOne({ userId: user._id }).select('_id').lean();
    if (user.isActive === false || isClient || clientRecord) {
      return res.status(400).json({ message: 'Choose an active employee from your company.' });
    }

    lead.assignedTo = user._id;
    lead.assignedAt = new Date();
    await lead.save();

    const populatedLead = await Lead.findById(lead._id)
      .populate('leadType', 'name')
      .populate('leadSource', 'name')
      .populate('assignedTo', 'name')
      .lean();

    res.json({ message: `Lead assigned to ${user.name} successfully.`, item: populatedLead });
  } catch (error) { next(error); }
};
