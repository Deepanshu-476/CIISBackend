const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/crmAssignmentController');
const { requireCrmPagePermission } = require('../middleware/crmPagePermission');

router.use(protect);
router.use(async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company)) return res.status(403).json({ message: 'A valid company is required.' });
    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(value => String(value).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    const assignmentPages = ['admin-crm-assignments', 'admin-crm-assignment-bulk', 'admin-crm-assignment-history', 'admin-crm-workload',
      'crm/admin/assignments', 'crm/admin/assignment-bulk', 'crm/admin/assignment-history', 'crm/admin/workload'];
    if (!record || (allowed.length && !allowed.some(value => ['crm', 'admin-crm', ...assignmentPages].includes(value)))) {
      return res.status(403).json({ message: 'CRM assignments are not enabled for your company.' });
    }
    req.crmCompany = company;
    next();
  } catch (error) { next(error); }
});

router.get('/overview', requireCrmPagePermission('/ciisUser/crm/admin/assignments'), controller.overview);
router.post('/bulk', requireCrmPagePermission('/ciisUser/crm/admin/assignment-bulk', 'edit'), controller.bulkAssign);
router.get('/history', requireCrmPagePermission('/ciisUser/crm/admin/assignment-history'), controller.history);
router.get('/workload', requireCrmPagePermission('/ciisUser/crm/admin/workload'), controller.workload);

module.exports = router;
