const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const { requireCrmPagePermission } = require('../middleware/crmPagePermission');
const controller = require('../controllers/crmReportController');

const paths = {
  overview: '/ciisUser/crm/reports/overview', leads: '/ciisUser/crm/reports/leads', calls: '/ciisUser/crm/reports/calls',
  visits: '/ciisUser/crm/reports/visits', 'follow-ups': '/ciisUser/crm/reports/follow-ups',
  'team-performance': '/ciisUser/crm/reports/team-performance', 'conversion-funnel': '/ciisUser/crm/reports/conversion-funnel',
  'user-activity': '/ciisUser/crm/reports/user-activity'
};

router.use(protect);
router.get('/:type', async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const path = paths[req.params.type];
    if (!path) return res.status(404).json({ message: 'Report not found.' });
    if (!mongoose.isValidObjectId(company)) return res.status(403).json({ message: 'A valid company is required.' });
    const record = await Company.findById(company).select('allowedPages').lean();
    const keys = (record?.allowedPages || []).map(value => String(value).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    const pageKey = `admin-crm-reports-${req.params.type}`;
    if (!record || (keys.length && !keys.some(key => ['crm', 'admin-crm', pageKey, path.toLowerCase().replace(/^\/ciisuser\//, '')].includes(key)))) {
      return res.status(403).json({ message: 'This CRM report is not enabled for your company.' });
    }
    return requireCrmPagePermission(path)(req, res, next);
  } catch (error) { return next(error); }
}, controller.report);

module.exports = router;
