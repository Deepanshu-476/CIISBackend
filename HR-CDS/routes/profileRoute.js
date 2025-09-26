const express = require('express');
const router = express.Router();
const { getUserProfile } = require('../controllers/profileController');

// @route GET /api/users/:id
router.get('/:id', getUserProfile);

module.exports = router;
