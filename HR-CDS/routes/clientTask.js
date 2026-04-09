const express = require('express');
const router = express.Router();
const taskController = require('../controllers/ClientTask');
const authMiddleware = require('../middlewares/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// ===== STATIC FILE SERVING - MOVED TO TOP (FIX) =====
// Serve uploaded images statically - MUST BE BEFORE ANY ROUTES
router.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads/client-remarks');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created upload directory:', uploadDir);
}

// Configure multer for image uploads
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

// Image compression middleware
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

// ===== TEST ENDPOINT =====
router.get('/test', (req, res) => {
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

// ===== ASSIGNED TASK ROUTES =====

// Logged-in user's assigned client tasks
router.get('/assigned-to-me', authMiddleware, taskController.getAssignedToMeTasks);

// NEW: Selected employee's assigned client tasks
router.get('/user/:userId/assigned-tasks', authMiddleware, taskController.getAssignedTasksByUserId);

router.patch('/assigned/:taskId/status', authMiddleware, taskController.updateAssignedTaskStatus);

// ===== CLIENT REMARK ROUTES =====
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

// ===== CLIENT ACTIVITY LOG ROUTES =====
router.post('/:taskId/client-activity-logs', authMiddleware, taskController.addClientActivityLog);
router.get('/:taskId/client-activity-logs', authMiddleware, taskController.getClientTaskActivityLogs);

// ===== DEBUG ROUTE =====
router.get('/:taskId/debug', authMiddleware, taskController.debugActivityLogs);

// ===== EXISTING ROUTES =====
router.get('/client/:clientId/service/:service', taskController.getTasksByClientService);
router.post('/client/:clientId/service/:service', authMiddleware, taskController.addTask);
router.get('/client/:clientId', taskController.getClientTasks);
router.get('/client/:clientId/stats', taskController.getTaskStats);
router.put('/:taskId', authMiddleware, taskController.updateTask);
router.patch('/:taskId/toggle', authMiddleware, taskController.toggleTaskCompletion);
router.delete('/:taskId', authMiddleware, taskController.deleteTask);

module.exports = router;