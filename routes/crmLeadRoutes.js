const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const { requireCrmPagePermission } = require('../middleware/crmPagePermission');
const controller = require('../controllers/crmLeadController');
router.use(protect);
// Action permissions are postponed for functionality testing, as requested.
const context = page => async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company)) return res.status(403).json({ message: 'A valid company is required.' });
    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(v => String(v).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    const pageList = Array.isArray(page) ? page : [page];
    const aliases = ['crm', 'admin-crm', ...pageList.flatMap(p => [p, `admin-crm-${p}`, `crm/admin/${p}`])];
    if (!record || (allowed.length && !allowed.some(v => aliases.includes(v)))) return res.status(403).json({ message: 'This lead page is not enabled for your company.' });
    req.crmCompany = company;
    next();
  } catch (error) { next(error); }  
};
router.use('/transfer', context('import-export-leads'), requireCrmPagePermission('/ciisUser/crm/admin/import-export-leads', 'view'), require('./leadTransferRoutes'));
router.get('/options', context('add-lead'), requireCrmPagePermission('/ciisUser/crm/admin/add-lead'), controller.options);
router.get('/overview', context('lead-overview'), requireCrmPagePermission('/ciisUser/crm/admin/lead-overview'), require('../controllers/leadOverviewController').overview);
router.post('/', context('add-lead'), requireCrmPagePermission('/ciisUser/crm/admin/add-lead', 'edit'), controller.create);
router.get('/team', context(['all-leads', 'assignments', 'assignment-bulk', 'workload', 'assigned-calls', 'todays-calls', 'follow-ups', 'pending-calls', 'completed-calls', 'converted-calls', 'transferred-calls']), requireCrmPagePermission([
  '/ciisUser/crm/admin/all-leads', '/ciisUser/crm/admin/assignments', '/ciisUser/crm/admin/assignment-bulk',
  '/ciisUser/crm/admin/workload', '/ciisUser/crm/admin/assigned-calls', '/ciisUser/crm/admin/todays-calls',
  '/ciisUser/crm/admin/follow-ups', '/ciisUser/crm/admin/pending-calls', '/ciisUser/crm/admin/completed-calls',
  '/ciisUser/crm/admin/converted-calls', '/ciisUser/crm/admin/transferred-calls'
]), controller.team);
router.put('/:id/assign', context(['all-leads', 'assignments']), requireCrmPagePermission(['/ciisUser/crm/admin/all-leads', '/ciisUser/crm/admin/assignments'], 'edit'), controller.assign);
router.get('/', context('all-leads'), requireCrmPagePermission('/ciisUser/crm/admin/all-leads'), controller.list);
module.exports = router;
