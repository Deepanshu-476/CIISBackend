const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');

const companyId = req => req.user?.company?._id || req.user?.company || req.user?.companyId;
const userId = req => req.user?._id || req.user?.id;
const ids = (page, field) => (page?.[field] || [])
  .map(entry => String(entry?.user?._id || entry?.user || ''))
  .filter(Boolean);

const permitted = (page, id, permission, req) => {
  if (permission === 'delete') return ids(page, 'deleteUsers').includes(id);
  if (permission === 'edit') return ids(page, 'editUsers').includes(id);
  if (['viewUsers', 'editUsers', 'deleteUsers', 'approvers']
    .some(field => ids(page, field).includes(id))) return true;

  // Non-client company staff access
  const user = req?.user;
  const userRole = String(user?.companyRole || user?.jobRole || user?.role || '').toLowerCase();
  if (userRole === 'client') return false;

  return false;
};

const requireCrmPagePermission = (paths, permission = 'view') => async (req, res, next) => {
  try {
    const company = companyId(req);
    const currentUser = userId(req);
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(currentUser)) {
      return res.status(403).json({ message: 'A valid company CRM user is required.' });
    }
    const userRole = String(req.user?.companyRole || req.user?.jobRole || req.user?.role || '').toLowerCase();
    if (userRole === 'client') {
      return res.status(403).json({ message: 'Clients do not have access to CRM admin pages.' });
    }
    const candidates = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
    const pages = await PagePermission.find({ company, path: { $in: candidates } }).lean();
    const id = String(currentUser);
    if (pages.length === 0 || !pages.some(page => permitted(page, id, permission, req))) {
      return res.status(403).json({ message: `You do not have ${permission} access for this CRM page.` });
    }
    req.crmCompany = company;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { requireCrmPagePermission };
