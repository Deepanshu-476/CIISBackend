const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveEmployeeDocumentFile, employeeDocumentFilename } = require('../HR-CDS/utils/employeeDocumentFile');

test('resolve employee files across legacy deployment paths without trusting the stored directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-doc-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const legacy = path.join(root, 'legacy');
  fs.mkdirSync(current);
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'card.pdf'), '%PDF fixture');
  const expected = fs.realpathSync(path.join(legacy, 'card.pdf'));
  for (const value of ['card.pdf', '/uploads/employee-documents/card.pdf', 'C:\\old-server\\uploads\\employee-documents\\card.pdf']) {
    assert.equal(resolveEmployeeDocumentFile(value, [current, legacy]), expected);
  }
  for (const value of ['', '../card.pdf', '/uploads/../card.pdf', 'missing.pdf', 'https://example.com/card.pdf']) {
    assert.equal(resolveEmployeeDocumentFile(value, [current, legacy]), null);
  }
  fs.mkdirSync(path.join(current, 'folder.pdf'));
  assert.equal(resolveEmployeeDocumentFile('folder.pdf', [current]), null);
});

test('download names retain their file extension', () => {
  assert.equal(employeeDocumentFilename({ name: 'PAN CARD' }, '/files/123.pdf'), 'PAN CARD.pdf');
  assert.equal(employeeDocumentFilename({ name: 'card.jpg' }, '/files/123.jpg'), 'card.jpg');
});
