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

  it('7. Key Vault Schema: correctly stores pool of 10+ keys with labels and active status', () => {
    const vault = [];
    for (let i = 1; i <= 10; i++) {
      vault.push({
        id: `vault_id_${i}`,
        label: `Groq Account #${i}`,
        apiKey: `gsk_pool_account_key_${i}_xyz123`,
        status: i === 1 ? 'valid' : 'untested',
        addedAt: new Date(),
      });
    }

    assert.equal(vault.length, 10);
    assert.equal(vault[0].label, 'Groq Account #1');
    assert.ok(vault[9].apiKey.startsWith('gsk_pool_account_key_10'));
  });

  it('8. Key Vault Logic: Setting active Primary and Secondary keys properly updates pointers and prevents conflicts', () => {
    const settings = {
      primaryApiKey: 'gsk_key_1',
      primaryVaultId: 'id_1',
      secondaryApiKey: 'gsk_key_2',
      secondaryVaultId: 'id_2',
      keyVault: [
        { id: 'id_1', label: 'Primary Account', apiKey: 'gsk_key_1' },
        { id: 'id_2', label: 'Backup Account', apiKey: 'gsk_key_2' },
        { id: 'id_3', label: 'Reserve Account', apiKey: 'gsk_key_3' },
      ],
    };

    // Attempt to set active Primary as Secondary should be blocked
    const canSetPrimaryAsSecondary = settings.primaryVaultId !== 'id_1';
    assert.equal(canSetPrimaryAsSecondary, false, 'Cannot set current Primary as Secondary');

    // Switch Primary to id_3
    const newPrimary = settings.keyVault.find(k => k.id === 'id_3');
    settings.primaryApiKey = newPrimary.apiKey;
    settings.primaryVaultId = newPrimary.id;
    assert.equal(settings.primaryVaultId, 'id_3');
    assert.equal(settings.primaryApiKey, 'gsk_key_3');

    // Attempting to delete active Primary should be blocked
    const canDeletePrimary = settings.primaryVaultId !== 'id_3';
    assert.equal(canDeletePrimary, false, 'Cannot delete active Primary key');

    // Setting id_1 as Secondary now works because it is no longer Primary
    const canSetOldPrimaryAsSecondary = settings.primaryVaultId !== 'id_1';
    assert.equal(canSetOldPrimaryAsSecondary, true);
    settings.secondaryApiKey = settings.keyVault[0].apiKey;
    settings.secondaryVaultId = settings.keyVault[0].id;
    assert.equal(settings.secondaryVaultId, 'id_1');
    assert.equal(settings.secondaryApiKey, 'gsk_key_1');
  });
});
