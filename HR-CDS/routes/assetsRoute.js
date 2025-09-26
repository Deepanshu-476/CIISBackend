const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const auth = require('../../middleware/authMiddleware');
const isAdmin = require('../../middleware/isAdmin');
const isManager = require('../../middleware/isManager');

// 🔹 USER ROUTES
router.post('/request', auth, assetController.requestAsset);
router.get('/my-requests', auth, assetController.getMyRequests);

// 🔹 ADMIN ROUTES
router.get('/all', auth, isAdmin, assetController.getAllRequests);          // View all requests
router.patch('/update/:id', auth, isAdmin, assetController.updateRequestStatus); // Update status
router.delete('/delete/:id', auth,isManager, assetController.deleteRequest);      // Delete request

module.exports = router;
