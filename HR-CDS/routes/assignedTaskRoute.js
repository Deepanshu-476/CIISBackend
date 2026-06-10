// routes/assignedTaskRoute.js
const express = require('express');
const router = express.Router();
const assignedTaskController = require('../controllers/assignedTaskController');
const { protect } = require('../../middleware/authMiddleware'); 
const upload = require('../../utils/multer'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');

const uploadFields = upload.fields([
  { name: 'files', maxCount: 10 },
  { name: 'voiceNote', maxCount: 1 }
]);

router.post('/create', protect, uploadFields, assignedTaskController.createTaskForOthers);
router.get('/to-me', protect, assignedTaskController.getAssignedToMeTasks);
router.get('/by-me', protect, assignedTaskController.getAssignedTasks);
router.get('/to-me/stats', protect, assignedTaskController.getAssignedToMeTaskStats);
router.patch('/:taskId/status', protect, assignedTaskController.updateStatus);
router.post('/:taskId/remarks', protect, uploadRemarkImage, assignedTaskController.addRemark);
router.get('/:taskId/remarks', protect, assignedTaskController.getRemarks);

module.exports = router;
