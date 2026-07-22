
const express = require('express');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const assetController = require('../controllers/assetRequestController');
const { protect } = require('../../middleware/authMiddleware');

const commentUploadDir = path.join(__dirname, '../../uploads/asset-comments');
fs.mkdirSync(commentUploadDir, { recursive: true });

const uploadCommentImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, commentUploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      cb(null, `asset_comment_${Date.now()}_${Math.round(Math.random() * 1e9)}${extension}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
    if (allowedTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed'));
  }
});

router.post('/request', protect, assetController.requestAsset);
router.get('/my-requests', protect, assetController.getMyRequests);


router.get('/all', protect, assetController.getAllRequests);          
router.patch('/update/:id', protect, uploadCommentImage.single('commentImage'), assetController.updateRequestStatus); 
router.delete('/delete/:id', protect, assetController.deleteRequest);      


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
    
    
    const myRequests = await AssetRequest.find({ 
      user: req.user._id 
    }).limit(5);
    
    
    const companyRequests = userCompanyCode ? 
      await AssetRequest.find({ 
        companyCode: userCompanyCode 
      }).limit(5) : [];
    
    
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

router.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError || error?.message?.includes('Only JPG')) {
    return res.status(400).json({
      success: false,
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large. Maximum file size is 5 MB.'
        : error.message
    });
  }

  res.status(500).json({
    success: false,
    message: 'Asset comment image upload failed'
  });
});

module.exports = router;
