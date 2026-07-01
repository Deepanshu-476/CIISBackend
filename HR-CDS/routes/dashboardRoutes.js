const express = require('express');
const router = express.Router();
const { getDashboardActivity } = require('../controllers/dashboardController');
const { protect } = require('../../middleware/authMiddleware');


router.use(protect);


router.get('/recent-activity', getDashboardActivity);

module.exports = router;