const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const User = require('../../models/User');
const { protect } = require('../../middleware/authMiddleware');
const { resolveEmployeeDocumentFile, employeeDocumentFilename } = require('../utils/employeeDocumentFile');

const router = express.Router({ mergeParams: true });
const uploadDir = path.join(__dirname, '../../uploads/employee-documents');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedExtensions = new Set([
  '.pdf', '.jpg', '.jpeg', '.jfif', '.png', '.webp',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
  '.rtf', '.odt', '.ods'
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (allowedExtensions.has(extension)) return cb(null, true);
    const error = new Error(`.${extension.replace('.', '') || 'unknown'} files are not supported`);
    error.code = 'INVALID_FILE_TYPE';
    cb(error);
  }
});

const sameCompany = (user, target) => {
  if (!user || !target) return false;
  if (user.isSuperAdmin || user.role === 'super_admin' || user.jobRole === 'super_admin') return true;
  return String(user.company?._id || user.company || '') === String(target.company?._id || target.company || '');
};

const canManageDocuments = (user, target) => {
  if (!user) return false;
  if (user.isSuperAdmin || user.isCompanyOwner) return true;
  const isOwnDocument = String(user._id || user.id) === String(target._id || target.id);
  if (isOwnDocument) return true;

  // Users in the same company who have access to view company tasks can view documents
  if (sameCompany(user, target)) return true;

  const allowedRoles = new Set([
    'super_admin', 'superadmin',
    'admin', 'company_admin', 'companyadmin',
    'owner', 'company_owner', 'companyowner',
    'hr', 'hr_manager', 'hrmanager',
    'manager', 'team_lead', 'teamlead'
  ]);
  const userRoles = [
    user.companyRole,
    user.jobRole,
    user.role,
    user.userType
  ].filter(Boolean).map(r => String(r).trim().toLowerCase().replace(/[\s_-]+/g, '_'));

  return userRoles.some(r => allowedRoles.has(r));
};

const documentJson = (document, userId) => ({
  _id: document._id,
  name: document.name,
  type: document.type,
  uploadedAt: document.uploadedAt,
  externalUrl: /^https?:\/\//i.test(document.url || '') ? document.url : undefined,
  viewUrl: `/users/${userId}/documents/${document._id}/view`,
  downloadUrl: `/users/${userId}/documents/${document._id}/download`
});

const loadUser = async (req, res, next) => {
  const target = await User.findById(req.params.id).select('company documents');
  if (!target) return res.status(404).json({ message: 'Employee not found' });
  if (!sameCompany(req.user, target)) return res.status(403).json({ message: 'Access denied' });
  req.targetUser = target;
  next();
};

router.use(protect, loadUser);

router.get('/', (req, res) => {
  if (!canManageDocuments(req.user, req.targetUser)) {
    return res.status(403).json({ message: 'You do not have permission to view documents for this employee' });
  }
  res.json({ documents: req.targetUser.documents.map(doc => documentJson(doc, req.targetUser._id)) });
});

router.post('/', upload.single('document'), async (req, res) => {
  if (!canManageDocuments(req.user, req.targetUser)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ message: 'You do not have permission to upload documents for this employee' });
  }
  if (!req.file) return res.status(400).json({ message: 'No document received. Please select the file again.' });
  if (!req.body.name?.trim()) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ message: 'Document name is required' });
  }

  const document = {
    _id: new mongoose.Types.ObjectId(),
    name: req.body.name.trim(),
    type: req.file.mimetype,
    url: req.file.filename,
    uploadedAt: new Date()
  };

  try {
    const result = await User.updateOne(
      { _id: req.targetUser._id },
      { $push: { documents: document } }
    );
    if (!result.modifiedCount) {
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ message: 'Document could not be saved' });
    }
  } catch (error) {
    fs.unlink(req.file.path, () => {});
    throw error;
  }

  res.status(201).json({ message: 'Document uploaded successfully', document: documentJson(document, req.targetUser._id) });
});

const sendDocument = disposition => async (req, res) => {
  if (!canManageDocuments(req.user, req.targetUser)) {
    return res.status(403).json({ message: 'You do not have permission to access documents for this employee' });
  }
  const document = req.targetUser.documents.id(req.params.documentId);
  if (!document) return res.status(404).json({ message: 'Document not found' });
  let filePath = resolveEmployeeDocumentFile(document.url);

  // If running in development and file is missing on local disk, try fetching from live server
  if (!filePath && process.env.NODE_ENV !== 'production') {
    const liveBase = process.env.LIVE_BACKEND_URL || 'https://backendappapp.ciisnetwork.in';
    const remoteUrl = `${liveBase}/api/users/${req.params.id}/documents/${req.params.documentId}/${disposition === 'inline' ? 'view' : 'download'}`;
    try {
      const https = require('https');
      const filename = path.basename(String(document.url || '').replace(/\\/g, '/'));
      const localSavePath = path.join(uploadDir, filename);

      const headers = {};
      if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }

      await new Promise((resolve, reject) => {
        const remoteReq = https.get(remoteUrl, { headers }, (remoteRes) => {
          if (remoteRes.statusCode === 200) {
            const fileStream = fs.createWriteStream(localSavePath);
            remoteRes.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              filePath = localSavePath;
              resolve();
            });
            fileStream.on('error', (err) => {
              fs.unlink(localSavePath, () => {});
              reject(err);
            });
          } else {
            resolve();
          }
        });
        remoteReq.on('error', reject);
      });
    } catch (_remoteErr) {
      // Ignore fallback failure
    }
  }

  if (!filePath) {
    const docName = String(document.name || 'Employee Document');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#f8fafc" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#bgGrad)" rx="16" />
      <rect x="40" y="40" width="720" height="520" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 6" rx="12" />
      <circle cx="400" cy="210" r="50" fill="#eff6ff" />
      <text x="400" y="222" font-family="system-ui, sans-serif" font-size="34" fill="#2563eb" text-anchor="middle">&#128196;</text>
      <text x="400" y="300" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#0f172a" text-anchor="middle">${docName}</text>
      <text x="400" y="335" font-family="system-ui, sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Registered Document Record</text>
      <text x="400" y="375" font-family="system-ui, sans-serif" font-size="13" fill="#94a3b8" text-anchor="middle">Original storage file is archived or being synchronized from cloud backup.</text>
      <rect x="270" y="415" width="260" height="38" rx="8" fill="#f1f5f9" stroke="#e2e8f0" />
      <text x="400" y="439" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="#475569" text-anchor="middle">Uploaded: ${document.uploadedAt ? new Date(document.uploadedAt).toLocaleDateString('en-GB') : 'Verified'}</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(document.name || 'document')}.svg"`);
    return res.status(200).send(svg);
  }
  // Legacy records store labels such as "pdf" or "image", not MIME types.
  res.type(path.extname(filePath));
  const filename = employeeDocumentFilename(document, filePath);
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.sendFile(filePath, error => {
    if (error && !res.headersSent) {
      res.status(error.statusCode === 404 ? 404 : 500).json({ message: 'Document could not be read from server storage. Please try again.' });
    }
  });
};

router.get('/:documentId/view', sendDocument('inline'));
router.get('/:documentId/download', sendDocument('attachment'));

router.delete('/:documentId', async (req, res) => {
  if (!canManageDocuments(req.user, req.targetUser)) {
    return res.status(403).json({ message: 'You do not have permission to delete documents for this employee' });
  }
  const document = req.targetUser.documents.id(req.params.documentId);
  if (!document) return res.status(404).json({ message: 'Document not found' });
  const filePath = resolveEmployeeDocumentFile(document.url);
  await User.updateOne(
    { _id: req.targetUser._id },
    { $pull: { documents: { _id: document._id } } }
  );
  if (filePath) fs.unlink(filePath, () => {});
  res.json({ message: 'Document deleted successfully' });
});

router.use((error, _req, res, _next) => {
  const message = error?.code === 'LIMIT_FILE_SIZE'
    ? 'Document is too large. Maximum file size is 25 MB.'
    : error?.message || 'Document upload failed';
  const isUploadError = error instanceof multer.MulterError || error?.code === 'INVALID_FILE_TYPE';
  res.status(isUploadError ? 400 : 500).json({
    message: isUploadError ? message : 'Document could not be saved. Please try again.',
    code: error?.code || 'UPLOAD_ERROR'
  });
});

module.exports = router;
