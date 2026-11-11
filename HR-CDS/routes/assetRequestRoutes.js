
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
    const allowedTypes = new Set([
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]);
    if (allowedTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP, GIF, PDF, DOC, or DOCX files are allowed'));
  }
});

router.post('/request', protect, assetController.requestAsset);
router.get('/my-requests', protect, assetController.getMyRequests);
router.get('/available', protect, assetController.getAvailableAssets);
router.post('/:id/return-request', protect, assetController.requestAssetReturn);
router.post('/:id/deposit', protect, assetController.depositAsset);
router.post('/:id/confirm-deposit', protect, assetController.confirmAssetDeposit);


router.get('/all', protect, assetController.getAllRequests);          
router.patch(
  '/update/:id',
  protect,
  uploadCommentImage.fields([
    { name: 'commentImages', maxCount: 3 },
    { name: 'commentImage', maxCount: 1 }
  ]),
  assetController.updateRequestStatus
);
router.delete('/update/:id/comments/:commentId/attachment', protect, assetController.deleteCommentAttachment);
router.delete('/delete/:id', protect, assetController.deleteRequest);      
router.delete('/:id', protect, assetController.deleteRequest);      





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
