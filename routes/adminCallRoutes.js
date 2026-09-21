const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/adminCallController');
const { requireCrmPagePermission } = require('../middleware/crmPagePermission');

router.use(protect);

const context = page => async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company)) {
      return res.status(403).json({ message: 'A valid company is required.' });
    }
    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(v => String(v).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    const aliases = ['crm', 'admin-crm', 'call-management', 'admin-crm-call-management', page, `admin-crm-${page}`, `crm/admin/${page}`, `admin-${page}`];
    if (record && allowed.length > 0 && !allowed.some(v => aliases.includes(v))) {
      return res.status(403).json({ message: 'This page is not enabled for your company.' });
    }
    req.crmCompany = company;
    next();
  } catch (error) { next(error); }
};

const page = slug => requireCrmPagePermission(`/ciisUser/crm/admin/${slug}`);
router.get('/dashboard', context('dashboard'), page('dashboard'), controller.dashboard);
router.get('/calls/overview', context('call-overview'), page('call-overview'), controller.overview);
router.get('/calls/assigned', context('assigned-calls'), page('assigned-calls'), controller.assignedCalls);
router.get('/calls/today', context('todays-calls'), page('todays-calls'), controller.todaysCalls);
router.get('/calls/history', context('call-history'), page('call-history'), controller.callHistory);
router.get('/calls/pending', context('pending-calls'), page('pending-calls'), controller.pendingCalls);
router.get('/calls/scheduled', context('scheduled-calls'), page('scheduled-calls'), controller.scheduledCalls);
router.get('/calls/completed', context('completed-calls'), page('completed-calls'), controller.completedCalls);
router.get('/calls/converted', context('converted-calls'), page('converted-calls'), controller.convertedCalls);
router.get('/calls/transferred', context('transferred-calls'), page('transferred-calls'), controller.transferredCalls);
router.get('/calls/follow-ups', context('follow-ups'), page('follow-ups'), controller.followUps);

module.exports = router;
