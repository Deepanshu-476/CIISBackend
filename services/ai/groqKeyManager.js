const path = require('path');
const dotenv = require('dotenv');

try {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
} catch {}

const keyCooldowns = new Map(); // key -> cooldownExpiryTimestamp

let cachedSettingsKeys = null;
let cachedModel = null;
let cachedSttModel = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000;

/**
 * Refreshes active keys and models from MongoDB AiSettings.
 * Managed exclusively by Super Admin via the AI Management frontend.
 */
async function refreshKeyCache() {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const AiSettings = require('../../models/AiSettings');
      const doc = await AiSettings.findOne().lean();
      if (doc && doc.isEnabled !== false) {
        const keys = [];
        if (doc.primaryApiKey && String(doc.primaryApiKey).trim()) {
          keys.push(doc.primaryApiKey.trim());
        }
        if (
          doc.secondaryApiKey &&
          String(doc.secondaryApiKey).trim() &&
          doc.secondaryApiKey.trim() !== doc.primaryApiKey?.trim()
        ) {
          keys.push(doc.secondaryApiKey.trim());
        }
        cachedModel = doc.selectedModel || 'qwen/qwen3.8-27b';
        cachedSttModel = doc.selectedSttModel || 'whisper-large-v3-turbo';
        cachedSettingsKeys = keys;
        lastCacheTime = Date.now();
        return cachedSettingsKeys;
      }
    }
  } catch (err) {
    console.error('[groqKeyManager] Failed to refresh key cache from database:', err?.message);
  }
  cachedSettingsKeys = [];
  lastCacheTime = Date.now();
  return [];
}

function getActiveModelName() {
  return cachedModel || 'qwen/qwen3.8-27b';
}

function getActiveSttModelName() {
  return cachedSttModel || 'whisper-large-v3-turbo';
}

/**
 * Returns an array of configured Groq API keys strictly from database AiSettings.
 * Managed exclusively from Super Admin Frontend Key Vault.
 */
function getGroqApiKeys() {
  if (cachedSettingsKeys && cachedSettingsKeys.length > 0) {
    return [...cachedSettingsKeys];
  }
  return [];
}

function setCachedKeysForTesting(keys) {
  cachedSettingsKeys = Array.isArray(keys) ? [...keys] : [];
  lastCacheTime = Date.now();
}

/**
 * Checks if an error is a rate limit or quota/auth issue that should trigger key rotation.
 */
function isKeyRotationError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err.response?.status;
  const msg = String(err.message || err.response?.data?.error?.message || '').toLowerCase();

  // 429 = Rate Limit Exceeded (TPM or RPM reached)
  // 401 / 403 = Invalid key, quota depleted, or unauthorized
  if (status === 429 || status === 401 || status === 403) return true;
  if (/rate[_\s-]?limit|too many requests|tokens per minute|requests per minute|quota|unauthorized|invalid api key/i.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Marks a key as temporarily on cooldown (default: 60s for 429 rate limit).
 */
function reportKeyFailure(key, err) {
  if (!key) return;
  const now = Date.now();
  const cooldownDuration = (err?.status === 429 || err?.response?.status === 429) ? 60000 : 120000;
  keyCooldowns.set(key, now + cooldownDuration);
  const maskedKey = key.slice(0, 7) + '...' + key.slice(-4);
  console.warn(`[groqKeyManager] API Key ${maskedKey} put on temporary cooldown (${cooldownDuration / 1000}s) due to:`, err?.response?.data?.error?.message || err?.message);
}

/**
 * Marks a key as healthy and clears cooldown.
 */
function reportKeySuccess(key) {
  if (key && keyCooldowns.has(key)) {
    keyCooldowns.delete(key);
  }
}

/**
 * Returns available keys ordered with healthy keys first.
 */
async function getOrderedKeys() {
  const now = Date.now();
  if (now - lastCacheTime > CACHE_TTL_MS) {
    await refreshKeyCache().catch(() => {});
  }
  const allKeys = getGroqApiKeys();
  if (allKeys.length === 0) return [];

  const healthy = [];
  const cooling = [];

  for (const k of allKeys) {
    const expiry = keyCooldowns.get(k) || 0;
    if (now >= expiry) {
      healthy.push(k);
    } else {
      cooling.push(k);
    }
  }

  // Healthy first, followed by cooling down as last resort
  return [...healthy, ...cooling];
}

/**
 * Executes an operation with automatic fallback across configured Groq keys.
 * If the primary key hits a rate limit or auth error, it seamlessly jumps to the secondary key.
 * If a customApiKey is provided (BYOK mode), it strictly executes with that key and NEVER falls back to platform keys.
 *
 * @param {Function} operation - async (apiKey) => result
 * @param {Object|string} [options] - { customApiKey, strictCustomOnly } or customApiKey string
 * @returns {Promise<any>}
 */
async function executeWithGroqFallback(operation, options = {}) {
  const customApiKey = typeof options === 'string' ? options : options?.customApiKey;
  const strictCustomOnly = Boolean(options?.strictCustomOnly || (typeof options === 'string' && options));

  // If client-provided API key mode is active
  if (customApiKey && String(customApiKey).trim()) {
    const cleanKey = String(customApiKey).trim();
    try {
      const masked = cleanKey.slice(0, 7) + '...' + cleanKey.slice(-4);
      console.log(`[groqKeyManager] Executing with client custom Groq API key (${masked})`);
      return await operation(cleanKey);
    } catch (err) {
      console.error('[groqKeyManager] Error with client custom Groq API key:', err?.response?.data?.error?.message || err?.message);
      // Strict isolation: NEVER fall back to platform keys on BYOK failure
      throw err;
    }
  }

  if (strictCustomOnly) {
    const err = new Error('Company has selected User Own API Key mode, but Groq API key is not configured.');
    err.code = 'BYOK_KEY_MISSING';
    throw err;
  }

  const keys = await getOrderedKeys();
  if (keys.length === 0) {
    throw new Error('No Groq API Key configured. Please add and set an active Primary key in Super Admin AI Management.');
  }

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    try {
      const result = await operation(apiKey);
      reportKeySuccess(apiKey);
      return result;
    } catch (err) {
      lastError = err;
      if (isKeyRotationError(err) && i < keys.length - 1) {
        reportKeyFailure(apiKey, err);
        const nextMasked = keys[i + 1].slice(0, 7) + '...' + keys[i + 1].slice(-4);
        console.warn(`[groqKeyManager] Seamlessly failing over to next Groq API key (${nextMasked})...`);
        continue;
      }
      // If it's not a key rotation error (e.g. invalid parameter), don't retry other keys
      throw err;
    }
  }

  throw lastError;
}

module.exports = {
  getGroqApiKeys,
  getOrderedKeys,
  getActiveModelName,
  getActiveSttModelName,
  refreshKeyCache,
  setCachedKeysForTesting,
  isKeyRotationError,
  reportKeyFailure,
  reportKeySuccess,
  executeWithGroqFallback
};

