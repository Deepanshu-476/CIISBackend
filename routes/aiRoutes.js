const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const aiTaskBudget = require('../middleware/aiTaskBudget');
const aiTimeGate = require('../middleware/aiTimeGate');
const aiController = require('../controllers/aiController');
const insights = require('../controllers/aiInsightsController');

const aiParseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.user?._id || req.user?.id || 'anon'),
  validate: { keyGeneratorIpFallback: false },
  message: {
    success: false,
    message: 'Too many requests. Please try again later.'
  }
});

const aiSttLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user?._id || req.user?.id || 'anon'),
  validate: { keyGeneratorIpFallback: false },
  message: {
    success: false,
    message: 'Too many transcription requests. Please try again in a minute.'
  }
});

const aiInsightsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user?._id || req.user?.id || 'anon'),
  validate: { keyGeneratorIpFallback: false },
  message: {
    success: false,
    message: 'Too many insight requests. Please try again in a minute.'
  }
});

const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'video/webm',
  'audio/ogg',
  'video/ogg',
  'application/ogg',
  'audio/mp4',
  'video/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/m4a',
  'audio/x-m4a',
]);

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    // Strip parameters such as ;codecs=opus
    const rawMime = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.webm', '.ogg', '.mp4', '.wav', '.mp3', '.mpeg', '.m4a'];

    if (ALLOWED_MIME_TYPES.has(rawMime) || allowedExts.includes(ext)) {
      return cb(null, true);
    }

    const err = new Error('Invalid audio format. Allowed: webm, ogg, mp4, wav, mpeg, m4a');
    err.code = 'INVALID_AUDIO_FORMAT';
    return cb(err, false);
  },
}).single('audio');

const handleAudioUpload = (req, res, next) => {
  audioUpload(req, res, (err) => {
    if (err) {
      if ((err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') || err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          code: 'STT_FILE_TOO_LARGE',
          error: 'Audio file too large. Maximum size is 5 MB.',
          message: 'Audio file too large. Maximum size is 5 MB.',
        });
      }
      return res.status(400).json({
        success: false,
        code: 'STT_INVALID_FORMAT',
        error: err.message || 'Mic ki awaaz format support nahi hua.',
        message: err.message || 'Mic ki awaaz format support nahi hua.',
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'STT_NO_FILE',
        error: "Audio file is required in 'audio' field.",
        message: "Audio file is required in 'audio' field.",
      });
    }
    next();
  });
};

// ---- Voice Task Agent (time-gate yahan NAHI lagta: employee din mein bhi task bana sake) ----
router.post('/task-agent/parse', protect, aiParseLimiter, aiTaskBudget, aiController.parseTask);
router.post('/transcribe', protect, aiSttLimiter, aiTaskBudget.aiSttBudget, handleAudioUpload, aiController.transcribe);

// ---- Insights ----
// Employee wrap-up summary: employees ke liye 5-7 PM IST window, Owner/Admin 24/7 (aiTimeGate khud skip karta hai)
router.get('/daily-summary', protect, aiInsightsLimiter, aiTimeGate, insights.getDailySummary);
// CEO / Executive radar: sirf Owner/Admin (employee ko 403)
router.get('/executive-insights', protect, restrictTo('Owner', 'Admin'), aiInsightsLimiter, insights.getExecutiveInsights);

module.exports = router;
router.handleAudioUpload = handleAudioUpload;
router.aiSttLimiter = aiSttLimiter;
router.aiInsightsLimiter = aiInsightsLimiter;