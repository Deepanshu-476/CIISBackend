const router = require('express').Router();
const mongoose = require('mongoose');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const ExcelJS = require('exceljs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const service = require('../services/leadTransferService');
const Batch = require('../models/LeadImportBatch');
const Lead = require('../models/Lead');
const { COLUMNS, MAX_BYTES, readUpload, templateBuffer, safeText, csvLine, leadValues, badRequest } = require('../utils/leadSpreadsheet');
const wrap = handler => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
const download = (res, filename, type) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
};
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// protect + company page context are applied by the parent CRM router.
router.use((req, res, next) => {
  if (!mongoose.isValidObjectId(req.crmCompany) || !mongoose.isValidObjectId(req.user?._id || req.user?.id)) return res.status(403).json({ message: 'A valid company user is required.' });
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const previewLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => `${req.crmCompany}:${req.user._id || req.user.id}`,
  message: { message: 'Too many previews. Please wait before uploading again.' } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 2 } }).single('file');

router.get('/options', wrap(async (req, res) => {
  const [masters, users] = await Promise.all([service.masters(req.crmCompany), service.team(req.crmCompany)]);
  res.json({ ...masters, users });
}));
router.get('/template', wrap(async (req, res) => {
  const { types, sources } = await service.masters(req.crmCompany);
  const buffer = await templateBuffer(types, sources);
  download(res, 'lead-import-template.xlsx', xlsxType);
  res.send(Buffer.from(buffer));
}));
router.post('/preview', previewLimit, (req, res, next) => upload(req, res, error => {
  if (error) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Maximum file size is 5 MB.' : 'Upload exactly one file (maximum 5 MB).' });
  next();
}), wrap(async (req, res) => {
  const records = await readUpload(req.file);
  const fileName = String(req.file.originalname).split(/[\\/]/).pop().slice(0, 200);
  res.status(201).json(await service.preview(req, records, fileName));
}));
router.post('/imports/:id/confirm', wrap(async (req, res) => res.json(await service.confirm(req))));
router.get('/imports/:id', wrap(async (req, res) => res.json(service.publicBatch(await service.getBatch(req)))));
router.get('/imports/:id/errors', wrap(async (req, res) => {
  const batch = await service.getBatch(req);
  const rows = batch.status === 'preview' ? await service.evaluate(req.crmCompany, batch.rows) : batch.rows.map(row => ({ body: row.body, rowNumber: row.rowNumber, outcome: row.outcome, errors: row.issues }));
  const text = '\ufeff' + csvLine(['Row', 'Full Name', 'Outcome', 'Errors']) + rows.filter(row => row.errors?.length).map(row => csvLine([row.rowNumber, row.body.fullName, row.outcome, row.errors.join('; ')])).join('');
  download(res, `lead-import-${batch._id}-errors.csv`, 'text/csv; charset=utf-8');
  res.send(text);
}));
router.get('/history', wrap(async (req, res) => {
  const page = Number(req.query.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw badRequest('Invalid history page.');
  const filter = { company: req.crmCompany, status: { $ne: 'preview' } };
  const [items, total] = await Promise.all([
    Batch.find(filter).select('-rows').populate({ path: 'createdBy', select: 'name', match: { company: req.crmCompany } }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
    Batch.countDocuments(filter)
  ]);
  res.json({ items: items.map(item => ({ ...item, canResume: String(item.createdBy?._id) === String(req.user._id || req.user.id) })), total, page, pages: Math.max(1, Math.ceil(total / 20)) });
}));
router.get('/export/count', wrap(async (req, res) => {
  const filter = await service.exportFilter(req);
  res.json({ count: await Lead.countDocuments(filter) });
}));
router.get('/export', wrap(async (req, res) => {
  const format = req.query.format || 'xlsx';
  if (!['xlsx', 'csv'].includes(format)) throw badRequest('Choose Excel or CSV.');
  const filter = await service.exportFilter(req);
  if (!(await Lead.exists(filter))) throw badRequest('No leads match these filters.');
  const cursor = Lead.find(filter).sort({ _id: 1 })
    .populate({ path: 'leadType', select: 'name', match: { company: req.crmCompany } })
    .populate({ path: 'leadSource', select: 'name', match: { company: req.crmCompany } }).lean().cursor();
  const name = `leads-${new Date().toISOString().slice(0, 10)}.${format}`;
  try {
    if (format === 'csv') {
      download(res, name, 'text/csv; charset=utf-8');
      async function* lines() {
        yield '\ufeff' + csvLine(COLUMNS.map(([header]) => header));
        for await (const lead of cursor) yield csvLine(leadValues(lead));
      }
      await pipeline(Readable.from(lines()), res);
    } else {
      download(res, name, xlsxType);
      const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
      const sheet = book.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = COLUMNS.map(([header]) => ({ header, width: 24, style: { numFmt: '@' } }));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).commit();
      for await (const lead of cursor) {
        if (res.destroyed) break;
        sheet.addRow(leadValues(lead).map(safeText)).commit();
      }
      sheet.commit();
      await book.commit();
    }
  } finally { await cursor.close(); }
}));
router.use((error, req, res, next) => {
  if (res.headersSent) { res.destroy(error); return; }
  const status = error.status || 500;
  if (status === 500) console.error('Lead transfer failed:', error.message);
  res.status(status).json({ message: status === 500 ? 'Lead transfer could not be completed. Please retry.' : error.message });
});
module.exports = router;
    