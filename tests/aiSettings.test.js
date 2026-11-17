const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const groqKeyManager = require('../services/ai/groqKeyManager');

describe('Dynamic AI Key Management & GroqKeyManager Tests', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_env_primary_key_111';
    process.env.GROQ_API_KEY_SECONDARY = 'gsk_env_secondary_key_222';
  });

  it('1. Mask helper formats keys safely', () => {
    const mask = (key) => {
      if (!key || typeof key !== 'string') return '';
      const trimmed = key.trim();
      if (trimmed.length <= 8) return '********';
      return trimmed.slice(0, 6) + '...' + trimmed.slice(-4);
    };

    assert.equal(mask('gsk_abcdef1234567890'), 'gsk_ab...7890');
    assert.equal(mask('short'), '********');
    assert.equal(mask(''), '');
  });

  it('2. Fallback to .env when dynamic database cache is empty', () => {
    // getGroqApiKeys should return .env keys when no DB keys cached
    const keys = groqKeyManager.getGroqApiKeys();
    assert.ok(keys.length >= 2, 'Should have at least 2 keys from .env');
    assert.equal(keys[0], 'gsk_env_primary_key_111');
    assert.equal(keys[1], 'gsk_env_secondary_key_222');
  });

  it('3. Key Rotation Error detection identifies 429 and rate limit messages', () => {
    const err429 = { status: 429, message: 'Too Many Requests' };
    assert.equal(groqKeyManager.isKeyRotationError(err429), true);

    const errQuota = { message: 'Rate limit reached on TPM' };
    assert.equal(groqKeyManager.isKeyRotationError(errQuota), true);

    const errParam = { status: 400, message: 'Invalid parameter field' };
    assert.equal(groqKeyManager.isKeyRotationError(errParam), false);
  });

  it('4. Zero-downtime execution: executeWithGroqFallback uses active key', async () => {
    let executedWithKey = null;
    const testOp = async (key) => {
      executedWithKey = key;
      return { success: true };
    };

    const res = await groqKeyManager.executeWithGroqFallback(testOp);
    assert.equal(res.success, true);
    assert.ok(executedWithKey && executedWithKey.startsWith('gsk_'));
  });

  it('5. BYOK Client Key Mode: strictly executes with client key and never falls back to platform key', async () => {
    let executedWithKey = null;
    const testOp = async (key) => {
      executedWithKey = key;
      return { success: true };
    };

    const res = await groqKeyManager.executeWithGroqFallback(testOp, {
      customApiKey: 'gsk_client_tenant_key_999',
      strictCustomOnly: true,
    });

    assert.equal(res.success, true);
    assert.equal(executedWithKey, 'gsk_client_tenant_key_999', 'Must use client key');
  });

  it('6. BYOK Client Key Mode: throws BYOK_KEY_MISSING if strictCustomOnly and key is empty', async () => {
    const testOp = async () => ({ success: true });

    await assert.rejects(
      async () => {
        await groqKeyManager.executeWithGroqFallback(testOp, {
          customApiKey: '',
          strictCustomOnly: true,
        });
      },
      (err) => {
        assert.equal(err.code, 'BYOK_KEY_MISSING');
        return true;
      }
    );
  });
});
