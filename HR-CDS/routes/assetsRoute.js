// assetRoutes.js
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

// 🧪 TEST ROUTES
router.get('/test', protect, (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode;
    const userId = req.user._id;
    const userName = req.user.name;
    const userEmail = req.user.email;
    
    res.status(200).json({
      success: true,
      message: 'Company check test successful',
      data: {
        user: {
          id: userId,
          name: userName,
          email: userEmail,
          companyCode: userCompanyCode || 'Not set',
          department: req.user.department || 'Not set'
        },
        testInfo: {
          timestamp: new Date().toISOString(),
          endpoint: '/api/assets/test/company-check',
          purpose: 'Test company code retrieval and user verification'
        }
      }
    });
  } catch (error) {
    console.error('Test route error:', error);
    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error.message
    });
  }
});

router.get('/test/asset-requests', protect, async (req, res) => {
  try {
    const AssetRequest = require('../models/AssetRequest');
    const User = require('../../models/User');
    
    const userCompanyCode = req.user.companyCode;
    
    // Test 1: Get user's own requests
    const myRequests = await AssetRequest.find({ 
      user: req.user._id 
    }).limit(5);
    
    // Test 2: Get all requests from user's company
    const companyRequests = userCompanyCode ? 
      await AssetRequest.find({ 
        companyCode: userCompanyCode 
      }).limit(5) : [];
    
    // Test 3: Get users from same company
    const companyUsers = userCompanyCode ?
      await User.find({ 
        companyCode: userCompanyCode 
      }).select('name email department').limit(5) : [];
    
    res.status(200).json({
      success: true,
      message: 'Asset requests test successful',
      data: {
        userCompanyCode,
        myRequestsCount: myRequests.length,
        myRequests: myRequests,
        companyRequestsCount: companyRequests.length,
        companyRequestsSample: companyRequests,
        companyUsersCount: companyUsers.length,
        companyUsersSample: companyUsers,
        companyFilterTest: {
          working: userCompanyCode ? true : false,
          message: userCompanyCode ? 
            `Company filtering enabled for ${userCompanyCode}` : 
            'Company code not found in user'
        }
      }
    });
  } catch (error) {
    console.error('Asset requests test error:', error);
    res.status(500).json({
      success: false,
      message: 'Asset requests test failed',
      error: error.message
    });
  }
});

module.exports = router;