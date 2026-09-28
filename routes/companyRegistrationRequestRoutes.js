const express = require('express');
const router = express.Router();
const {
  createOrUpdateRegistrationRequest,
  getRegistrationRequests,
  updateRegistrationRequest
} = require('../controllers/companyRegistrationRequestController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

router.post('/', createOrUpdateRegistrationRequest);

router.use(protect, restrictTo('super_admin'));
router.get('/', getRegistrationRequests);
router.patch('/:id', updateRegistrationRequest);

module.exports = router;
