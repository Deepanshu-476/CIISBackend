// One-time: give chat photos/videos sent before thumbnails existed a small cover picture
// (Message.thumbFile), so the chat shows a preview without downloading the media.
//
// Usage (from the backend folder, uses its .env):
//   node scripts/backfillChatThumbnails.js            # all messages without a thumbnail
//   node scripts/backfillChatThumbnails.js --dry-run  # only count
//   node scripts/backfillChatThumbnails.js --limit=200
//
// The thumbnail is written next to the original file, in whichever uploads folder holds it
// (this backend, the older ../uploads folder, or SHARED_UPLOAD_DIRS). Every backend serves
// all of these folders, so the stored URL works from the web and the apps.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Message = require('../HR-CDS/chat/models/Message');
const { createThumbnailForPath } = require('../HR-CDS/chat/middleware/compressMedia');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 0) : 0;

const backendDir = path.join(__dirname, '..');
const uploadRoots = [
  path.join(backendDir, 'uploads'),
  path.join(backendDir, '..', 'uploads'),
  path.join(backendDir, 'HR-CDS', 'uploads'),
  ...String(process.env.SHARED_UPLOAD_DIRS || '').split(',').map(dir => dir.trim()).filter(Boolean),
];

const MEDIA_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|mp4|mov|m4v|webm|3gp|mkv|avi)$/i;

// "https://host/api/uploads/chat/abc.mp4" -> { relative: "chat/abc.mp4", base: "https://host/api/uploads/" }
const parseUploadUrl = value => {
  const text = String(value || '').trim();
  const match = text.match(/^(.*?\/uploads\/)(.+)$/);
  if (!match) return null;
  return { base: match[1], relative: decodeURIComponent(match[2].split(/[?#]/)[0]) };
};

const findLocalFile = relative => {
  for (const root of uploadRoots) {
    const candidate = path.join(root, relative);
    if (!candidate.startsWith(path.resolve(root))) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return '';
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const filter = {
    deletedForEveryone: { $ne: true },
    file: { $nin: [null, ''] },
    $and: [
      { $or: [{ thumbFile: { $exists: false } }, { thumbFile: '' }, { thumbFile: null }] },
      { $or: [{ fileType: /^(image|video)\//i }, { file: MEDIA_EXT }, { fileName: MEDIA_EXT }] },
    ],
  };
  const total = await Message.countDocuments(filter);
  console.log(`Messages needing a thumbnail: ${total}${dryRun ? ' (dry run)' : ''}`);
  if (dryRun || !total) return process.exit(0);

  let done = 0;
  let made = 0;
  let missing = 0;
  const cursor = Message.find(filter).select('_id file fileType fileName').sort({ createdAt: -1 }).lean().cursor();
  for await (const message of cursor) {
    if (limit && done >= limit) break;
    done += 1;
    const parsed = parseUploadUrl(message.file);
    const localPath = parsed ? findLocalFile(parsed.relative) : '';
    if (!localPath) { missing += 1; continue; }
    const thumbPath = await createThumbnailForPath(localPath, message.fileType || '');
    if (!thumbPath) continue;
    const thumbRelative = path.join(path.dirname(parsed.relative), path.basename(thumbPath)).split(path.sep).join('/');
    await Message.updateOne({ _id: message._id }, { $set: { thumbFile: `${parsed.base}${thumbRelative}` } });
    made += 1;
    if (made % 50 === 0) console.log(`  ${made} thumbnails made (${done} checked)`);
  }
  console.log(`Done: ${made} thumbnails made, ${missing} files not found on this server, ${done} checked.`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
