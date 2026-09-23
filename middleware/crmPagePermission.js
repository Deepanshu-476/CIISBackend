const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');

const companyId = req => req.user?.company?._id || req.user?.company || req.user?.companyId;
const userId = req => req.user?._id || req.user?.id;
const ids = (page, field) => (page?.[field] || [])
  .map(entry => String(entry?.user?._id || entry?.user || ''))
  .filter(Boolean);

const permitted = (page, id, permission) => {
  if (permission === 'edit') return ids(page, 'editUsers').includes(id);
  if (permission === 'delete') return ids(page, 'deleteUsers').includes(id);
  return ['viewUsers', 'editUsers', 'deleteUsers', 'approvers']
    .some(field => ids(page, field).includes(id));
};

const requireCrmPagePermission = (paths, permission = 'view') => async (req, res, next) => {
  try {
    const company = companyId(req);
    const currentUser = userId(req);
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(currentUser)) {
      return res.status(403).json({ message: 'A valid company CRM user is required.' });
    }
    const candidates = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
    const pages = await PagePermission.find({ company, path: { $in: candidates } }).lean();
    const id = String(currentUser);
    if (!pages.some(page => permitted(page, id, permission))) {
      return res.status(403).json({ message: `You do not have ${permission} access for this CRM page.` });
    }
    req.crmCompany = company;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { requireCrmPagePermission };
