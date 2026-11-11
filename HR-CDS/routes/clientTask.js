const taskStatusRequest = require('../../middleware/taskStatusRequest');
const express = require('express');
const router = express.Router();
const taskController = require('../controllers/ClientTask');
const authMiddleware = require('../middlewares/auth');
// A client login may only open its own client's tasks (runs after authMiddleware).
const ownClientOnly = require('../../middleware/pageAccess').requireOwnClient(req => req.params.clientId);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');


const SENSITIVE_UPLOAD_FOLDERS = [
  'employee-documents',
  'client-documents',
  'receipts'
];

router.use('/uploads', (req, res, next) => {
  try {
    const normalizedPath = decodeURIComponent(req.path || '').toLowerCase().replace(/\\/g, '/');
    const isSensitive = SENSITIVE_UPLOAD_FOLDERS.some(folder =>
      normalizedPath.startsWith(`/${folder}`) ||
      normalizedPath.includes(`/${folder}/`) ||
      normalizedPath === `/${folder}`
    );

    if (isSensitive) {
      return res.status(403).json({
        success: false,
        message: 'Direct static access to sensitive documents is forbidden. Please use authorized API endpoints.'
      });
    }
  } catch (_err) {
    return res.status(400).json({ success: false, message: 'Invalid request path' });
  }
  next();
}, express.static(path.join(__dirname, '../uploads')));


const uploadDir = path.join(__dirname, '../uploads/client-remarks');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  void 0;
}


const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
  if (mime.startsWith('image/') || allowedExts.includes(ext)) {
    return cb(null, true);
  }
  return cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp, heic)'));
};

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, 
  fileFilter: fileFilter
});

const safeClientRemarkUpload = (req, res, next) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      console.error('Client remark upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Image size exceeds 25MB limit.' });
      }
      return res.status(400).json({ success: false, message: err.message || 'Image upload failed' });
    }
    next();
  });
};


const compressImage = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next();
  }

  try {
    const compressedFiles = [];
    
    for (const file of req.files) {
      const filename = `remark_${Date.now()}_${Math.round(Math.random() * 1E9)}.jpg`;
      const savePath = path.join(uploadDir, filename);
      
      await sharp(file.buffer)
        .resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: 80,
          progressive: true
        })
        .toFile(savePath);
      
      compressedFiles.push({
        ...file,
        filename: filename,
        path: savePath,
        size: fs.statSync(savePath).size
      });
    }
    
    req.files = compressedFiles;
    next();
  } catch (error) {
    console.error('❌ Image compression error:', error);
    next(error);
  }
};


router.get('/assigned-to-me', authMiddleware, taskController.getAssignedToMeTasks);
router.get('/assigned-to-me/stats', authMiddleware, taskController.getAssignedToMeTaskStats);


router.get('/user/:userId/assigned-tasks', authMiddleware, taskController.getAssignedTasksByUserId);

router.patch('/assigned/:taskId/status', authMiddleware, safeClientRemarkUpload, taskStatusRequest, taskController.updateAssignedTaskStatus);


router.post('/:taskId/client-remarks', authMiddleware, taskController.addClientRemark);
router.post(
  '/:taskId/client-remarks/upload-images',
  authMiddleware,
  safeClientRemarkUpload,
  compressImage,
  taskController.addClientRemarkWithImages
);
router.get('/:taskId/client-remarks', authMiddleware, taskController.getClientRemarks);
router.delete('/:taskId/client-remarks/:remarkId', authMiddleware, taskController.deleteClientRemark);


router.post('/:taskId/client-activity-logs', authMiddleware, taskController.addClientActivityLog);
router.get('/:taskId/client-activity-logs', authMiddleware, taskController.getClientTaskActivityLogs);


router.get('/', authMiddleware, (req, res, next) => {
  if (req.query.clientId && req.query.service) {
    req.params.clientId = req.query.clientId;
    req.params.service = req.query.service;
    return ownClientOnly(req, res, () => taskController.getTasksByClientService(req, res, next));
  }
  if (req.query.clientId) {
    req.params.clientId = req.query.clientId;
    return ownClientOnly(req, res, () => taskController.getClientTasks(req, res, next));
  }
  return res.status(400).json({ success: false, message: 'clientId parameter is required' });
});

router.get('/client/:clientId/service/:service', authMiddleware, ownClientOnly, taskController.getTasksByClientService);
router.post('/client/:clientId/service/:service', authMiddleware, ownClientOnly, taskController.addTask);
router.get('/summary/bulk', authMiddleware, taskController.getClientTaskSummaries);
router.get('/client/:clientId', authMiddleware, ownClientOnly, taskController.getClientTasks);
router.get('/client/:clientId/stats', authMiddleware, ownClientOnly, taskController.getTaskStats);
router.put('/:taskId', authMiddleware, taskController.updateTask);
router.patch('/:taskId', authMiddleware, taskController.updateTask);
router.patch('/:taskId/reminder', authMiddleware, taskController.updateTask);
router.put('/:taskId/reminder', authMiddleware, taskController.updateTask);
router.patch('/:taskId/checkpoints/:checkpointId', authMiddleware, taskController.updateTaskCheckpoint);
router.patch('/:taskId/toggle', authMiddleware, taskController.toggleTaskCompletion);
router.delete('/:taskId', authMiddleware, taskController.deleteTask);

module.exports = router;
