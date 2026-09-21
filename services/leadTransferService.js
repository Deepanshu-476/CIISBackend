const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { validate } = require('../controllers/crmLeadController');
const { badRequest, normalizedEmail, normalizedPhone, dateRange } = require('../utils/leadSpreadsheet');
const { telecallerFilter, telecallerUserIds } = require('../utils/telecallerUsers');
const defaults = {
  Lead: require('../models/Lead'), Type: require('../models/LeadType'), Source: require('../models/LeadSource'),
  User: require('../models/User'), Client: require('../HR-CDS/models/Client'),
  Batch: require('../models/LeadImportBatch'), Lock: require('../models/LeadImportLock')
};
const finalStatuses = new Set(['completed', 'partial', 'failed']);
const userId = req => req.user._id || req.user.id;
const summary = rows => ({ total: rows.length,
  added: rows.filter(r => r.outcome === 'added').length,
  skipped: rows.filter(r => r.outcome === 'duplicate').length,
  failed: rows.filter(r => r.outcome === 'invalid' || r.outcome === 'failed').length,
  pending: rows.filter(r => !r.outcome || r.outcome === 'pending').length
});
const publicBatch = batch => ({ id: batch._id, fileName: batch.fileName, status: batch.status,
  createdAt: batch.createdAt, completedAt: batch.completedAt, ...summary(batch.rows),
  rows: batch.rows.map(r => ({ rowNumber: r.rowNumber, name: r.body.fullName, email: r.body.email, phone: r.body.phone, outcome: r.outcome, errors: r.issues || [] }))
});

function createService(models = defaults) {
  const { Lead, Type, Source, User, Client, Batch, Lock } = models;
  async function masters(company) {
    const filter = { company, status: 'Active' };
    const [types, sources] = await Promise.all([
      Type.find(filter).select('name').sort({ name: 1 }).lean(),
      Source.find(filter).select('name').sort({ name: 1 }).lean()
    ]);
    return { types, sources };
  }
  async function team(company) {
    const users = await User.find(telecallerFilter(company, await telecallerUserIds(company))).select('name email role companyRole jobRole').sort({ name: 1 }).lean();
    // Client.company stores a name, not the tenant ID. Restrict via tenant-owned users.
    const clients = await Client.find({ userId: { $in: users.map(user => user._id) } }).select('userId').lean();
    const clientIds = new Set(clients.map(client => String(client.userId)));
    return users.filter(user => !clientIds.has(String(user._id)));
  }
  async function evaluate(company, rows) {
    const { types, sources } = await masters(company);
    const lookup = (items, name) => items.filter(item => String(item.name).trim().toLowerCase() === String(name || '').trim().toLowerCase());
    const phones = new Set(), emails = new Set();
    const wantedPhones = new Set(rows.map(row => normalizedPhone(row.body.phone)));
    const wantedEmails = new Set(rows.map(row => normalizedEmail(row.body.email)));
    for await (const lead of Lead.find({ company }).select('phone email').lean().cursor()) {
      if (lead.phone && wantedPhones.has(normalizedPhone(lead.phone))) phones.add(normalizedPhone(lead.phone));
      if (lead.email && wantedEmails.has(normalizedEmail(lead.email))) emails.add(normalizedEmail(lead.email));
    }
    return rows.map(row => {
      const body = { ...row.body };
      const errors = [...(row.parseErrors || [])];
      for (const [key, items] of [['leadType', types], ['leadSource', sources]]) {
        const matches = lookup(items, body[key]);
        if (matches.length !== 1) errors.push(`${key === 'leadType' ? 'Lead Type' : 'Lead Source'}: ${matches.length ? 'ambiguous name' : 'unknown or inactive name'}. Choose an active name from your company.`);
        body[key] = matches.length === 1 ? String(matches[0]._id) : '';
      }
      const result = validate(body);
      errors.push(...Object.entries(result.errors).filter(([key]) => !['leadType', 'leadSource'].includes(key)).map(([key, message]) => `${key}: ${message}`));
      let outcome = 'valid';
      if (errors.length) outcome = 'invalid';
      else {
        const phone = normalizedPhone(result.data.phone), email = normalizedEmail(result.data.email);
        if (phones.has(phone) || emails.has(email)) {
          outcome = 'duplicate'; errors.push('Phone or email already exists in your company or an earlier valid row in this file.');
        }
        if (outcome === 'valid') {
          phones.add(phone); emails.add(email);
        }
      }
      return { rowNumber: row.rowNumber, body: row.body, data: result.data, source: sources.find(s => String(s._id) === body.leadSource)?.name, outcome, errors };
    });
  }
  async function preview(req, records, fileName) {
    // MongoDB documents are limited to 16 MB. Keep previews comfortably below it.
    if (Buffer.byteLength(JSON.stringify(records)) > 8 * 1024 * 1024) throw badRequest('Parsed file is too large; split it into smaller files.');
    const evaluated = await evaluate(req.crmCompany, records);
    const batch = await Batch.create({ company: req.crmCompany, createdBy: userId(req), fileName,
      total: records.length, pending: records.length, expiresAt: new Date(Date.now() + 86400000),
      rows: records.map(row => ({ ...row, leadId: new mongoose.Types.ObjectId(), outcome: 'pending' }))
    });
    return { id: batch._id, fileName, expiresAt: batch.expiresAt, total: records.length,
      valid: evaluated.filter(r => r.outcome === 'valid').length,
      duplicates: evaluated.filter(r => r.outcome === 'duplicate').length,
      invalid: evaluated.filter(r => r.outcome === 'invalid').length,
      rows: evaluated.map(({ data, source, ...row }) => row) };
  }
  async function getBatch(req) {
    if (!mongoose.isValidObjectId(req.params.id)) throw badRequest('Invalid import ID.');
    const batch = await Batch.findOne({ _id: req.params.id, company: req.crmCompany, createdBy: userId(req) });
    if (!batch) throw Object.assign(new Error('Import not found.'), { status: 404 });
    return batch;
  }
  async function confirm(req) {
    let batch = await getBatch(req);
    if (finalStatuses.has(batch.status)) return publicBatch(batch);
    if (batch.status === 'preview' && batch.expiresAt < new Date()) throw badRequest('Preview expired. Upload the file again.');
    const owner = crypto.randomUUID();
    const lockFilter = { _id: req.crmCompany, until: { $lt: new Date() } };
    try {
      await Lock.findOneAndUpdate(lockFilter, { $set: { owner, batch: batch._id, until: new Date(Date.now() + 300000) } }, { upsert: true, new: true });
    } catch (error) {
      if (error.code === 11000) throw Object.assign(new Error('An import is already processing for your company. Check its result before retrying. A stopped import can be resumed after five minutes.'), { status: 409 });
      throw error;
    }
    const scope = { _id: batch._id, company: req.crmCompany, createdBy: userId(req) };
    try {
      // Another request may have completed while this request was acquiring the lease.
      batch = await getBatch(req);
      if (finalStatuses.has(batch.status)) return publicBatch(batch);
      await Batch.updateOne(scope, { $set: { status: 'processing', processingOwner: owner, startedAt: batch.startedAt || new Date() } });
      scope.processingOwner = owner;
      batch.status = 'processing';
      const candidates = batch.rows.filter(row => row.outcome === 'pending');
      const evaluated = await evaluate(req.crmCompany, candidates);
      const byRow = new Map(evaluated.map(row => [row.rowNumber, row]));
      for (let index = 0; index < batch.rows.length; index++) {
        const row = batch.rows[index];
        if (row.outcome !== 'pending') continue;
        const lease = await Lock.updateOne({ _id: req.crmCompany, owner, until: { $gt: new Date() } }, { $set: { until: new Date(Date.now() + 300000) } });
        if (!lease.matchedCount) throw new Error('Import lease expired.');
        const evaluatedRow = byRow.get(row.rowNumber);
        // Stable lead IDs make a resumed import safe even if a previous write succeeded
        // but its response/history update was lost during a network interruption.
        const existing = await Lead.findOne({ _id: row.leadId, company: req.crmCompany }).select('_id').lean();
        if (existing) { row.outcome = 'added'; row.issues = []; }
        else if (evaluatedRow.outcome !== 'valid') { row.outcome = evaluatedRow.outcome; row.issues = evaluatedRow.errors; }
        else {
          try {
            await Lead.create({ ...evaluatedRow.data, _id: row.leadId, company: req.crmCompany,
              source: evaluatedRow.source, status: 'new', assignedTo: null, createdBy: userId(req) });
            row.outcome = 'added'; row.issues = [];
          } catch (error) {
            if (error.name === 'ValidationError') { row.outcome = 'failed'; row.issues = ['Lead could not be saved because its fields are invalid.']; }
            else throw error; // uncertain database writes must be reconciled on retry
          }
        }
        await Batch.updateOne(scope, { $set: { [`rows.${index}.outcome`]: row.outcome, [`rows.${index}.issues`]: row.issues, ...summary(batch.rows) } });
      }
      const counts = summary(batch.rows);
      batch.status = counts.failed ? (counts.added ? 'partial' : 'failed') : 'completed';
      batch.completedAt = new Date();
      await Batch.updateOne(scope, { $set: { ...counts, status: batch.status, completedAt: batch.completedAt } });
      return publicBatch(batch);
    } catch (error) {
      await Batch.updateOne(scope, { $set: { status: 'interrupted' } }).catch(() => {});
      throw Object.assign(new Error('Import interrupted. Some rows may already be saved. Refresh the result and resume this same import; do not upload it again.'), { status: 503 });
    } finally {
      await Lock.deleteOne({ _id: req.crmCompany, owner }).catch(() => {});
    }
  }
  async function exportFilter(req) {
    const query = req.query;
    const filter = { company: req.crmCompany };
    const assignment = query.assignment || 'all';
    if (!['all', 'assigned', 'unassigned'].includes(assignment)) throw badRequest('Invalid assignment filter.');
    if (assignment === 'assigned') filter.assignedTo = { $ne: null };
    if (assignment === 'unassigned') filter.assignedTo = null;
    if (query.userId) {
      if (assignment === 'unassigned') throw badRequest('A user cannot be combined with Unassigned.');
      if (!mongoose.isValidObjectId(query.userId)) throw badRequest('Invalid team member.');
      const user = await User.findOne({ _id: query.userId, company: req.crmCompany }).select('_id').lean();
      if (!user) throw badRequest('Team member is not available in your company.');
      filter.assignedTo = user._id;
    }
    const dates = dateRange(query);
    if (dates) filter.leadDate = dates;
    return filter;
  }
  return { masters, team, evaluate, preview, getBatch, confirm, exportFilter, publicBatch };
}
module.exports = { createService, summary, publicBatch, ...createService() };
