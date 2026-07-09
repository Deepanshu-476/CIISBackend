const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Client = require('../models/Client');
const ClientDocument = require('../models/ClientDocument');
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();
const uploadDir = path.join(__dirname, '../uploads/client-documents');
const CLIENT_DOCUMENT_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024;

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname || '').toLowerCase();
    cb(null, `client_doc_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/plain',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

const getUserCompanyCode = req => (
  req.user?.companyCode ||
  req.user?.company?.companyCode ||
  req.user?.companyDetails?.companyCode ||
  ''
).toString().trim().toUpperCase();

const getUserRole = req => String(req.user?.companyRole || req.user?.role || '').toLowerCase();

const getRequestUserId = req => String(req.user?._id || req.user?.id || '');

const canAccessClient = (req, client) => {
  const role = getUserRole(req);
  if (role === 'client') {
    return (
      client.userId?.toString() === req.user._id?.toString() ||
      client.userId?.toString() === req.user.id?.toString() ||
      String(client.email || '').toLowerCase() === String(req.user.email || '').toLowerCase()
    );
  }

  const userCompanyCode = getUserCompanyCode(req);
  return userCompanyCode && client.companyCode === userCompanyCode;
};

const getDocumentUploaderId = doc => String(doc.uploadedBy?._id || doc.uploadedBy || '');

const canDeleteDocument = (req, doc) => (
  Boolean(getRequestUserId(req)) && getDocumentUploaderId(doc) === getRequestUserId(req)
);

const canManageDocument = (req, doc, client) => (
  canDeleteDocument(req, doc) || Boolean(client && canAccessClient(req, client))
);

const removeDocumentFile = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch (fileError) {
    console.warn('Failed to remove client document file:', fileError.message);
  }
};

const getClientStorageUsed = async clientId => {
  const result = await ClientDocument.aggregate([
    { $match: { client: clientId } },
    { $group: { _id: null, total: { $sum: '$size' } } },
  ]);

  return Number(result[0]?.total || 0);
};

const getAccessibleDocument = async (req, documentId) => {
  const document = await ClientDocument.findById(documentId);
  if (!document) {
    return { status: 404, error: 'Document not found' };
  }

  const client = await Client.findById(document.client).lean();
  if (!client || !canAccessClient(req, client)) {
    return { status: 403, error: 'Access denied for this document' };
  }

  if (!canManageDocument(req, document, client)) {
    return { status: 403, error: 'You do not have permission to manage this document' };
  }

  return { document, client };
};

const formatDocument = (doc, req, client = null) => ({
  _id: doc._id,
  client: doc.client,
  name: doc.originalName,
  originalName: doc.originalName,
  type: doc.mimeType,
  category: doc.category,
  size: doc.size,
  uploadedBy: doc.uploadedByName,
  uploadedById: getDocumentUploaderId(doc),
  uploadedByRole: doc.uploadedByRole,
  canDelete: req ? canManageDocument(req, doc, client) : false,
  isDeleted: doc.isDeleted,
  deletedAt: doc.deletedAt,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  downloadUrl: `/api/client-documents/${doc._id}/download`,
});

router.get('/', protect, async (req, res) => {
  try {
    const { clientId, trash } = req.query;
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId is required' });
    }

    const client = await Client.findById(clientId).lean();
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    if (!canAccessClient(req, client)) {
      return res.status(403).json({ success: false, message: 'Access denied for this client' });
    }

    const documents = await ClientDocument.find({
      client: clientId,
      isDeleted: trash === 'true',
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: documents.map(document => formatDocument(document, req, client)),
      count: documents.length,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', protect, upload.single('document'), async (req, res) => {
  try {
    const { clientId, category = 'General' } = req.body;
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId is required' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Document file is required' });
    }

    const client = await Client.findById(clientId).lean();
    if (!client) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    if (!canAccessClient(req, client)) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ success: false, message: 'Access denied for this client' });
    }

    const usedStorage = await getClientStorageUsed(client._id);
    if (usedStorage + req.file.size > CLIENT_DOCUMENT_STORAGE_LIMIT) {
      fs.unlinkSync(req.file.path);
      return res.status(413).json({
        success: false,
        message: 'Storage limit exceeded. You can upload up to 5 GB of documents.',
        storage: {
          used: usedStorage,
          limit: CLIENT_DOCUMENT_STORAGE_LIMIT,
          requested: req.file.size,
        },
      });
    }

    const document = await ClientDocument.create({
      client: client._id,
      companyCode: client.companyCode,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      path: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      category,
      uploadedBy: req.user._id || req.user.id,
      uploadedByName: req.user.name || req.user.email || 'User',
      uploadedByRole: getUserRole(req) === 'client' ? 'client' : 'company',
    });

    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: formatDocument(document, req, client),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id/download', protect, async (req, res) => {
  try {
    const document = await ClientDocument.findById(req.params.id).lean();
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (document.isDeleted) {
      return res.status(410).json({ success: false, message: 'Document is in trash' });
    }

    const client = await Client.findById(document.client).lean();
    if (!client || !canAccessClient(req, client)) {
      return res.status(403).json({ success: false, message: 'Access denied for this document' });
    }

    if (!fs.existsSync(document.path)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    return res.download(document.path, document.originalName);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

const restoreDocument = async (req, res) => {
  try {
    const result = await getAccessibleDocument(req, req.params.id);
    if (result.error) {
      return res.status(result.status).json({ success: false, message: result.error });
    }

    const { document, client } = result;
    document.isDeleted = false;
    document.deletedAt = null;
    document.deletedBy = null;
    await document.save();

    return res.json({
      success: true,
      message: 'Document recovered successfully',
      data: formatDocument(document, req, client),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

router.patch('/:id/restore', protect, restoreDocument);
router.put('/:id/restore', protect, restoreDocument);
router.post('/:id/restore', protect, restoreDocument);

const permanentlyDeleteDocument = async (req, res) => {
  try {
    const result = await getAccessibleDocument(req, req.params.id);
    if (result.error) {
      return res.status(result.status).json({ success: false, message: result.error });
    }

    const { document } = result;
    const filePath = document.path;
    await document.deleteOne();
    removeDocumentFile(filePath);

    return res.json({ success: true, message: 'Document permanently deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

router.delete('/:id/permanent', protect, permanentlyDeleteDocument);
router.post('/:id/permanent-delete', protect, permanentlyDeleteDocument);

router.delete('/:id', protect, async (req, res) => {
  try {
    const permanentRequested = (
      String(req.query.permanent || '').toLowerCase() === 'true' ||
      String(req.body?.permanent || '').toLowerCase() === 'true' ||
      String(req.headers['x-permanent-delete'] || '').toLowerCase() === 'true'
    );

    if (permanentRequested) {
      return permanentlyDeleteDocument(req, res);
    }

    const result = await getAccessibleDocument(req, req.params.id);
    if (result.error) {
      return res.status(result.status).json({ success: false, message: result.error });
    }

    const { document, client } = result;
    document.isDeleted = true;
    document.deletedAt = new Date();
    document.deletedBy = req.user._id || req.user.id;
    await document.save();

    return res.json({ success: true, message: 'Document moved to trash', data: formatDocument(document, req, client) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
