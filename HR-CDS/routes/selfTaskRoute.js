
const express = require('express');
const router = express.Router();
const selfTaskController = require('../controllers/selfTaskController');
const { protect } = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');

const uploadFields = upload.fields([
  { name: 'files', maxCount: 10 },
  { name: 'voiceNote', maxCount: 1 }
]);

const safeUploadFields = (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) {
      console.error('Task upload error:', err);
      return res.status(400).json({
        success: false,
        error: err.message || 'File upload error'
      });
    }
    next();
  });
};

router.post('/create', protect, safeUploadFields, selfTaskController.createTaskForSelf);
router.get('/', protect, selfTaskController.getPersonalTasks);
router.get('/stats', protect, selfTaskController.getPersonalTaskStats);
router.put('/:taskId', protect, safeUploadFields, selfTaskController.updateTask);
router.patch('/:taskId/stop-recurring', protect, selfTaskController.stopRecurringTask);
router.delete('/:taskId', protect, selfTaskController.deleteTask);
router.patch('/:taskId/status', protect, selfTaskController.updateStatus);
router.patch('/:taskId/checkpoints/:checkpointId', protect, selfTaskController.updateCheckpoint);
router.post('/:taskId/remarks', protect, uploadRemarkImage, selfTaskController.addRemark);
router.get('/:taskId/remarks', protect, selfTaskController.getRemarks);

module.exports = router;
