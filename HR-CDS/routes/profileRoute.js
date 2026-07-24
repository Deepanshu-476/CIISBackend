const express = require('express');
const router = express.Router();
const { getUserProfile } = require('../controllers/profileController');
const { protect } = require('../../middleware/authMiddleware');

router.get('/:id', protect, getUserProfile);

module.exports = router;
