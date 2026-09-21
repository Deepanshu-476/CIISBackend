const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/adminCallController');

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

router.get('/dashboard', context('dashboard'), controller.dashboard);
router.get('/calls/overview', context('call-overview'), controller.overview);
router.get('/calls/assigned', context('assigned-calls'), controller.assignedCalls);
router.get('/calls/today', context('todays-calls'), controller.todaysCalls);
router.get('/calls/history', context('call-history'), controller.callHistory);
router.get('/calls/pending', context('pending-calls'), controller.pendingCalls);
router.get('/calls/scheduled', context('scheduled-calls'), controller.scheduledCalls);
router.get('/calls/completed', context('completed-calls'), controller.completedCalls);
router.get('/calls/converted', context('converted-calls'), controller.convertedCalls);
router.get('/calls/transferred', context('transferred-calls'), controller.transferredCalls);
router.get('/calls/follow-ups', context('follow-ups'), controller.followUps);

module.exports = router;

