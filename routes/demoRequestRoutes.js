const express = require('express');
const router = express.Router();
const {
  createDemoRequest,
  getDemoRequests,
  updateDemoRequest,
  deleteDemoRequest
} = require('../controllers/demoRequestController');
const { protect } = require('../middleware/authMiddleware');

const requireCiisGlobalAdmin = (req, res, next) => {
  if (String(req.user?.email || '').trim().toLowerCase() !== 'ashutoshrai130@gmail.com') {
    return res.status(403).json({
      success: false,
      message: 'Only the CIIS global administrator can manage demo requests'
    });
  }
  next();
};

// Public route to submit demo request from landing page
router.post('/', createDemoRequest);

// SuperAdmin routes to manage demo requests
router.use(protect, requireCiisGlobalAdmin);
router.get('/', getDemoRequests);
router.put('/:id', updateDemoRequest);
router.patch('/:id', updateDemoRequest);
router.delete('/:id', deleteDemoRequest);

module.exports = router;
