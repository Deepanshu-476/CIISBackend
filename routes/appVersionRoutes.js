const express = require('express');
const AppVersionSettings = require('../models/AppVersionSettings');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
const OWNER_SUPERADMIN_EMAIL = 'ashutoshrai130@gmail.com';

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

const getFallbackSettings = () => {
  const iosAppStoreId = process.env.IOS_APP_STORE_ID || '6780872642';
  const iosLatestVersionName = process.env.IOS_LATEST_VERSION_NAME || '1.1.16';
  const androidPackageName = process.env.ANDROID_PACKAGE_NAME || 'ciisnetwork.in';
  const androidLatestVersionName = process.env.ANDROID_LATEST_VERSION_NAME || '1.1.16';

  return {
    ios: {
      latestVersionName: iosLatestVersionName,
      latestVersionCode: parseNumber(process.env.IOS_LATEST_BUILD_NUMBER, 31),
      minimumVersionCode: parseNumber(process.env.IOS_MIN_BUILD_NUMBER, 1),
      forceUpdate: process.env.IOS_FORCE_UPDATE === 'true',
      title: process.env.IOS_UPDATE_TITLE || 'New Update Available',
      message: process.env.IOS_UPDATE_MESSAGE || `Please update CIIS Network to version ${iosLatestVersionName}.`,
      storeUrl: process.env.IOS_APP_STORE_URL || `https://apps.apple.com/app/id${iosAppStoreId}`,
      appIdentifier: process.env.IOS_BUNDLE_ID || 'ciisnetwork.in',
      storeId: iosAppStoreId,
    },
    android: {
      latestVersionName: androidLatestVersionName,
      latestVersionCode: parseNumber(process.env.ANDROID_LATEST_VERSION_CODE, 27),
      minimumVersionCode: parseNumber(process.env.ANDROID_MIN_VERSION_CODE, 1),
      forceUpdate: process.env.ANDROID_FORCE_UPDATE === 'true',
      title: process.env.ANDROID_UPDATE_TITLE || 'New Update Available',
      message: process.env.ANDROID_UPDATE_MESSAGE || `Please update CIIS Network to version ${androidLatestVersionName}.`,
      storeUrl: process.env.ANDROID_PLAY_STORE_URL || `https://play.google.com/store/apps/details?id=${androidPackageName}`,
      appIdentifier: androidPackageName,
      storeId: '',
    },
  };
};

const mergeWithFallback = (settings) => {
  const fallback = getFallbackSettings();
  const raw = settings?.toObject ? settings.toObject() : settings;
  const updatedBy = raw?.updatedBy || null;

  return {
    ios: { ...fallback.ios, ...(raw?.ios || {}) },
    android: { ...fallback.android, ...(raw?.android || {}) },
    updatedAt: raw?.updatedAt || null,
    updatedBy,
    updatedByName: updatedBy && typeof updatedBy === 'object'
      ? updatedBy.name || updatedBy.email || ''
      : '',
  };
};

const getSettings = async () => {
  const settings = await AppVersionSettings.findOne({ key: 'global' })
    .populate('updatedBy', 'name email')
    .lean();
  return mergeWithFallback(settings);
};

const buildPublicResponse = (platform, settings) => {
  const data = platform === 'ios' ? settings.ios : settings.android;

  if (platform === 'ios') {
    return {
      success: true,
      platform: 'ios',
      latestVersionCode: data.latestVersionCode,
      minimumVersionCode: data.minimumVersionCode,
      latestBuildNumber: data.latestVersionCode,
      minimumBuildNumber: data.minimumVersionCode,
      latestVersionName: data.latestVersionName,
      forceUpdate: data.forceUpdate === true,
      title: data.title || 'New Update Available',
      message: data.message || `Please update CIIS Network to version ${data.latestVersionName}.`,
      appStoreUrl: data.storeUrl,
      bundleId: data.appIdentifier,
      appStoreId: data.storeId,
    };
  }

  return {
    success: true,
    platform: 'android',
    latestVersionCode: data.latestVersionCode,
    minimumVersionCode: data.minimumVersionCode,
    latestVersionName: data.latestVersionName,
    forceUpdate: data.forceUpdate === true,
    title: data.title || 'New Update Available',
    message: data.message || `Please update CIIS Network to version ${data.latestVersionName}.`,
    playStoreUrl: data.storeUrl,
    packageName: data.appIdentifier,
  };
};

const requireOwnerSuperAdmin = (req, res, next) => {
  const email = String(req.user?.email || '').trim().toLowerCase();
  const jobRole = String(req.user?.jobRole || '').trim().toLowerCase();
  const companyRole = String(req.user?.companyRole || '').trim().toLowerCase();

  if (
    email === OWNER_SUPERADMIN_EMAIL ||
    jobRole === 'super_admin' ||
    jobRole === 'superadmin' ||
    companyRole === 'superadmin'
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Only SuperAdmin can manage app version settings',
  });
};

const sanitizePlatformInput = (input = {}, fallback) => {
  const source = input && typeof input === 'object' ? input : {};
  const latestVersionName = String(source.latestVersionName ?? fallback.latestVersionName ?? '').trim();
  const latestVersionCode = parseNumber(source.latestVersionCode, fallback.latestVersionCode);
  const minimumVersionCode = parseNumber(source.minimumVersionCode, fallback.minimumVersionCode);

  if (latestVersionCode < 0 || minimumVersionCode < 0) {
    throw new Error('Version code/build number cannot be negative');
  }

  return {
    latestVersionName,
    latestVersionCode,
    minimumVersionCode,
    forceUpdate: normalizeBoolean(source.forceUpdate, fallback.forceUpdate),
    title: String(source.title ?? fallback.title ?? 'New Update Available').trim(),
    message: String(source.message ?? fallback.message ?? '').trim(),
    storeUrl: String(source.storeUrl ?? fallback.storeUrl ?? '').trim(),
    appIdentifier: String(source.appIdentifier ?? fallback.appIdentifier ?? '').trim(),
    storeId: String(source.storeId ?? fallback.storeId ?? '').trim(),
  };
};

router.get('/admin', protect, requireOwnerSuperAdmin, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Get app version settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to load app version settings' });
  }
});

router.put('/admin', protect, requireOwnerSuperAdmin, async (req, res) => {
  try {
    const current = await getSettings();
    const nextSettings = {
      ios: sanitizePlatformInput(req.body?.ios, current.ios),
      android: sanitizePlatformInput(req.body?.android, current.android),
      updatedBy: req.user?._id || req.user?.id || null,
    };

    const saved = await AppVersionSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: nextSettings, $setOnInsert: { key: 'global' } },
      { new: true, upsert: true, runValidators: true }
    )
      .populate('updatedBy', 'name email')
      .lean();

    res.json({
      success: true,
      message: 'App version settings saved successfully',
      settings: mergeWithFallback(saved),
    });
  } catch (error) {
    console.error('Update app version settings error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to save app version settings' });
  }
});

router.get('/', async (req, res) => {
  const platform = String(req.query.platform || 'android').toLowerCase();

  if (!['android', 'ios'].includes(platform)) {
    return res.status(400).json({ success: false, message: 'Invalid platform' });
  }

  try {
    const settings = await getSettings();
    res.json(buildPublicResponse(platform, settings));
  } catch (error) {
    console.error('App version lookup error, using env fallback:', error);
    res.json(buildPublicResponse(platform, mergeWithFallback(null)));
  }
});

module.exports = router;
