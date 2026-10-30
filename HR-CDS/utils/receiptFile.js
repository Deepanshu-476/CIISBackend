const fs = require('fs');
const path = require('path');

// Receipts have been stored under each of the upload roots served by server.js and peer backend processes
// (app1 / the web backend, CIISWEBBACKEND, formerly /var/www/backendruno).
const receiptDirectories = [
  path.resolve(__dirname, '../uploads/receipts'),
  path.resolve(__dirname, '../../uploads/receipts'),
  path.resolve(__dirname, '../../../uploads/receipts'),
  path.resolve('/var/www/CIISWEBBACKEND/HR-CDS/uploads/receipts'),
  path.resolve('/var/www/CIISWEBBACKEND/uploads/receipts'),
  path.resolve('/var/www/backendruno/HR-CDS/uploads/receipts'),
  path.resolve('/var/www/backendruno/uploads/receipts'),
  path.resolve('/var/www/app1/HR-CDS/uploads/receipts'),
  path.resolve('/var/www/app1/uploads/receipts'),
  path.resolve('/var/www/app2/HR-CDS/uploads/receipts'),
  path.resolve('/var/www/app2/uploads/receipts'),
];

const resolveReceiptFile = (value, directories = receiptDirectories) => {
  if (!value) return null;
  let rawFilename = path.posix.basename(String(value).replace(/\\/g, '/'));
  if (!rawFilename || rawFilename === '.' || rawFilename === '..') return null;
  let decodedFilename = rawFilename;
  try {
    decodedFilename = decodeURIComponent(rawFilename);
  } catch {}

  const namesToTry = Array.from(new Set([rawFilename, decodedFilename])).filter(Boolean);

  for (const directory of directories) {
    for (const name of namesToTry) {
      const candidate = path.join(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
  }
  return null;
};

module.exports = {resolveReceiptFile};
