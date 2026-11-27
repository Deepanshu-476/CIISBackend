const mongoose = require('mongoose');
const { hasPageAccess } = require('./pageAccess');
const { scopedUserIds } = require('../utils/branchScope');

const companyId = req => req.user?.company?._id || req.user?.company || req.user?.companyId;
const userId = req => req.user?._id || req.user?.id;

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
    if (!(await hasPageAccess(req.user, { paths: candidates, action: permission, allowOwner: false }))) {
      return res.status(403).json({ message: `You do not have ${permission} access for this CRM page.` });
    }
    req.crmCompany = company;
    // Branch rule: null for owner/admin, otherwise the users of the viewer's branches.
    req.crmUserScope = await scopedUserIds(req.user);
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { requireCrmPagePermission };
