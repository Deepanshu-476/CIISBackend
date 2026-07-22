
const express = require('express');
const router = express.Router();
const projectTaskController = require('../controllers/projectTaskController');
const { protect } = require('../../middleware/authMiddleware'); 
const { uploadRemarkImage } = require('../middlewares/uploadMiddleware');
const upload = require('../../utils/multer'); 

const uploadFields = upload.fields([
  { name: 'files', maxCount: 10 },
  { name: 'pdfFile', maxCount: 1 }
]);

router.get('/assigned-to-me', protect, projectTaskController.getAssignedProjectTasks);
router.post('/:id/tasks', protect, uploadFields, projectTaskController.addTask);
router.patch('/:id/tasks/:taskId', protect, uploadFields, projectTaskController.updateTask);
router.delete('/:id/tasks/:taskId', protect, projectTaskController.deleteTask);
router.patch('/:projectId/tasks/:taskId/status', protect, projectTaskController.updateTaskStatus);
router.patch('/:projectId/tasks/:taskId/checkpoints/:checkpointId', protect, projectTaskController.updateTaskCheckpoint);
router.get('/:projectId/tasks/:taskId/activity', protect, projectTaskController.getTaskActivityLogs);
router.get('/:projectId/tasks/:taskId/remarks', protect, projectTaskController.getTaskRemarks);
router.post('/:projectId/tasks/:taskId/remarks', protect, uploadRemarkImage, projectTaskController.addRemark);

module.exports = router;
