const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/crmLeadController');
router.use(protect);
// Action permissions are postponed for functionality testing, as requested.
const context = page => async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company)) return res.status(403).json({ message: 'A valid company is required.' });
    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(v => String(v).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    if (!record || (allowed.length && !allowed.some(v => ['crm', 'admin-crm', `admin-crm-${page}`, `crm/admin/${page}`].includes(v)))) return res.status(403).json({ message: 'This lead page is not enabled for your company.' });
    req.crmCompany = company;
    next();
  } catch (error) { next(error); }
};
router.get('/options', context('add-lead'), controller.options);
router.post('/', context('add-lead'), controller.create);
router.get('/team', context('all-leads'), controller.team);
router.put('/:id/assign', context('all-leads'), controller.assign);
router.get('/', context('all-leads'), controller.list);
module.exports = router;
