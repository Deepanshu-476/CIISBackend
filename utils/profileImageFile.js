const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

// Profile photos used to be stored in the user record as base64 data URIs.
// Every chat list, task list and dashboard repeats them per member, which made
// those responses megabytes. They are saved as files and stored as URLs instead.
const PROFILE_IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'profile-images');
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;

const isDataImage = value => typeof value === 'string' && DATA_IMAGE.test(value.trim());

const publicOrigin = req => {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return `${forwardedProto || req.protocol || 'http'}://${req.get('host')}`.replace(/\/+$/, '');
};

// Returns the file name; the caller builds the URL for its own host.
const saveDataImage = async (dataUri, prefix = 'profile') => {
  const buffer = Buffer.from(dataUri.trim().replace(DATA_IMAGE, ''), 'base64');
  if (!buffer.length) throw new Error('Empty image');
  await fs.promises.mkdir(PROFILE_IMAGE_DIR, { recursive: true });
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
  await sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(path.join(PROFILE_IMAGE_DIR, filename));
  return filename;
};

const profileImageUrl = (origin, filename) => `${origin}/api/uploads/profile-images/${filename}`;

// Runs after the JSON body parser, so every route that accepts a profileImage
// (self edit, admin edit, registration, group image) stores a URL.
const profileImageBodyToFile = async (req, res, next) => {
  const value = req.body?.profileImage;
  if (!isDataImage(value)) return next();
  try {
    req.body.profileImage = profileImageUrl(publicOrigin(req), await saveDataImage(value));
  } catch (error) {
    // An unreadable image is kept as sent, as before.
    console.warn('Profile image could not be saved as a file:', error.message);
  }
  return next();
};

module.exports = { PROFILE_IMAGE_DIR, isDataImage, saveDataImage, profileImageUrl, profileImageBodyToFile };
