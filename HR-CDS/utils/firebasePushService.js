const Device = require('../../models/Device');
const User = require('../../models/User');
const fs = require('fs');
const path = require('path');

let firebaseAdmin = null;
let firebaseReady = false;
let firebaseStatus = {
  ready: false,
  source: null,
  reason: 'not-initialized',
  attemptedPaths: [],
  projectId: null,
};

const logPushDebug = (label, payload = {}) => {
  console.log(`[FCM DEBUG] ${label}`, {
    at: new Date().toISOString(),
    ...payload,
  });
};

const loadFirebaseAdmin = () => {
  if (firebaseReady) return firebaseAdmin;
  firebaseReady = true;
  firebaseStatus = {
    ready: false,
    source: null,
    reason: 'initializing',
    attemptedPaths: [],
    projectId: null,
  };

  try {
    firebaseAdmin = require('firebase-admin');

    if (firebaseAdmin.apps.length) {
      firebaseStatus = {
        ready: true,
        source: 'existing-app',
        reason: null,
        attemptedPaths: [],
        projectId: firebaseAdmin.app().options?.projectId || null,
      };
      logPushDebug('firebase-admin:reuse-existing-app');
      return firebaseAdmin;
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credentials),
      });
      firebaseStatus = {
        ready: true,
        source: 'FIREBASE_SERVICE_ACCOUNT_JSON',
        reason: null,
        attemptedPaths: [],
        projectId: credentials.project_id,
      };
      logPushDebug('firebase-admin:initialized-env-json', {
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
      });
      return firebaseAdmin;
    }

    const cleanPath = value => String(value || '').trim().replace(/^['"]|['"]$/g, '');
    const addPath = (paths, value) => {
      const cleaned = cleanPath(value);
      if (!cleaned) return;
      const resolved = path.isAbsolute(cleaned) ? cleaned : path.resolve(__dirname, '../..', cleaned);
      if (!paths.includes(resolved)) paths.push(resolved);
    };

    const credentialPaths = [];
    addPath(credentialPaths, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    addPath(credentialPaths, path.join(__dirname, '../../firebase.json'));
    addPath(credentialPaths, path.join(process.cwd(), 'firebase.json'));

    firebaseStatus.attemptedPaths = credentialPaths;

    for (const credentialsPath of credentialPaths) {
      if (!fs.existsSync(credentialsPath)) continue;

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credentials),
        projectId: credentials.project_id,
      });
      firebaseStatus = {
        ready: true,
        source: credentialsPath,
        reason: null,
        attemptedPaths: credentialPaths,
        projectId: credentials.project_id,
      };
      logPushDebug('firebase-admin:initialized-file', {
        path: credentialsPath,
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
      });
      return firebaseAdmin;
    }

    firebaseAdmin = null;
    firebaseStatus = {
      ready: false,
      source: null,
      reason: 'missing-credentials-file',
      attemptedPaths: credentialPaths,
      projectId: null,
    };
    console.warn('[FCM DEBUG] firebase-admin:disabled-missing-credentials', {
      at: new Date().toISOString(),
      attemptedPaths: credentialPaths,
    });
    return null;
  } catch (error) {
    firebaseAdmin = null;
    firebaseStatus = {
      ready: false,
      source: null,
      reason: error.message,
      attemptedPaths: firebaseStatus.attemptedPaths,
      projectId: null,
    };
    console.warn('[FCM DEBUG] firebase-admin:disabled-error', {
      at: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    });
    return null;
  }
};

exports.getFirebasePushStatus = () => {
  loadFirebaseAdmin();
  return firebaseStatus;
};

const stringifyData = data =>
  Object.entries(data || {}).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
    return acc;
  }, {});

exports.sendPushToUsers = async ({userIds, title, body, data = {}}) => {
  logPushDebug('sendPushToUsers:start', {
    userIds: (userIds || []).map(String),
    title,
    body,
    dataKeys: Object.keys(data || {}),
  });

  const admin = loadFirebaseAdmin();
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
  if (!admin || !ids.length) {
    logPushDebug('sendPushToUsers:skipped', {
      hasAdmin: Boolean(admin),
      userCount: ids.length,
    });
    return {success: false, sent: 0, reason: !admin ? 'firebase-admin-not-ready' : 'no-user-ids'};
  }

  let devices = await Device.find({
    userId: {$in: ids},
    deviceToken: {$exists: true, $ne: ''},
  }).select('deviceToken userId');

  if (!devices.length) {
    const recipientUsers = await User.find({_id: {$in: ids}})
      .select('_id name email company companyCode')
      .lean();
    const emails = [...new Set(recipientUsers.map(user => String(user.email || '').trim().toLowerCase()).filter(Boolean))];
    const relatedUsers = emails.length
      ? await User.find({
        _id: {$nin: ids},
        email: {$in: emails},
      }).select('_id name email company companyCode').lean()
      : [];
    const relatedUserIds = relatedUsers.map(user => String(user._id));

    if (relatedUserIds.length) {
      devices = await Device.find({
        userId: {$in: relatedUserIds},
        deviceToken: {$exists: true, $ne: ''},
      }).select('deviceToken userId');

      logPushDebug('devices:fallback-same-email-lookup', {
        requestedUserIds: ids,
        recipientUsers: recipientUsers.map(user => ({
          userId: String(user._id),
          name: user.name,
          email: user.email,
          companyCode: user.companyCode,
        })),
        relatedUserIds,
        deviceCount: devices.length,
        devices: devices.map(device => ({
          userId: String(device.userId),
          tokenPreview: `${String(device.deviceToken).slice(0, 12)}...${String(device.deviceToken).slice(-6)}`,
        })),
      });
    } else {
      logPushDebug('devices:no-same-email-fallback-users', {
        requestedUserIds: ids,
        recipientUsers: recipientUsers.map(user => ({
          userId: String(user._id),
          name: user.name,
          email: user.email,
          companyCode: user.companyCode,
        })),
      });
    }
  }

  logPushDebug('devices:lookup', {
    userCount: ids.length,
    deviceCount: devices.length,
    devices: devices.map(device => ({
      userId: String(device.userId),
      tokenPreview: `${String(device.deviceToken).slice(0, 12)}...${String(device.deviceToken).slice(-6)}`,
    })),
  });

  const tokens = [...new Set(devices.map(device => device.deviceToken).filter(Boolean))];
  if (!tokens.length) {
    const recentDevices = await Device.find({})
      .sort({updatedAt: -1, createdAt: -1})
      .limit(5)
      .select('userId platform notificationPermission updatedAt createdAt deviceToken');

    logPushDebug('sendPushToUsers:no-device-tokens', {
      userIds: ids,
      recentDeviceCount: recentDevices.length,
      recentDevices: recentDevices.map(device => ({
        userId: String(device.userId || ''),
        platform: device.platform,
        notificationPermission: device.notificationPermission,
        updatedAt: device.updatedAt,
        createdAt: device.createdAt,
        tokenPreview: device.deviceToken
          ? `${String(device.deviceToken).slice(0, 12)}...${String(device.deviceToken).slice(-6)}`
          : null,
      })),
    });
    return {success: true, sent: 0, reason: 'no-device-tokens'};
  }

  // Helper: chunk array into batches
  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const MAX_BATCH = 500; // FCM limit for multicast
  const batches = chunk(tokens, MAX_BATCH);

  let totalSent = 0;
  let totalFailed = 0;
  const tokensToRemove = new Set();

  // Simple retry with backoff
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (let b = 0; b < batches.length; b++) {
    const batchTokens = batches[b];
    const message = {
      tokens: batchTokens,
      notification: {
        title: title || 'New notification',
        body: body || '',
      },
      data: stringifyData(data),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'ciis_high_priority',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    let attempt = 0;
    let lastError = null;
    while (attempt < 3) {
      try {
        const response = await admin.messaging().sendEachForMulticast(message);
        totalSent += response.successCount || 0;
        totalFailed += response.failureCount || 0;

        logPushDebug('firebase:batch-result', {
          batchIndex: b,
          tokenCount: batchTokens.length,
          successCount: response.successCount || 0,
          failureCount: response.failureCount || 0,
          failures: (response.responses || [])
            .map((result, index) => result.success ? null : {
              tokenPreview: `${String(batchTokens[index]).slice(0, 12)}...${String(batchTokens[index]).slice(-6)}`,
              code: result.error?.code,
              message: result.error?.message,
            })
            .filter(Boolean),
        });

        (response.responses || []).forEach((result, index) => {
          if (!result.success) {
            const code = result.error?.code || '';
            if (
              code.includes('registration-token-not-registered') ||
              code.includes('invalid-registration-token')
            ) {
              tokensToRemove.add(batchTokens[index]);
            }
          }
        });

        // success break retry loop
        break;
      } catch (err) {
        lastError = err;
        attempt += 1;
        const backoff = 200 * Math.pow(2, attempt); // 400, 800, 1600ms
        console.warn('[FCM DEBUG] firebase:batch-exception', {
          at: new Date().toISOString(),
          batchIndex: b,
          attempt,
          retryInMs: backoff,
          message: err.message,
          stack: err.stack,
        });
        await sleep(backoff);
      }
    }

    if (attempt >= 3 && lastError) {
      console.error('[FCM DEBUG] firebase:batch-failed-final', {
        at: new Date().toISOString(),
        batchIndex: b,
        attempts: attempt,
        message: lastError.message,
        stack: lastError.stack,
      });
    }
  }

  if (tokensToRemove.size) {
    await Device.deleteMany({deviceToken: {$in: Array.from(tokensToRemove)}}).catch(err => console.warn('Failed to cleanup invalid tokens:', err.message || err));
    logPushDebug('devices:invalid-tokens-cleaned', {
      count: tokensToRemove.size,
    });
  }

  const result = {
    success: true,
    sent: totalSent,
    failed: totalFailed,
    cleanedTokens: tokensToRemove.size,
  };

  logPushDebug('sendPushToUsers:complete', result);

  return result;
};
