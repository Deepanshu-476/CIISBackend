const mongoose = require('mongoose');
const Company = require('../models/Company');
const { requireCrmPagePermission } = require('./crmPagePermission');

module.exports = (permission = 'view') => async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const user = String(req.user?._id || req.user?.id || '');
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(user)) {
      return res.status(403).json({ message: 'A valid company user is required.' });
    }
    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(v => String(v).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    if (!record || (allowed.length && !allowed.some(v => ['admin-crm-lead-sources', 'crm/admin/lead-sources', 'crm', 'admin-crm'].includes(v)))) {
      return res.status(403).json({ message: 'Lead Source is not enabled for your company.' });
    }
    return requireCrmPagePermission('/ciisUser/crm/admin/lead-sources', permission)(req, res, error => {
      if (error) return next(error);
      req.leadSourceCompany = company;
      return next();
    });
  } catch (error) { next(error); }
};
