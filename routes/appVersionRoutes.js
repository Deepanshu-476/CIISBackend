const express = require('express');

const router = express.Router();

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

router.get('/', (_req, res) => {
  const latestVersionCode = parseNumber(process.env.ANDROID_LATEST_VERSION_CODE, 14);
  const minimumVersionCode = parseNumber(process.env.ANDROID_MIN_VERSION_CODE, 1);
  const latestVersionName = process.env.ANDROID_LATEST_VERSION_NAME || '1.1.5';
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'ciisnetwork.in';

  res.json({
    success: true,
    platform: 'android',
    latestVersionCode,
    minimumVersionCode,
    latestVersionName,
    forceUpdate: process.env.ANDROID_FORCE_UPDATE === 'true',
    title: process.env.ANDROID_UPDATE_TITLE || 'New Update Available',
    message: process.env.ANDROID_UPDATE_MESSAGE || `Please update CIIS Network to version ${latestVersionName}.`,
    playStoreUrl: process.env.ANDROID_PLAY_STORE_URL || `https://play.google.com/store/apps/details?id=${packageName}`,
    packageName,
  });
});

module.exports = router;
