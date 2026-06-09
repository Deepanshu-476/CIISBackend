// routes/allTaskRoute.js
const express = require('express');
const router = express.Router();
const allTaskController = require('../controllers/allTaskController');
const { protect } = require('../../middleware/authMiddleware'); 

router.get('/', protect, allTaskController.getAllMyTaskViews);
router.get('/stats', protect, allTaskController.getAllMyTaskStats);
router.get('/user/:userId', protect, allTaskController.getUserAllTasksPaginated);
router.get('/user/:userId/stats', protect, allTaskController.getUserTaskStats);

module.exports = router;
