const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const yauzl = require('yauzl');
const path = require('node:path');
const validator = require('validator');

const COLUMNS = [
  ['Full Name', 'fullName'], ['Email', 'email'], ['Phone', 'phone'], ['Gender', 'gender'],
  ['Lead Date', 'leadDate'], ['Address', 'address'], ['Lead Source', 'leadSource'], ['Lead Type', 'leadType'],
  ...Array.from({ length: 5 }, (_, i) => [`Custom Field ${i + 1}`, `customField${i + 1}`]), ['Remarks', 'remarks']
];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const badRequest = message => Object.assign(new Error(message), { status: 400 });
const safeText = value => {
  const text = String(value ?? '');
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
};
const csvLine = values => values.map(value => `"${safeText(value).replace(/"/g, '""')}"`).join(',') + '\r\n';
const normalizedPhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};
const normalizedEmail = value => String(value || '').trim().toLowerCase();

// XLSX is a ZIP container. Bound decompressed input before loading XML into memory.
function checkArchive(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(badRequest('Invalid or encrypted Excel workbook.'));
      let bytes = 0, entries = 0, inflated = 0;
      const fail = () => { zip.close(); reject(badRequest('Excel workbook is too large or contains unsupported content.')); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        bytes += entry.uncompressedSize;
        if (++entries > 500 || bytes > 25 * 1024 * 1024 || (entry.generalPurposeBitFlag & 1)) return fail();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail();
          stream.on('error', fail);
          stream.on('data', chunk => { inflated += chunk.length; if (inflated > 25 * 1024 * 1024) { stream.destroy(); fail(); } });
          stream.on('end', () => zip.readEntry());
        });
      });
      zip.on('end', resolve);
      zip.readEntry();
    });
  });
}

function cellText(cell, key, date1904) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value === 'object' && (value.formula || value.sharedFormula)) throw badRequest('Formula cells are not allowed; paste values instead.');
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (key === 'leadDate' && typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465 || (!date1904 && Math.floor(value) === 60)) return '';
    const days = date1904 ? Math.floor(value) + 1462 : Math.floor(value) < 60 ? Math.floor(value) + 1 : Math.floor(value);
    return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    throw badRequest('Unsupported or error cell; replace it with plain text.');
  }
  // Honor a phone cell's explicit zero-padding without coercing text numbers.
  if (key === 'phone' && typeof value === 'number' && /^0+$/.test(cell.numFmt || '')) return String(value).padStart(cell.numFmt.length, '0');
  return String(value);
}

async function readUpload(file) {
  if (!file?.buffer?.length) throw badRequest('Choose a nonempty Excel or CSV file.');
  if (file.buffer.length > MAX_BYTES) throw badRequest('Maximum file size is 5 MB.');
  const extension = path.extname(file.originalname || '').toLowerCase();
  let rows, sheet, book;
  if (extension === '.csv') {
    try {
      rows = parse(file.buffer, { bom: true, skip_empty_lines: false, relax_column_count: true, max_record_size: 32000, to: MAX_ROWS + 2 });
    } catch { throw badRequest('Invalid CSV. Check quoting and the 32,000-character row limit.'); }
  } else if (extension === '.xlsx') {
    await checkArchive(file.buffer);
    book = new ExcelJS.Workbook();
    try { await book.xlsx.load(file.buffer); } catch { throw badRequest('Cannot read Excel workbook. Save it as an unencrypted .xlsx file.'); }
    sheet = book.getWorksheet('Leads');
    if (!sheet) throw badRequest('Excel workbook must contain a sheet named Leads.');
    if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > COLUMNS.length) throw badRequest(`Use at most ${MAX_ROWS} data rows and the template columns only.`);
    rows = Array.from({ length: sheet.rowCount }, (_, index) => Array.from({ length: COLUMNS.length }, (_, col) => sheet.getRow(index + 1).getCell(col + 1)));
  } else throw badRequest('Supported file formats: .xlsx and .csv.');
  if (rows.length > MAX_ROWS + 1) throw badRequest(`Maximum ${MAX_ROWS} data rows per file, including blank rows.`);
  if (!rows.length) throw badRequest('File is empty.');
  const headers = rows[0].map(cell => (sheet ? cellText(cell) : String(cell)).trim());
  const expected = COLUMNS.map(([name]) => name);
  const missing = expected.filter(name => !headers.includes(name));
  const duplicate = [...new Set(headers.filter((name, index) => headers.indexOf(name) !== index))];
  const unsupported = headers.filter(name => !expected.includes(name));
  if (missing.length || duplicate.length || unsupported.length) throw badRequest([
    missing.length && `Missing headers: ${missing.join(', ')}`,
    duplicate.length && `Duplicate headers: ${duplicate.join(', ')}`,
    unsupported.length && `Unsupported headers: ${unsupported.map(s => s || '(blank)').join(', ')}`
  ].filter(Boolean).join('. '));
  const records = [];
  rows.slice(1).forEach((row, index) => {
    const body = {}, errors = [];
    if (!sheet && row.length > headers.length && row.slice(headers.length).some(value => String(value).trim())) errors.push('Extra values beyond the template columns.');
    COLUMNS.forEach(([header, key]) => {
      try { body[key] = sheet ? cellText(row[headers.indexOf(header)], key, book.properties.date1904) : String(row[headers.indexOf(header)] ?? ''); }
      catch (error) { body[key] = ''; errors.push(`${header}: ${error.message}`); }
    });
    if (errors.length || Object.values(body).some(value => value.trim())) records.push({ rowNumber: index + 2, body, parseErrors: errors });
  });
  if (!records.length) throw badRequest('No lead rows found. Fill the Leads sheet below the headers.');
  return records;
}

function styleSheet(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  sheet.columns.forEach(column => { column.width = 24; column.numFmt = '@'; });
}
async function templateBuffer(types, sources) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Leads');
  sheet.addRow(COLUMNS.map(([header]) => header));
  styleSheet(sheet);
  const instructions = book.addWorksheet('Instructions');
  [
    ['Import instructions', 'Details'],
    ['Required', 'Full Name, Email, Phone, Lead Date, Lead Source, Lead Type'],
    ['Lead Date', 'YYYY-MM-DD or an Excel date cell'],
    ['Phone', 'Exactly 10 digits. Keep the column formatted as Text to preserve leading zeros.'],
    ['Gender', 'Blank, Male, Female, Other'],
    ['Limits', '5 MB; 1,000 data rows; .xlsx or UTF-8 .csv'],
    ['Duplicates', 'Phone or email matches within your company or file are skipped; no existing lead is overwritten.'],
    ['Source / Type', 'Use active names listed below; do not enter IDs.'],
    ['Example ONLY - not imported', 'This sheet is never imported. Enter your own leads on the empty Leads sheet.'],
    ['Example name', 'Example Person'], ['Example email', 'example@example.com'],
    ['Example phone', '0123456789'], ['Example Lead Date', '2026-09-16'],
    ['Active Lead Sources', sources.map(item => item.name).join(', ') || 'None; configure an active source first.'],
    ['Active Lead Types', types.map(item => item.name).join(', ') || 'None; configure an active type first.'],
    ['Other fields', 'Address, Custom Field 1-5 and Remarks are optional. Do not rename the column headers.']
  ].forEach(row => instructions.addRow(row.map(safeText)));
  styleSheet(instructions);
  instructions.getColumn(1).width = 32;
  instructions.getColumn(2).width = 100;
  instructions.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  return book.xlsx.writeBuffer();
}

function dateRange(query) {
  const mode = query.dateMode || 'all';
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && validator.isDate(value, { format: 'YYYY-MM-DD', strictMode: true });
  let from, to;
  if (mode === 'all') return null;
  if (mode === 'date') from = to = query.date;
  else if (mode === 'range') { from = query.from; to = query.to; }
  else if (mode === 'month') {
    if (!/^\d{4}-\d{2}$/.test(query.month || '') || !valid(`${query.month}-01`)) throw badRequest('Choose a valid month.');
    from = `${query.month}-01`;
    const end = new Date(`${from}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    to = end.toISOString().slice(0, 10);
  } else if (mode === 'week') {
    if (!valid(query.date)) throw badRequest('Choose a valid date within the week.');
    const start = new Date(`${query.date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    from = start.toISOString().slice(0, 10); start.setUTCDate(start.getUTCDate() + 6); to = start.toISOString().slice(0, 10);
  } else throw badRequest('Unsupported date filter.');
  if (!valid(from) || !valid(to) || from > to) throw badRequest('Provide valid dates; From must be on or before To.');
  return { $gte: from, $lte: to };
}
function leadValues(lead) {
  return COLUMNS.map(([, key]) => key === 'fullName' ? lead.name : key === 'leadSource' ? lead.leadSource?.name || lead.source || '' : key === 'leadType' ? lead.leadType?.name || '' : lead[key] || '');
}
module.exports = { COLUMNS, MAX_BYTES, MAX_ROWS, badRequest, safeText, csvLine, normalizedPhone, normalizedEmail, readUpload, templateBuffer, styleSheet, dateRange, leadValues };
