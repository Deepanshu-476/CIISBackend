const crypto = require('crypto');
const PlatformAdsConfig = require('../models/PlatformAdsConfig');

let cachedConfig = null;

function defaultOrigins() {
  const crmOrigin = process.env.ADS_CRM_ORIGIN || process.env.BASE_URL || 'https://cds.ciisnetwork.in';
  const apiOrigin = process.env.ADS_PUBLIC_API_ORIGIN || 'https://backendcds.ciisnetwork.in';
  return { crmOrigin, apiOrigin };
}

async function loadConfig() {
  try {
    let doc = await PlatformAdsConfig.findOne({ key: 'global' });
    const { crmOrigin, apiOrigin } = defaultOrigins();

    if (!doc) {
      let masterKey = process.env.ADS_INTEGRATION_ENCRYPTION_KEY;
      if (!masterKey || Buffer.from(masterKey, 'base64').length !== 32) {
        masterKey = crypto.randomBytes(32).toString('base64');
      }

      doc = await PlatformAdsConfig.create({
        key: 'global',
        adsIntegrationEncryptionKey: masterKey,
        adsCrmOrigin: crmOrigin,
        adsPublicApiOrigin: apiOrigin,
        metaAppId: process.env.META_APP_ID || '',
        metaAppSecret: process.env.META_APP_SECRET || '',
        metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'ciis_meta_verify_token_2026_secure',
        metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || 'v26.0',
        googleClientId: process.env.GOOGLE_CLIENT_ID || '',
        googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
        googleAdsApiVersion: process.env.GOOGLE_ADS_API_VERSION || 'v26'
      });
    } else {
      let needsSave = false;
      if (!doc.adsIntegrationEncryptionKey) {
        doc.adsIntegrationEncryptionKey = process.env.ADS_INTEGRATION_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
        needsSave = true;
      }
      if (!doc.adsCrmOrigin) {
        doc.adsCrmOrigin = crmOrigin;
        needsSave = true;
      }
      if (!doc.adsPublicApiOrigin) {
        doc.adsPublicApiOrigin = apiOrigin;
        needsSave = true;
      }
      if (needsSave) {
        await doc.save();
      }
    }

    cachedConfig = doc.toObject();

    // Ensure master encryption key is available on process.env as well
    if (!process.env.ADS_INTEGRATION_ENCRYPTION_KEY && cachedConfig.adsIntegrationEncryptionKey) {
      process.env.ADS_INTEGRATION_ENCRYPTION_KEY = cachedConfig.adsIntegrationEncryptionKey;
    }

    return cachedConfig;
  } catch (error) {
    console.error('Error loading PlatformAdsConfig:', error.message);
    const { crmOrigin, apiOrigin } = defaultOrigins();
    return {
      adsCrmOrigin: crmOrigin,
      adsPublicApiOrigin: apiOrigin,
      metaAppId: process.env.META_APP_ID || '',
      metaAppSecret: process.env.META_APP_SECRET || '',
      metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'ciis_meta_verify_token_2026_secure',
      metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || 'v26.0',
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      googleAdsApiVersion: process.env.GOOGLE_ADS_API_VERSION || 'v26',
      adsIntegrationEncryptionKey: process.env.ADS_INTEGRATION_ENCRYPTION_KEY || ''
    };
  }
}

async function init() {
  await loadConfig();
}

function getConfigSync() {
  if (cachedConfig) return cachedConfig;
  const { crmOrigin, apiOrigin } = defaultOrigins();
  return {
    adsCrmOrigin: process.env.ADS_CRM_ORIGIN || crmOrigin,
    adsPublicApiOrigin: process.env.ADS_PUBLIC_API_ORIGIN || apiOrigin,
    metaAppId: process.env.META_APP_ID || '',
    metaAppSecret: process.env.META_APP_SECRET || '',
    metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'ciis_meta_verify_token_2026_secure',
    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || 'v26.0',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    googleAdsApiVersion: process.env.GOOGLE_ADS_API_VERSION || 'v26',
    adsIntegrationEncryptionKey: process.env.ADS_INTEGRATION_ENCRYPTION_KEY || ''
  };
}

async function getPublicConfig() {
  const config = (await loadConfig()) || getConfigSync();
  const apiOrigin = config.adsPublicApiOrigin || 'https://backendcds.ciisnetwork.in';
  const crmOrigin = config.adsCrmOrigin || 'https://cds.ciisnetwork.in';

  const hasMetaSecret = Boolean(config.metaAppSecret || process.env.META_APP_SECRET);
  const hasGoogleSecret = Boolean(config.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET);

  const metaConfigured = Boolean(
    (config.metaAppId || process.env.META_APP_ID) &&
    hasMetaSecret &&
    (config.metaWebhookVerifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN)
  );

  const googleConfigured = Boolean(
    (config.googleClientId || process.env.GOOGLE_CLIENT_ID) &&
    hasGoogleSecret &&
    (config.googleAdsDeveloperToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN)
  );

  return {
    metaAppId: config.metaAppId || process.env.META_APP_ID || '',
    hasMetaAppSecret: hasMetaSecret,
    metaAppSecretMasked: hasMetaSecret ? '••••••••••••' : '',
    metaWebhookVerifyToken: config.metaWebhookVerifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN || 'ciis_meta_verify_token_2026_secure',
    metaGraphApiVersion: config.metaGraphApiVersion || process.env.META_GRAPH_API_VERSION || 'v26.0',

    googleClientId: config.googleClientId || process.env.GOOGLE_CLIENT_ID || '',
    hasGoogleClientSecret: hasGoogleSecret,
    googleClientSecretMasked: hasGoogleSecret ? '••••••••••••' : '',
    googleAdsDeveloperToken: config.googleAdsDeveloperToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    googleAdsApiVersion: config.googleAdsApiVersion || process.env.GOOGLE_ADS_API_VERSION || 'v26',

    adsCrmOrigin: crmOrigin,
    adsPublicApiOrigin: apiOrigin,

    metaCallbackUrl: `${apiOrigin}/api/crm/marketing-ads/oauth/meta/callback`,
    metaWebhookUrl: `${apiOrigin}/api/integrations/meta/webhook`,
    googleCallbackUrl: `${apiOrigin}/api/crm/marketing-ads/oauth/google/callback`,

    metaConfigured,
    googleConfigured,
    updatedAt: config.updatedAt
  };
}

async function updateConfig(payload = {}, userId = null) {
  let doc = await PlatformAdsConfig.findOne({ key: 'global' });
  if (!doc) {
    doc = new PlatformAdsConfig({ key: 'global' });
  }

  if (typeof payload.metaAppId === 'string') {
    doc.metaAppId = payload.metaAppId.trim();
  }
  if (typeof payload.metaAppSecret === 'string') {
    const trimmed = payload.metaAppSecret.trim();
    if (trimmed && !trimmed.startsWith('•')) {
      doc.metaAppSecret = trimmed;
    }
  }
  if (typeof payload.metaWebhookVerifyToken === 'string') {
    doc.metaWebhookVerifyToken = payload.metaWebhookVerifyToken.trim() || 'ciis_meta_verify_token_2026_secure';
  }
  if (typeof payload.metaGraphApiVersion === 'string' && payload.metaGraphApiVersion.trim()) {
    doc.metaGraphApiVersion = payload.metaGraphApiVersion.trim();
  }

  if (typeof payload.googleClientId === 'string') {
    doc.googleClientId = payload.googleClientId.trim();
  }
  if (typeof payload.googleClientSecret === 'string') {
    const trimmed = payload.googleClientSecret.trim();
    if (trimmed && !trimmed.startsWith('•')) {
      doc.googleClientSecret = trimmed;
    }
  }
  if (typeof payload.googleAdsDeveloperToken === 'string') {
    doc.googleAdsDeveloperToken = payload.googleAdsDeveloperToken.trim();
  }
  if (typeof payload.googleAdsApiVersion === 'string' && payload.googleAdsApiVersion.trim()) {
    doc.googleAdsApiVersion = payload.googleAdsApiVersion.trim();
  }

  if (typeof payload.adsCrmOrigin === 'string' && payload.adsCrmOrigin.trim()) {
    doc.adsCrmOrigin = payload.adsCrmOrigin.trim().replace(/\/+$/, '');
  }
  if (typeof payload.adsPublicApiOrigin === 'string' && payload.adsPublicApiOrigin.trim()) {
    doc.adsPublicApiOrigin = payload.adsPublicApiOrigin.trim().replace(/\/+$/, '');
  }

  if (!doc.adsIntegrationEncryptionKey) {
    doc.adsIntegrationEncryptionKey = process.env.ADS_INTEGRATION_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
  }

  if (userId) {
    doc.updatedBy = userId;
  }

  await doc.save();
  cachedConfig = doc.toObject();

  if (cachedConfig.adsIntegrationEncryptionKey) {
    process.env.ADS_INTEGRATION_ENCRYPTION_KEY = cachedConfig.adsIntegrationEncryptionKey;
  }

  return getPublicConfig();
}

function getMetaAppId() {
  const conf = getConfigSync();
  return conf.metaAppId || process.env.META_APP_ID || '';
}

function getMetaAppSecret() {
  const conf = getConfigSync();
  return conf.metaAppSecret || process.env.META_APP_SECRET || '';
}

function getMetaWebhookVerifyToken() {
  const conf = getConfigSync();
  return conf.metaWebhookVerifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN || 'ciis_meta_verify_token_2026_secure';
}

function getMetaGraphApiVersion() {
  const conf = getConfigSync();
  return conf.metaGraphApiVersion || process.env.META_GRAPH_API_VERSION || 'v26.0';
}

function getGoogleClientId() {
  const conf = getConfigSync();
  return conf.googleClientId || process.env.GOOGLE_CLIENT_ID || '';
}

function getGoogleClientSecret() {
  const conf = getConfigSync();
  return conf.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
}

function getGoogleAdsDeveloperToken() {
  const conf = getConfigSync();
  return conf.googleAdsDeveloperToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
}

function getGoogleAdsApiVersion() {
  const conf = getConfigSync();
  return conf.googleAdsApiVersion || process.env.GOOGLE_ADS_API_VERSION || 'v26';
}

function getAdsCrmOrigin() {
  const conf = getConfigSync();
  return conf.adsCrmOrigin || process.env.ADS_CRM_ORIGIN || process.env.BASE_URL || 'https://cds.ciisnetwork.in';
}

function getAdsPublicApiOrigin() {
  const conf = getConfigSync();
  return conf.adsPublicApiOrigin || process.env.ADS_PUBLIC_API_ORIGIN || 'https://backendcds.ciisnetwork.in';
}

function getMetaRedirectUri() {
  return `${getAdsPublicApiOrigin()}/api/crm/marketing-ads/oauth/meta/callback`;
}

function getGoogleRedirectUri() {
  return `${getAdsPublicApiOrigin()}/api/crm/marketing-ads/oauth/google/callback`;
}

function getEncryptionKey() {
  const conf = getConfigSync();
  return conf.adsIntegrationEncryptionKey || process.env.ADS_INTEGRATION_ENCRYPTION_KEY || '';
}

module.exports = {
  init,
  loadConfig,
  getConfigSync,
  getPublicConfig,
  updateConfig,
  getMetaAppId,
  getMetaAppSecret,
  getMetaWebhookVerifyToken,
  getMetaGraphApiVersion,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleAdsDeveloperToken,
  getGoogleAdsApiVersion,
  getAdsCrmOrigin,
  getAdsPublicApiOrigin,
  getMetaRedirectUri,
  getGoogleRedirectUri,
  getEncryptionKey
};
