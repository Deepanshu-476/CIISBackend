const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'global',
      unique: true,
      index: true
    },
    metaAppId: { type: String, trim: true, default: '' },
    metaAppSecret: { type: String, trim: true, default: '' },
    metaWebhookVerifyToken: { type: String, trim: true, default: 'ciis_meta_verify_token_2026_secure' },
    metaGraphApiVersion: { type: String, trim: true, default: 'v26.0' },

    googleClientId: { type: String, trim: true, default: '' },
    googleClientSecret: { type: String, trim: true, default: '' },
    googleAdsDeveloperToken: { type: String, trim: true, default: '' },
    googleAdsApiVersion: { type: String, trim: true, default: 'v26' },

    adsCrmOrigin: { type: String, trim: true, default: '' },
    adsPublicApiOrigin: { type: String, trim: true, default: '' },
    adsIntegrationEncryptionKey: { type: String, trim: true, default: '' },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlatformAdsConfig', schema);
