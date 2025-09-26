const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const auth = require('../../middleware/authMiddleware');
const isAdmin = require('../../middleware/isAdmin');

// Public
router.get('/', alertController.getAlerts);

// Admin-only
router.post('/', auth, isAdmin, alertController.addAlert);
router.put('/:id', auth, isAdmin, alertController.updateAlert);
router.delete('/:id', auth, isAdmin, alertController.deleteAlert);
router.patch('/:id/read', auth, alertController.markAsRead);
module.exports = router;
