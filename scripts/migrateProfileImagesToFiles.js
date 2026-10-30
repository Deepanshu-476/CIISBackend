require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { isDataImage, saveDataImage, profileImageUrl } = require('../utils/profileImageFile');

// One-time move of base64 profile photos (users.profileImage = data:image/...)
// into uploads/profile-images, storing the file URL instead. New uploads are
// converted by the profileImageBodyToFile middleware.
//
// Run on the server, in the backend that owns the given origin, so the files
// land where that origin serves them:
//   node scripts/migrateProfileImagesToFiles.js --origin=https://backendcds.ciisnetwork.in            (dry run)
//   node scripts/migrateProfileImagesToFiles.js --origin=https://backendcds.ciisnetwork.in --apply
// --apply writes a JSON backup of the old values next to the script first.
const arg = name => (process.argv.find(item => item.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

async function main() {
  const apply = process.argv.includes('--apply');
  const origin = arg('origin').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Error('--origin=https://host is required');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.db.collection('users');

  const rows = await users.find({ profileImage: /^data:image\//i }).project({ profileImage: 1, email: 1 }).toArray();
  const summary = { mode: apply ? 'apply' : 'dry-run', origin, users: rows.length, kb: Math.round(rows.reduce((sum, row) => sum + row.profileImage.length, 0) / 1024), moved: 0, failed: [] };
  if (!apply) {
    rows.forEach(row => console.log(`would move ${row.email || row._id} (${Math.round(row.profileImage.length / 1024)} KB)`));
    console.log(JSON.stringify(summary));
    return;
  }

  const backupFile = path.join(__dirname, `profileImages-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rows));
  summary.backup = backupFile;

  for (const row of rows) {
    if (!isDataImage(row.profileImage)) continue;
    try {
      const url = profileImageUrl(origin, await saveDataImage(row.profileImage, `profile_${row._id}`));
      // Only replace the exact value read, in case the user changed it meanwhile.
      const result = await users.updateOne({ _id: row._id, profileImage: row.profileImage }, { $set: { profileImage: url } });
      if (result.modifiedCount) summary.moved++;
      console.log(`${row.email || row._id} -> ${url}`);
    } catch (error) {
      summary.failed.push({ id: String(row._id), error: error.message });
    }
  }
  console.log(JSON.stringify(summary));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
