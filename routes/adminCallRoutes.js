const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');

const optionsController = require('../controllers/adminCalls/optionsController');
const overviewController = require('../controllers/adminCalls/overviewController');
const assignedController = require('../controllers/adminCalls/assignedController');
const todaysController = require('../controllers/adminCalls/todaysController');
const pendingController = require('../controllers/adminCalls/pendingController');
const scheduledController = require('../controllers/adminCalls/scheduledController');
const completedController = require('../controllers/adminCalls/completedController');
const convertedController = require('../controllers/adminCalls/convertedController');
const transferredController = require('../controllers/adminCalls/transferredController');
const historyController = require('../controllers/adminCalls/historyController');

router.use(protect);

// Company isolation & permission context check
const context = page => async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company)) {
      return res.status(403).json({ message: 'A valid company is required.' });
    }

    const record = await Company.findById(company).select('allowedPages').lean();
    const allowed = (record?.allowedPages || []).map(v =>
      String(v).toLowerCase().replace(/^\/+/, '').replace(/^ciisuser\//, '')
    );

    // If company has restricted pages, check if any CRM call page or general CRM is enabled
    if (
      record &&
      allowed.length &&
      !allowed.some(v =>
        ['crm', 'admin-crm', `admin-crm-${page}`, `crm/admin/${page}`, 'admin-crm-calls', 'crm/admin/calls'].includes(v) ||
        (page === 'options' && allowed.some(p => p.includes('call') || p.includes('crm') || p.includes('lead')))
      )
    ) {
      return res.status(403).json({ message: 'This call management page is not enabled for your company.' });
    }

    req.crmCompany = company;
    next();
  } catch (error) {
    next(error);
  }
};

// Common options
router.get('/options', context('options'), optionsController.getOptions);

// 1. Call Overview
router.get('/overview', context('call-overview'), overviewController.getOverview);

// 2. Assigned Calls
router.get('/assigned', context('assigned-calls'), assignedController.getAssignedCalls);

// 3. Today's Calls
router.get('/today', context('todays-calls'), todaysController.getTodaysCalls);

// 4. Pending Calls
router.get('/pending', context('pending-calls'), pendingController.getPendingCalls);

// 5. Scheduled Calls
router.get('/scheduled', context('scheduled-calls'), scheduledController.getScheduledCalls);

// 6. Completed Calls
router.get('/completed', context('completed-calls'), completedController.getCompletedCalls);

// 7. Converted Calls
router.get('/converted', context('converted-calls'), convertedController.getConvertedCalls);

// 8. Transferred Calls
router.get('/transferred', context('transferred-calls'), transferredController.getTransferredCalls);
router.post('/transferred', context('transferred-calls'), transferredController.createTransfer);
router.put('/transferred/:id/accept', context('transferred-calls'), transferredController.acceptTransfer);

// 9. Call History
router.get('/history', context('call-history'), historyController.getCallHistory);

module.exports = router;

