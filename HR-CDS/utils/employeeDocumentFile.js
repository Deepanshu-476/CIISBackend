const fs = require('fs');
const path = require('path');

const documentRoots = [
  path.resolve(__dirname, '../../uploads/employee-documents'),
  path.resolve(__dirname, '../uploads/employee-documents'),
];

function resolveEmployeeDocumentFile(value, roots = documentRoots) {
  const stored = String(value || '').trim().replace(/\\/g, '/');
  if (!stored || /^https?:\/\//i.test(stored) || stored.includes('\0')) return null;
  // Old records can contain a full deployment path or an uploads-relative path.
  // Only resolve files inside the dedicated employee-document directories.
  if (stored.split('/').some(segment => segment === '..')) return null;
  const filename = path.posix.basename(stored);
  if (!filename || filename === '.') return null;
  for (const root of roots) {
    const candidate = path.resolve(root, filename);
    if (path.dirname(candidate) !== path.resolve(root)) continue;
    try {
      const realRoot = fs.realpathSync(root);
      const realFile = fs.realpathSync(candidate);
      if (path.dirname(realFile) === realRoot && fs.statSync(realFile).isFile()) return realFile;
    } catch { /* Try the other supported upload directory. */ }
  }
  return null;
}

function employeeDocumentFilename(document, filePath) {
  const extension = path.extname(filePath);
  const name = path.basename(String(document.name || 'document').replace(/\\/g, '/'));
  return path.extname(name) ? name : `${name}${extension}`;
}

module.exports = { resolveEmployeeDocumentFile, employeeDocumentFilename };
