const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const User = require('../../models/User');
const { protect } = require('../../middleware/authMiddleware');

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

const sameCompany = (user, target) =>
  String(user.company?._id || user.company || '') === String(target.company?._id || target.company || '');

const documentJson = (document, userId) => ({
  _id: document._id,
  name: document.name,
  type: document.type,
  uploadedAt: document.uploadedAt,
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
  res.json({ documents: req.targetUser.documents.map(doc => documentJson(doc, req.targetUser._id)) });
});

router.post('/', upload.single('document'), async (req, res) => {
  if (String(req.user._id || req.user.id) !== String(req.targetUser._id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ message: 'Employees can only upload their own documents' });
  }
  if (!req.file) return res.status(400).json({ message: 'No document received. Please select the file again.' });

  const document = {
    _id: new mongoose.Types.ObjectId(),
    name: req.body.name?.trim() || req.file.originalname,
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

const sendDocument = disposition => (req, res) => {
  const document = req.targetUser.documents.id(req.params.documentId);
  if (!document) return res.status(404).json({ message: 'Document not found' });
  const filePath = path.join(uploadDir, path.basename(document.url || ''));
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Document file not found' });
  res.setHeader('Content-Type', document.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(document.name || 'document')}"`);
  res.sendFile(filePath);
};

router.get('/:documentId/view', sendDocument('inline'));
router.get('/:documentId/download', sendDocument('attachment'));

router.delete('/:documentId', async (req, res) => {
  if (String(req.user._id || req.user.id) !== String(req.targetUser._id)) {
    return res.status(403).json({ message: 'Employees can only delete their own documents' });
  }
  const document = req.targetUser.documents.id(req.params.documentId);
  if (!document) return res.status(404).json({ message: 'Document not found' });
  const filePath = path.join(uploadDir, path.basename(document.url || ''));
  await User.updateOne(
    { _id: req.targetUser._id },
    { $pull: { documents: { _id: document._id } } }
  );
  fs.unlink(filePath, () => {});
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
