const path = require('path');
const dotenv = require('dotenv');

// Ensure .env is loaded
if (!process.env.GROQ_API_KEY) {
  try {
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  } catch {}
}

const keyCooldowns = new Map(); // key -> cooldownExpiryTimestamp

/**
 * Returns an array of configured Groq API keys in priority order.
 * Primary: GROQ_API_KEY
 * Secondary: GROQ_API_KEY_SECONDARY
 */
function getGroqApiKeys() {
  const keys = [];
  const primary = (process.env.GROQ_API_KEY || '').trim();
  const secondary = (process.env.GROQ_API_KEY_SECONDARY || '').trim();

  if (primary) keys.push(primary);
  if (secondary && secondary !== primary) keys.push(secondary);

  // Also support comma-separated GROQ_API_KEYS if ever provided
  if (process.env.GROQ_API_KEYS) {
    const extras = process.env.GROQ_API_KEYS.split(',')
      .map(k => k.trim())
      .filter(k => k && !keys.includes(k));
    keys.push(...extras);
  }

  return keys;
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
function getOrderedKeys() {
  const allKeys = getGroqApiKeys();
  if (allKeys.length === 0) return [];

  const now = Date.now();
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
 *
 * @param {Function} operation - async (apiKey) => result
 * @returns {Promise<any>}
 */
async function executeWithGroqFallback(operation) {
  const keys = getOrderedKeys();
  if (keys.length === 0) {
    throw new Error('No GROQ_API_KEY configured.');
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
  isKeyRotationError,
  reportKeyFailure,
  reportKeySuccess,
  executeWithGroqFallback
};

