const router = require('express').Router();
const mongoose = require('mongoose');
const Company = require('../models/Company');
const { protect } = require('../middleware/authMiddleware');
const controller = require('../controllers/telecallerController');
const { requireCrmPagePermission } = require('../middleware/crmPagePermission');

router.use(protect);
const pages = ['dashboard', 'call-dashboard', 'assigned-calls', 'todays-calls', 'pending-calls', 'scheduled-calls', 'completed-calls', 'call-history', 'follow-ups', 'converted-leads', 'call-workspace', 'lead-detail'];
const enabled = (keys, slug) => [`admin-telecaller-${slug}`, `ciisuser/telecaller/${slug}`, `telecaller/${slug}`].some(key => keys.has(key));

router.use(async (req, res, next) => {
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    if (!mongoose.isValidObjectId(company) || !mongoose.isValidObjectId(req.user?._id || req.user?.id)) {
      return res.status(403).json({ message: 'A valid company user is required.' });
    }
    const record = await Company.findById(company).select('allowedPages').lean();
    const keys = new Set((record?.allowedPages || []).map(value => String(value).replace(/^\/+/, '').toLowerCase()));
    if (!record || !pages.some(slug => enabled(keys, slug))) {
      return res.status(403).json({ message: 'Telecaller pages are not enabled for your company.' });
    }
    req.telecallerPages = keys;
    req.telecallerCompany = company;
    next();
  } catch (error) { next(error); }
});

const telecallerPaths = pages.map(slug => `/ciisUser/telecaller/${slug}`);
const callLogsHandler = typeof controller.callLogs === 'function'
  ? controller.callLogs
  : (req, res) => res.json({ items: [] });
router.get('/', requireCrmPagePermission(telecallerPaths), controller.list);
router.get('/call-logs', requireCrmPagePermission(telecallerPaths), callLogsHandler);
router.get('/:id', requireCrmPagePermission(telecallerPaths), controller.getOne);
router.post('/:id/calls', (req, res, next) => {
  if (!enabled(req.telecallerPages, 'call-workspace') && !(req.body?.outcome === 'Note Added' && enabled(req.telecallerPages, 'lead-detail'))) {
    return res.status(403).json({ message: 'This call update page is not enabled for your company.' });
  }
  next();
}, (req, res, next) => requireCrmPagePermission(
  req.body?.outcome === 'Note Added'
    ? ['/ciisUser/telecaller/lead-detail', '/ciisUser/telecaller/call-workspace']
    : '/ciisUser/telecaller/call-workspace',
  'edit'
)(req, res, next), controller.save);

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const recordingDir = typeof __dirname === 'string'
  ? path.join(__dirname, '../uploads/recordings')
  : path.join('uploads', 'recordings');
if (!fs.existsSync(recordingDir)) fs.mkdirSync(recordingDir, { recursive: true });

const recordingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recordingDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.m4a';
    cb(null, `rec_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const AUDIO_EXTENSIONS = new Set(['.m4a', '.mp3', '.aac', '.amr', '.wav', '.ogg', '.opus', '.3gp', '.3gpp', '.mp4', '.webm']);
const uploadAudio = multer({
  storage: recordingStorage,
  limits: { fileSize: 30 * 1024 * 1024 },
  // Phones report recordings with many types (audio/*, video/3gpp, octet-stream), so the extension decides.
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    const type = String(file.mimetype || '').toLowerCase();
    const ok = AUDIO_EXTENSIONS.has(ext) || (!ext && (type.startsWith('audio/') || type === 'video/3gpp'));
    cb(ok ? null : Object.assign(new Error('Only audio recordings can be uploaded.'), { status: 400 }), ok);
  },
});

// Same page rule as saving a call, and the lead must be one this user may log calls for, so a file is
// stored only for a real call.
const recordingLead = typeof controller.recordingLead === 'function'
  ? controller.recordingLead
  : (req, res, next) => next();
const receiveAudio = (req, res, next) => uploadAudio.single('audio')(req, res, error => {
  if (!error) return next();
  const tooLarge = error.code === 'LIMIT_FILE_SIZE';
  res.status(tooLarge ? 413 : error.status || 400).json({ message: tooLarge ? 'Recording is larger than 30 MB.' : error.message });
});

router.post('/:id/recording', (req, res, next) => {
  if (!enabled(req.telecallerPages, 'call-workspace')) {
    return res.status(403).json({ message: 'This call update page is not enabled for your company.' });
  }
  next();
}, requireCrmPagePermission('/ciisUser/telecaller/call-workspace', 'edit'), recordingLead, receiveAudio, (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No audio recording file uploaded.' });
  const fileUrl = `/uploads/recordings/${req.file.filename}`;
  res.json({ success: true, recordingUrl: fileUrl, filename: req.file.filename });
});

module.exports = router;
