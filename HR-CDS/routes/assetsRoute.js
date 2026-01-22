const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const { protect, authorize } = require('../../middleware/authMiddleware');
const isAdmin = require('../../middleware/isAdmin');
const isManager = require('../../middleware/isManager');

// 🔹 USER ROUTES
router.post('/request', protect, assetController.requestAsset);
router.get('/my-requests', protect, assetController.getMyRequests);

// 🔹 ADMIN ROUTES
router.get('/all', protect, isAdmin, assetController.getAllRequests);          // View all requests
router.patch('/update/:id', protect, isAdmin, assetController.updateRequestStatus); // Update status
router.delete('/delete/:id', protect, isManager, assetController.deleteRequest);      // Delete request

module.exports = router;
