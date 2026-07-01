
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

router.post('/create', protect, uploadFields, selfTaskController.createTaskForSelf);
router.get('/', protect, selfTaskController.getPersonalTasks);
router.get('/stats', protect, selfTaskController.getPersonalTaskStats);
router.put('/:taskId', protect, uploadFields, selfTaskController.updateTask);
router.delete('/:taskId', protect, selfTaskController.deleteTask);
router.patch('/:taskId/status', protect, selfTaskController.updateStatus);
router.post('/:taskId/remarks', protect, uploadRemarkImage, selfTaskController.addRemark);
router.get('/:taskId/remarks', protect, selfTaskController.getRemarks);

module.exports = router;
