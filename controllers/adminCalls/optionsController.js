const LeadSource = require('../../models/LeadSource');
const LeadType = require('../../models/LeadType');
const User = require('../../models/User');

const OUTCOMES = [
  'Connected',
  'Interested',
  'Not Interested',
  'Need Callback',
  'Follow-up',
  'Call Later',
  'No Answer',
  'Busy',
  'Switched Off',
  'Not Reachable',
  'Wrong Number',
  'Wrong Person',
  'Invalid Number',
  'Language Barrier',
  'Do Not Call',
  'Duplicate',
  'Spam',
  'Call Closed',
  'Converted'
];

const CALL_TYPES = ['Outbound', 'Inbound', 'Follow-up'];

exports.getOptions = async (req, res, next) => {
  try {
    const company = req.crmCompany;

    const [sources, leadTypes, users] = await Promise.all([
      LeadSource.find({ company, status: 'Active' }).select('name').sort({ name: 1 }).lean(),
      LeadType.find({ company, status: 'Active' }).select('name').sort({ name: 1 }).lean(),
      User.find({
        company,
        isActive: { $ne: false },
        companyRole: { $not: /^client$/i },
        role: { $not: /^client$/i }
      }).select('name email role jobRole').sort({ name: 1 }).lean()
    ]);

    res.json({
      sources,
      leadTypes,
      telecallers: users,
      outcomes: OUTCOMES,
      callTypes: CALL_TYPES
    });
  } catch (error) {
    next(error);
  }
};

