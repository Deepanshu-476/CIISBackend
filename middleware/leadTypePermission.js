const mongoose = require('mongoose');
const Company = require('../models/Company');

// Temporary functionality-testing mode requested by the user.
// Restore action-level Page Management checks when permission work resumes.
// Authentication is still enforced by the router; company isolation stays here.
module.exports = () => async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const user = String(req.user?._id || req.user?.id || '');
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(user)) {
      return res.status(403).json({ message: 'A valid company user is required.' });
    }
    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(v => String(v).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    if (!record || (allowed.length && !allowed.some(v => ['admin-crm-lead-types', 'crm/admin/lead-types', 'crm', 'admin-crm'].includes(v)))) {
      return res.status(403).json({ message: 'Lead Type is not enabled for your company.' });
    }
    req.leadTypeCompany = company;
    next();
  } catch (error) { next(error); }
};
