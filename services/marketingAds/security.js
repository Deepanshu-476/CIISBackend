const crypto = require('node:crypto');

function problem(status, message, reconnect = false) {
  return Object.assign(new Error(message), { status, reconnect, adsError: true });
}

const random = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  crypto.timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));

function encryptionKey() {
  const adsConfig = require('../marketingAdsConfigService');
  const rawKey = process.env.ADS_INTEGRATION_ENCRYPTION_KEY || adsConfig.getEncryptionKey() || '';
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32) throw problem(503, 'Marketing Ads encryption is not configured.');
  return key;
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}

function open(value) {
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]));
}

module.exports = { problem, random, digest, equal, encryptionKey, seal, open };
