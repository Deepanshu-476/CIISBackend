const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/telecallerController');
router.use(protect);
router.use(async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(req.user?._id || req.user?.id)) return res.status(403).json({ message: 'A valid company user is required.' });
    const record = await Company.findById(company).select('allowedPages').lean();
    const pages = (record?.allowedPages || []).map(value => String(value).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, ''));
    const enabled = req.method === 'GET'
      ? pages.some(page => page.startsWith('admin-telecaller-') || page.startsWith('telecaller/'))
      : pages.some(page => ['admin-telecaller-call-workspace', 'telecaller/call-workspace'].includes(page));
    if (!record || !enabled) return res.status(403).json({ message: 'This telecaller page is not enabled for your company.' });
    req.telecallerCompany = company;
    next();
  } catch (error) { next(error); }
});
// Match the existing CRM policy: action-level Page Management enforcement is postponed.
// Every read and write remains scoped to the authenticated user's assigned leads.
router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/:id/calls', controller.save);
module.exports = router;
