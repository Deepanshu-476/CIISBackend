const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const ExcelJS = require('exceljs');
const { COLUMNS, readUpload, dateRange } = require('../utils/leadSpreadsheet');
const company = '507f1f77bcf86cd799439010', user = '507f1f77bcf86cd799439011';
function load(relative, overrides) {
  const filename = require.resolve(relative), localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => name in overrides ? overrides[name] : localRequire(name), Buffer, console, Date }, { filename });
  return module.exports;
}
async function serverFixture(t) {
  const rows = Array.from({ length: 65 }, (_, i) => ({ _id: String(i), company, name: `Person ${i}`, email: `person${i}@example.com`, phone: String(1000000000 + i), leadDate: '2026-09-16', leadSource: { name: 'Website' }, leadType: { name: 'Enquiry' }, remarks: i === 0 ? '=2+2' : '' }));
  const state = { rows, previews: [], queries: [], historyQueries: [] };
  const service = {
    masters: async tenant => { assert.equal(tenant, company); return { types: [{ name: 'Enquiry' }], sources: [{ name: 'Website' }] }; },
    team: async tenant => { assert.equal(tenant, company); return [{ _id: user, name: 'Test user' }]; },
    preview: async (req, records, fileName) => { assert.equal(req.crmCompany, company); state.previews.push(records); return { id: user, total: records.length, fileName }; },
    exportFilter: async req => { assert.equal(req.crmCompany, company); return { company: req.crmCompany, ...(dateRange(req.query) ? { leadDate: dateRange(req.query) } : {}) }; },
    getBatch: async req => ({ _id: req.params.id, status: 'partial', rows: [{ rowNumber: 2, body: { fullName: '=HYPERLINK("bad")' }, outcome: 'invalid', issues: ['Invalid email'] }] })
  };
  const lead = {
    exists: async filter => { state.queries.push(filter); return state.rows.length ? { _id: '1' } : null; },
    countDocuments: async filter => { state.queries.push(filter); return state.rows.length; },
    find: filter => {
      state.queries.push(filter);
      return { sort() { return this; }, populate(config) { assert.equal(config.match.company, company); return this; }, lean() { return this; },
        cursor() { return { async *[Symbol.asyncIterator]() { yield* state.rows; }, async close() {} }; } };
    }
  };
  const batch = {
    find: filter => {
      state.historyQueries.push(filter);
      return { select(value) { assert.equal(value, '-rows'); return this; }, populate(config) { assert.equal(config.match.company, company); return this; }, sort() { return this; }, skip() { return this; }, limit(value) { assert.equal(value, 20); return this; }, async lean() { return [{ _id: user, fileName: 'saved.xlsx', status: 'completed', total: 3, added: 3, skipped: 0, failed: 0, pending: 0, createdBy: { _id: user, name: 'Test user' } }]; } };
    },
    countDocuments: async filter => { state.historyQueries.push(filter); return 1; }
  };
  const transfer = load('../routes/leadTransferRoutes', { '../services/leadTransferService': service, '../models/Lead': lead, '../models/LeadImportBatch': batch,
    '../middleware/crmPagePermission': { requireCrmPagePermission: () => (req, res, next) => next() } });
  const noop = (req, res) => res.json({});
  const parent = load('../routes/crmLeadRoutes', {
    '../middleware/authMiddleware': { protect(req, res, next) {
      if (!req.headers.authorization) return res.status(401).json({ message: 'Not authenticated' });
      req.user = { _id: user, company }; next();
    } },
    '../models/Company': { findById: () => ({ select: () => ({ lean: async () => ({ allowedPages: state.denied ? ['admin-crm-add-lead'] : ['admin-crm-import-export-leads'] }) }) }) },
    '../middleware/crmPagePermission': { requireCrmPagePermission: () => (req, res, next) => next() },
    '../controllers/crmLeadController': { options: noop, create: noop, team: noop, assign: noop, list: noop },
    '../controllers/leadOverviewController': { overview: noop }, './leadTransferRoutes': transfer
  });
  const app = express(); app.use(express.json()); app.use('/api/crm/leads', parent);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/crm/leads/transfer`;
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { authorization: 'fixture', ...options.headers } });
  return { state, request, base };
}

test('all transfer endpoints require authentication and company page access', async t => {
  const { state, request, base } = await serverFixture(t);
  for (const [path, method] of [['/options', 'GET'], ['/template', 'GET'], ['/preview', 'POST'], [`/imports/${user}/confirm`, 'POST'], [`/imports/${user}`, 'GET'], [`/imports/${user}/errors`, 'GET'], ['/history', 'GET'], ['/export/count', 'GET'], ['/export', 'GET']]) {
    const response = await fetch(base + path, { method }); assert.equal(response.status, 401, path);
    state.denied = true; assert.equal((await request(path, { method })).status, 403, path); state.denied = false;
  }
  assert.equal(state.previews.length, 0);
});
test('HTTP template download can be filled and uploaded through real multipart parsing; bad files are rejected', async t => {
  const { request, state } = await serverFixture(t);
  const response = await request('/template'); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /lead-import-template.xlsx/);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  book.getWorksheet('Leads').addRow(['Test', 'test@example.com', '0123456789', '', '2026-09-16', '', 'Website', 'Enquiry', '', '', '', '', '', '']);
  const form = new FormData(); form.append('file', new Blob([await book.xlsx.writeBuffer()]), 'filled.xlsx');
  const imported = await request('/preview', { method: 'POST', body: form });
  assert.equal(imported.status, 201, await imported.clone().text()); assert.equal((await imported.json()).total, 1);
  assert.equal(state.previews[0][0].body.phone, '0123456789');
  const invalid = new FormData(); invalid.append('file', new Blob(['bad']), 'bad.exe');
  assert.equal((await request('/preview', { method: 'POST', body: invalid })).status, 400);
  const oversize = new FormData(); oversize.append('file', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]), 'large.csv');
  assert.equal((await request('/preview', { method: 'POST', body: oversize })).status, 400);
});
test('HTTP exports contain all 65 matches, safe cells and template-compatible columns in Excel and CSV', async t => {
  const { request, state } = await serverFixture(t);
  const count = await request('/export/count'); assert.equal((await count.json()).count, 65);
  const excel = await request('/export?format=xlsx'); assert.equal(excel.status, 200);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await excel.arrayBuffer()));
  assert.equal(book.getWorksheet('Leads').rowCount, 66);
  assert.deepEqual(book.getWorksheet('Leads').getRow(1).values.slice(1), COLUMNS.map(([name]) => name));
  assert.equal(book.getWorksheet('Leads').getCell('N2').value, "'=2+2");
  const csvResponse = await request('/export?format=csv'); assert.equal(csvResponse.status, 200);
  const records = await readUpload({ buffer: Buffer.from(await csvResponse.arrayBuffer()), originalname: 'export.csv' });
  assert.equal(records.length, 65); assert.equal(records[0].body.remarks, "'=2+2");
  assert.ok(state.queries.every(query => query.company === company));
  state.rows = []; assert.equal((await request('/export?format=csv')).status, 400);
});
test('history uses saved tenant records, pagination and safe downloadable error reports', async t => {
  const { request, state } = await serverFixture(t);
  const response = await request('/history?page=1'); const history = await response.json();
  assert.equal(response.status, 200); assert.equal(history.items[0].fileName, 'saved.xlsx');
  assert.equal(history.items[0].canResume, true); assert.ok(state.historyQueries.every(query => query.company === company && query.status.$ne === 'preview'));
  assert.equal((await request('/history?page=-1')).status, 400);
  const report = await request(`/imports/${user}/errors`); assert.equal(report.status, 200);
  assert.match(await report.text(), /'=HYPERLINK/);
});
