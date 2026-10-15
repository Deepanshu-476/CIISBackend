const fs = require('fs');
const path = require('path');

// Receipts have been stored under each of the upload roots served by server.js.
const receiptDirectories = [
  path.resolve(__dirname, '../uploads/receipts'),
  path.resolve(__dirname, '../../uploads/receipts'),
  path.resolve(__dirname, '../../../uploads/receipts'),
];

const resolveReceiptFile = (value, directories = receiptDirectories) => {
  const filename = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  if (!filename || filename === '.' || filename === '..') return null;
  for (const directory of directories) {
    const candidate = path.join(directory, filename);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
};

module.exports = {resolveReceiptFile};
