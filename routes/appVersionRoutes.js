const express = require('express');

const router = express.Router();

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

router.get('/', (req, res) => {
  const platform = String(req.query.platform || 'android').toLowerCase();

  if (platform === 'ios') {
    const latestBuildNumber = parseNumber(process.env.IOS_LATEST_BUILD_NUMBER, 23);
    const minimumBuildNumber = parseNumber(process.env.IOS_MIN_BUILD_NUMBER, 1);
    const latestVersionName = process.env.IOS_LATEST_VERSION_NAME || '1.1.9';
    const bundleId = process.env.IOS_BUNDLE_ID || 'ciisnetwork.in';
    const appStoreId = process.env.IOS_APP_STORE_ID || '6780872642';

    return res.json({
      success: true,
      platform: 'ios',
      latestVersionCode: latestBuildNumber,
      minimumVersionCode: minimumBuildNumber,
      latestBuildNumber,
      minimumBuildNumber,
      latestVersionName,
      forceUpdate: process.env.IOS_FORCE_UPDATE === 'true',
      title: process.env.IOS_UPDATE_TITLE || 'New Update Available',
      message: process.env.IOS_UPDATE_MESSAGE || `Please update CIIS Network to version ${latestVersionName}.`,
      appStoreUrl: process.env.IOS_APP_STORE_URL || `https://apps.apple.com/app/id${appStoreId}`,
      bundleId,
      appStoreId,
    });
  }

  const latestVersionCode = parseNumber(process.env.ANDROID_LATEST_VERSION_CODE, 19);
  const minimumVersionCode = parseNumber(process.env.ANDROID_MIN_VERSION_CODE, 1);
  const latestVersionName = process.env.ANDROID_LATEST_VERSION_NAME || '1.1.9';
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
