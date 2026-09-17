const express = require('express');
const router = express.Router();
const taskController = require('../controllers/ClientTask');
const authMiddleware = require('../middlewares/auth');
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
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, 
  fileFilter: fileFilter
});


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


router.get('/test', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  res.json({
    status: 'success',
    message: 'Client Task API is working',
    timestamp: new Date().toISOString(),
    staticFilesServed: true,
    uploadDirectory: uploadDir,
    endpoints: [
      'GET /api/tasks/test',
      'GET /api/tasks/assigned-to-me',
      'GET /api/tasks/user/:userId/assigned-tasks',
      'GET /api/tasks/client/:clientId/service/:service',
      'POST /api/tasks/client/:clientId/service/:service',
      'GET /api/tasks/client/:clientId',
      'GET /api/tasks/client/:clientId/stats',
      'PUT /api/tasks/:taskId',
      'PATCH /api/tasks/:taskId/toggle',
      'DELETE /api/tasks/:taskId',
      'POST /api/tasks/:taskId/client-remarks',
      'POST /api/tasks/:taskId/client-remarks/upload-images',
      'GET /api/tasks/:taskId/client-remarks',
      'DELETE /api/tasks/:taskId/client-remarks/:remarkId',
      'POST /api/tasks/:taskId/client-activity-logs',
      'GET /api/tasks/:taskId/client-activity-logs',
      'GET /api/tasks/:taskId/debug'
    ]
  });
});




router.get('/assigned-to-me', authMiddleware, taskController.getAssignedToMeTasks);
router.get('/assigned-to-me/stats', authMiddleware, taskController.getAssignedToMeTaskStats);


router.get('/user/:userId/assigned-tasks', authMiddleware, taskController.getAssignedTasksByUserId);

router.patch('/assigned/:taskId/status', authMiddleware, taskController.updateAssignedTaskStatus);


router.post('/:taskId/client-remarks', authMiddleware, taskController.addClientRemark);
router.post(
  '/:taskId/client-remarks/upload-images',
  authMiddleware,
  upload.array('images', 5),
  compressImage,
  taskController.addClientRemarkWithImages
);
router.get('/:taskId/client-remarks', authMiddleware, taskController.getClientRemarks);
router.delete('/:taskId/client-remarks/:remarkId', authMiddleware, taskController.deleteClientRemark);


router.post('/:taskId/client-activity-logs', authMiddleware, taskController.addClientActivityLog);
router.get('/:taskId/client-activity-logs', authMiddleware, taskController.getClientTaskActivityLogs);


router.get('/:taskId/debug', authMiddleware, taskController.debugActivityLogs);
router.get('/:taskId/debug', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
}, authMiddleware, taskController.debugActivityLogs);


router.get('/client/:clientId/service/:service', authMiddleware, taskController.getTasksByClientService);
router.post('/client/:clientId/service/:service', authMiddleware, taskController.addTask);
router.get('/summary/bulk', authMiddleware, taskController.getClientTaskSummaries);
router.get('/client/:clientId', authMiddleware, taskController.getClientTasks);
router.get('/client/:clientId/stats', authMiddleware, taskController.getTaskStats);
router.put('/:taskId', authMiddleware, taskController.updateTask);
router.patch('/:taskId/checkpoints/:checkpointId', authMiddleware, taskController.updateTaskCheckpoint);
router.patch('/:taskId/toggle', authMiddleware, taskController.toggleTaskCompletion);
router.delete('/:taskId', authMiddleware, taskController.deleteTask);

module.exports = router;
