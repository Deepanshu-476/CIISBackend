const express = require('express');
const router = express.Router();
const {
  createDemoRequest,
  getDemoRequests,
  updateDemoRequest,
  deleteDemoRequest
} = require('../controllers/demoRequestController');

// Public route to submit demo request from landing page
router.post('/', createDemoRequest);

// SuperAdmin routes to manage demo requests
router.get('/', getDemoRequests);
router.put('/:id', updateDemoRequest);
router.patch('/:id', updateDemoRequest);
router.delete('/:id', deleteDemoRequest);

module.exports = router;
