const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { COLUMNS, readUpload, templateBuffer, dateRange, csvLine, safeText, leadValues, MAX_BYTES } = require('../utils/leadSpreadsheet');
const { createService } = require('../services/leadTransferService');
const company = '507f1f77bcf86cd799439010', foreign = '507f1f77bcf86cd799439020';
const user = '507f1f77bcf86cd799439011', type = '507f1f77bcf86cd799439012', source = '507f1f77bcf86cd799439013';
const body = { fullName: ' Test Person ', email: 'TEST@example.com', phone: '0123456789', gender: '', leadDate: '2026-09-16', address: '', leadSource: 'Website', leadType: 'Enquiry', customField1: '', customField2: '', customField3: '', customField4: '', customField5: '', remarks: '' };
const record = (changes = {}, rowNumber = 2) => ({ rowNumber, body: { ...body, ...changes }, parseErrors: [] });
const file = (buffer, originalname = 'leads.xlsx') => ({ buffer: Buffer.from(buffer), originalname });
const csv = rows => Buffer.from(rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'));

test('downloaded template is empty, instructions contain active names, text phone format survives and filled template imports', async () => {
  const buffer = await templateBuffer([{ name: 'Enquiry' }], [{ name: 'Website' }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
  const sheet = book.getWorksheet('Leads');
  assert.deepEqual(sheet.getRow(1).values.slice(1), COLUMNS.map(([name]) => name));
  assert.equal(sheet.rowCount, 1);
  assert.equal(sheet.getColumn(3).numFmt, '@');
  assert.match(book.getWorksheet('Instructions').getCell('B14').text, /Website/);
  await assert.rejects(() => readUpload(file(buffer)), /No lead rows/);
  sheet.addRow(COLUMNS.map(([, key]) => body[key]));
  sheet.getCell('E2').value = new Date('2026-09-16T00:00:00Z');
  sheet.getCell('E2').numFmt = 'yyyy-mm-dd';
  const records = await readUpload(file(await book.xlsx.writeBuffer()));
  assert.equal(records.length, 1); assert.equal(records[0].body.phone, '0123456789');
  assert.equal(records[0].body.leadDate, '2026-09-16');
});
test('CSV maps reordered headers, handles BOM, quoted newlines, blank rows, and keeps phone text', async () => {
  const order = [...COLUMNS].reverse();
  const records = await readUpload(file(Buffer.concat([Buffer.from('\ufeff'), csv([order.map(([name]) => name), [], order.map(([, key]) => key === 'remarks' ? 'Line one\nLine two' : body[key])])]), 'leads.csv'));
  assert.equal(records.length, 1); assert.equal(records[0].rowNumber, 3);
  assert.equal(records[0].body.phone, '0123456789'); assert.equal(records[0].body.remarks, 'Line one\nLine two');
});
test('rejects missing/duplicate/unsupported headers, invalid format, malformed CSV, oversize and excess rows', async () => {
  const headers = COLUMNS.map(([name]) => name);
  await assert.rejects(() => readUpload(file(csv([headers.slice(1)]), 'a.csv')), /Missing headers: Full Name/);
  await assert.rejects(() => readUpload(file(csv([[...headers, 'Email']]), 'a.csv')), /Duplicate headers: Email/);
  await assert.rejects(() => readUpload(file(csv([[...headers, 'Company']]), 'a.csv')), /Unsupported headers: Company/);
  await assert.rejects(() => readUpload(file('bad zip')), /Invalid/);
  await assert.rejects(() => readUpload(file('bad', 'a.exe')), /Supported file/);
  await assert.rejects(() => readUpload(file('"unfinished', 'a.csv')), /Invalid CSV/);
  await assert.rejects(() => readUpload(file(Buffer.alloc(MAX_BYTES + 1))), /5 MB/);
  await assert.rejects(() => readUpload(file(csv([headers, ...Array.from({ length: 1001 }, () => COLUMNS.map(([, key]) => body[key]))]), 'a.csv')), /Maximum 1000/);
});
test('Excel numeric dates and padded phone cells work; formula cells become row errors, never cached values', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Leads');
  sheet.addRow(COLUMNS.map(([name]) => name)); sheet.addRow(COLUMNS.map(([, key]) => body[key]));
  sheet.getCell('C2').value = 123456789; sheet.getCell('C2').numFmt = '0000000000';
  sheet.getCell('E2').value = 46281;
  sheet.getCell('N2').value = { formula: '1+1', result: 2 };
  const [row] = await readUpload(file(await book.xlsx.writeBuffer()));
  assert.equal(row.body.phone, '0123456789'); assert.match(row.body.leadDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(row.parseErrors.join(), /Formula cells/); assert.equal(row.body.remarks, '');
});
test('date filters are inclusive with Monday-Sunday weeks and leap-year month ends', () => {
  assert.equal(dateRange({}), null);
  assert.deepEqual(dateRange({ dateMode: 'date', date: '2026-09-16' }), { $gte: '2026-09-16', $lte: '2026-09-16' });
  assert.deepEqual(dateRange({ dateMode: 'week', date: '2026-09-20' }), { $gte: '2026-09-14', $lte: '2026-09-20' });
  assert.deepEqual(dateRange({ dateMode: 'month', month: '2024-02' }), { $gte: '2024-02-01', $lte: '2024-02-29' });
  assert.deepEqual(dateRange({ dateMode: 'range', from: '2026-01-01', to: '2026-02-01' }), { $gte: '2026-01-01', $lte: '2026-02-01' });
  for (const query of [{ dateMode: 'bad' }, { dateMode: 'date', date: '2026-02-30' }, { dateMode: 'range', from: '2026-10-01', to: '2026-09-01' }, { dateMode: 'month', month: '2026-13' }]) assert.throws(() => dateRange(query));
});
test('export and error report values neutralize spreadsheet formulas, preserving column order', () => {
  for (const value of ['=SUM(A1)', '+cmd', '-cmd', '@cmd', '\t=cmd', '  =cmd']) assert.ok(safeText(value).startsWith("'"));
  assert.equal(safeText('0123456789'), '0123456789');
  assert.equal(csvLine(['=2+2', 'a"b']), '"\'=2+2","a""b"\r\n');
  const values = leadValues({ ...body, name: 'Test', leadType: { name: 'Enquiry' }, leadSource: { name: 'Website' } });
  assert.equal(values.length, 14); assert.equal(values[0], 'Test'); assert.equal(values[6], 'Website');
});

// In-memory adapters: no MongoDB connection or customer records are used.
const clone = value => value instanceof Date ? new Date(value) : value instanceof mongoose.Types.ObjectId ? String(value) : Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
function matches(item, filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = item[key];
    if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId) && !(value instanceof Date)) {
      if ('$lt' in value) return actual < value.$lt;
      if ('$gt' in value) return actual > value.$gt;
      if ('$in' in value) return value.$in.some(v => String(v) === String(actual));
      if ('$ne' in value) return actual != value.$ne;
      if ('$not' in value) return !value.$not.test(String(actual || ''));
    }
    return String(actual) === String(value);
  });
}
function query(value) {
  return { select() { return this; }, sort() { return this; }, lean() { return this; },
    then(resolve, reject) { return Promise.resolve(clone(value)).then(resolve, reject); },
    async *cursor() { for (const row of value) yield clone(row); } };
}
function fixture({ leads = [], failCreate, types } = {}) {
  const state = { leads: clone(leads), batches: [], locks: [], types: types || [{ _id: type, company, name: 'Enquiry', status: 'Active' }], sources: [{ _id: source, company, name: 'Website', status: 'Active' }], users: [{ _id: user, company, name: 'User' }] };
  function update(collection, filter, mutation) {
    const item = collection.find(row => matches(row, filter));
    if (!item) return { matchedCount: 0 };
    for (const [path, value] of Object.entries(mutation.$set || {})) {
      const parts = path.split('.'); let target = item;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = clone(value);
    }
    return { matchedCount: 1 };
  }
  const models = {
    Lead: {
      find: filter => query(state.leads.filter(row => matches(row, filter))),
      findOne: filter => query(state.leads.find(row => matches(row, filter)) || null),
      create: async data => { if (failCreate) await failCreate(data, state); state.leads.push(clone(data)); return data; }
    },
    Type: { find: filter => query(state.types.filter(row => matches(row, filter))) },
    Source: { find: filter => query(state.sources.filter(row => matches(row, filter))) },
    User: { findOne: filter => query(state.users.find(row => matches(row, filter)) || null), find: filter => query(state.users.filter(row => matches(row, filter))) },
    Client: { find: () => query([]) },
    Batch: {
      create: async data => { const item = clone({ ...data, _id: new mongoose.Types.ObjectId(), status: 'preview', rows: data.rows.map(row => ({ ...row, errors: [] })) }); state.batches.push(item); return clone(item); },
      findOne: filter => query(state.batches.find(row => matches(row, filter)) || null),
      updateOne: async (filter, mutation) => update(state.batches, filter, mutation)
    },
    Lock: {
      findOneAndUpdate: async (filter, mutation) => {
        const existing = state.locks.find(row => String(row._id) === String(filter._id));
        if (existing && !matches(existing, filter)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        if (existing) Object.assign(existing, clone(mutation.$set)); else state.locks.push({ _id: String(filter._id), ...clone(mutation.$set) });
      },
      updateOne: async (filter, mutation) => update(state.locks, filter, mutation),
      deleteOne: async filter => { state.locks = state.locks.filter(row => !matches(row, filter)); }
    }
  };
  const req = { crmCompany: company, user: { _id: user }, params: {}, query: {} };
  return { service: createService(models), state, models, req };
}
test('preview uses Add Lead validation, tenant masters, normalized duplicates and rejects ambiguous names', async () => {
  const { service } = fixture({ leads: [ { company, phone: '+91 98765 43210', email: 'EXISTS@EXAMPLE.COM' }, { company: foreign, phone: body.phone, email: body.email } ] });
  const rows = await service.evaluate(company, [record(), record({}, 3), record({ phone: '9876543210', email: 'other@example.com' }, 4), record({ leadType: 'Foreign', phone: '1111111111' }, 5), record({ phone: '123', email: 'bad' }, 6)]);
  assert.deepEqual(rows.map(row => row.outcome), ['valid', 'duplicate', 'duplicate', 'invalid', 'invalid']);
  assert.equal(rows[0].data.name, 'Test Person'); assert.equal(rows[0].data.email, 'test@example.com');
  const ambiguous = fixture({ types: [{ _id: type, company, name: 'Enquiry', status: 'Active' }, { _id: source, company, name: 'ENQUIRY', status: 'Active' }] });
  assert.match((await ambiguous.service.evaluate(company, [record()]))[0].errors.join(), /ambiguous/);
});
test('confirm imports valid rows only, saves partial history, uses server ownership, and is idempotent', async () => {
  const { service, state, req } = fixture();
  const preview = await service.preview(req, [record({ company: foreign, status: 'converted', assignedTo: user }), record({}, 3), record({ phone: 'x' }, 4)], 'fixture.csv');
  assert.equal(preview.valid, 1); assert.equal(preview.duplicates, 1); assert.equal(preview.invalid, 1);
  req.params.id = preview.id;
  const result = await service.confirm(req);
  assert.equal(result.status, 'partial'); assert.equal(result.added, 1); assert.equal(result.skipped, 1); assert.equal(result.failed, 1);
  assert.equal(state.leads[0].company, company); assert.equal(state.leads[0].createdBy, user);
  assert.equal(state.leads[0].status, 'new'); assert.equal(state.leads[0].assignedTo, null);
  assert.deepEqual(await service.confirm(req), result); assert.equal(state.leads.length, 1);
  assert.equal(state.batches[0].status, 'partial'); assert.equal(state.batches[0].pending, 0);
});

test('skipped duplicate rows do not reserve unused contact details for later valid leads', async () => {
  for (const shared of ['phone', 'email']) {
    const existing = { company, phone: '9999999999', email: 'existing@example.com' };
    const f = fixture({ leads: [existing] });
    const skipped = record({ [shared]: existing[shared] });
    const valid = record({}, 3);
    const preview = await f.service.preview(f.req, [skipped, valid], 'duplicates.csv');
    assert.equal(preview.duplicates, 1, shared);
    assert.equal(preview.valid, 1, shared);
    f.req.params.id = preview.id;
    const result = await f.service.confirm(f.req);
    assert.equal(result.added, 1, shared);
    assert.equal(result.skipped, 1, shared);
    assert.equal(f.state.leads.length, 2, shared);
  }
});
test('confirm rechecks duplicates and active sources after preview', async () => {
  const f = fixture(); const p = await f.service.preview(f.req, [record()], 'fixture.csv'); f.req.params.id = p.id;
  f.state.leads.push({ company, phone: body.phone, email: 'different@example.com' });
  assert.equal((await f.service.confirm(f.req)).skipped, 1);
  const g = fixture(); const p2 = await g.service.preview(g.req, [record()], 'fixture.csv'); g.req.params.id = p2.id;
  g.state.sources[0].status = 'Inactive'; assert.equal((await g.service.confirm(g.req)).failed, 1); assert.equal(g.state.leads.length, 0);
});
test('interrupted writes reconcile stable lead IDs on retry without double creation', async () => {
  let fail = true;
  const f = fixture({ failCreate: async (data, state) => { if (fail) { fail = false; state.leads.push(clone(data)); throw new Error('response lost'); } } });
  const p = await f.service.preview(f.req, [record()], 'fixture.csv'); f.req.params.id = p.id;
  await assert.rejects(() => f.service.confirm(f.req), /interrupted/);
  assert.equal(f.state.batches[0].status, 'interrupted'); assert.equal(f.state.leads.length, 1);
  const result = await f.service.confirm(f.req); assert.equal(result.added, 1); assert.equal(result.pending, 0); assert.equal(f.state.leads.length, 1);
});
test('batch ownership, expired previews and active company locks prevent unauthorized or concurrent imports', async () => {
  const f = fixture(); const p = await f.service.preview(f.req, [record()], 'fixture.csv'); f.req.params.id = p.id;
  await assert.rejects(() => f.service.getBatch({ ...f.req, crmCompany: foreign }), /not found/);
  await assert.rejects(() => f.service.getBatch({ ...f.req, user: { _id: foreign } }), /not found/);
  f.state.locks.push({ _id: company, owner: 'other', until: new Date(Date.now() + 60000) });
  await assert.rejects(() => f.service.confirm(f.req), /already processing/);
  assert.equal(f.state.leads.length, 0);
  f.state.locks = []; f.state.batches[0].expiresAt = new Date(0);
  await assert.rejects(() => f.service.confirm(f.req), /expired/);
});
test('export scopes combined date/user/assignment filters to tenant and rejects foreign users', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.exportFilter(f.req), { company });
  assert.deepEqual(await f.service.exportFilter({ ...f.req, query: { assignment: 'unassigned' } }), { company, assignedTo: null });
  assert.deepEqual(await f.service.exportFilter({ ...f.req, query: { assignment: 'assigned' } }), { company, assignedTo: { $ne: null } });
  const filter = await f.service.exportFilter({ ...f.req, query: { userId: user, dateMode: 'month', month: '2026-09' } });
  assert.deepEqual(filter, { company, assignedTo: user, leadDate: { $gte: '2026-09-01', $lte: '2026-09-30' } });
  await assert.rejects(() => f.service.exportFilter({ ...f.req, query: { userId: foreign } }), /not available/);
  await assert.rejects(() => f.service.exportFilter({ ...f.req, query: { assignment: 'unassigned', userId: user } }), /cannot be combined/);
});

test('existing Add Lead creation and assignment still accept normal valid requests', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const module = { exports: {} };
  const saved = { _id: type, company, assignedTo: null, async save() {} };
  const populateQuery = { populate() { return this; }, async lean() { return { ...saved, assignedTo: { _id: user, name: 'Test User' } }; } };
  let created;
  const Lead = { create: async data => { created = data; return data; }, findOne: async filter => { assert.equal(filter.company, company); return saved; }, findById: () => populateQuery };
  const masters = { findOne: filter => { assert.equal(filter.company, company); assert.equal(filter.status, 'Active'); return { lean: async () => ({ name: 'Website' }) }; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/crmLeadController'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === 'mongoose') return mongoose;
      if (name === 'validator') return require('validator');
      if (name === '../models/Lead') return Lead;
      if (name === '../HR-CDS/models/Client') return { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
      if (name === '../models/User') return { findOne: filter => { assert.equal(filter.company, company); return { lean: async () => ({ _id: user, name: 'Test User', role: 'telecaller' }) }; } };
      if (name === '../utils/telecallerUsers') return { hasTelecallerAccess: async () => true };
      return masters;
    }
  });
  const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
  await module.exports.create({ crmCompany: company, user: { _id: user }, body: { ...body, leadType: type, leadSource: source } }, response, error => { throw error; });
  assert.equal(response.code, 201); assert.equal(created.phone, body.phone); assert.equal(created.name, 'Test Person');
  assert.equal(created.status, 'new'); assert.equal(created.assignedTo, null);
  await module.exports.assign({ crmCompany: company, params: { id: type }, body: { userId: user } }, response, error => { throw error; });
  assert.equal(saved.assignedTo, user); assert.ok(saved.assignedAt); assert.equal(response.data.item.assignedTo.name, 'Test User');
});
