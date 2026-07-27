const express = require('express');
const router = express.Router();
const { getUserProfile } = require('../controllers/profileController');
const userController = require('../controllers/userControllers');
const { protect } = require('../../middleware/authMiddleware');


router.get('/:id', protect, getUserProfile);
router.put('/:id', protect, userController.updateSelfUser);

module.exports = router;
