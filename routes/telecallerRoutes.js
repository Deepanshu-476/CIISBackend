const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/telecallerController');

router.use(protect);
const pages = ['dashboard', 'call-dashboard', 'assigned-calls', 'todays-calls', 'pending-calls', 'scheduled-calls', 'completed-calls', 'call-history', 'follow-ups', 'converted-leads', 'call-workspace', 'lead-detail'];
const enabled = (keys, slug) => [`admin-telecaller-${slug}`, `ciisuser/telecaller/${slug}`, `telecaller/${slug}`].some(key => keys.has(key));

router.use(async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(req.user?._id || req.user?.id)) {
      return res.status(403).json({ message: 'A valid company user is required.' });
    }
    const record = await Company.findById(company).select('allowedPages').lean();
    const keys = new Set((record?.allowedPages || []).map(value => String(value).replace(/^\/+/, '').toLowerCase()));
    if (!record || !pages.some(slug => enabled(keys, slug))) {
      return res.status(403).json({ message: 'Telecaller pages are not enabled for your company.' });
    }
    req.telecallerPages = keys;
    req.telecallerCompany = company;
    next();
  } catch (error) { next(error); }
});

router.get('/', controller.list);
router.get('/:id', controller.getOne);
// Action permissions remain postponed; enforce company page enablement only.
router.post('/:id/calls', (req, res, next) => {
  if (!enabled(req.telecallerPages, 'call-workspace') && !(req.body?.outcome === 'Note Added' && enabled(req.telecallerPages, 'lead-detail'))) {
    return res.status(403).json({ message: 'This call update page is not enabled for your company.' });
  }
  next();
}, controller.save);

module.exports = router;
