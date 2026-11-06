const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const groqKeyManager = require('../services/ai/groqKeyManager');
const groqCrmHelper = require('../services/ai/groqCrmHelper');

test('Groq Key Manager: Detects primary and secondary API keys', () => {
  const keys = groqKeyManager.getGroqApiKeys();
  assert.ok(keys.length >= 2, `Expected at least 2 keys, got ${keys.length}`);
  assert.equal(keys[0], process.env.GROQ_API_KEY.trim(), 'First key must be primary GROQ_API_KEY');
  assert.equal(keys[1], process.env.GROQ_API_KEY_SECONDARY.trim(), 'Second key must be secondary GROQ_API_KEY_SECONDARY');
});

test('Groq Key Manager: Detects rate limit (429) and auth (401/403) errors', () => {
  assert.ok(groqKeyManager.isKeyRotationError({ status: 429 }), 'Status 429 must be rotation error');
  assert.ok(groqKeyManager.isKeyRotationError({ response: { status: 429 } }), 'response.status 429 must be rotation error');
  assert.ok(groqKeyManager.isKeyRotationError({ status: 401 }), 'Status 401 must be rotation error');
  assert.ok(groqKeyManager.isKeyRotationError({ message: 'Rate limit reached for requests per minute (RPM)' }), 'RPM message must trigger rotation');
  assert.ok(!groqKeyManager.isKeyRotationError({ status: 500 }), 'Status 500 should not trigger key rotation');
});

test('Groq Key Manager: executeWithGroqFallback automatically fails over to secondary key on 429', async () => {
  const primaryKey = process.env.GROQ_API_KEY.trim();
  const secondaryKey = process.env.GROQ_API_KEY_SECONDARY.trim();

  const attempts = [];
  const result = await groqKeyManager.executeWithGroqFallback(async (activeKey) => {
    attempts.push(activeKey);
    if (activeKey === primaryKey) {
      // Simulate primary key hitting 429 rate limit
      const err = new Error('Rate limit exceeded: TPM limit reached on primary');
      err.status = 429;
      throw err;
    }
    // Secondary key succeeds!
    return { success: true, answeredBy: activeKey, message: 'Response from secondary key' };
  });

  assert.equal(attempts.length, 2, 'Should attempt primary then secondary');
  assert.equal(attempts[0], primaryKey, 'First attempt must use primary');
  assert.equal(attempts[1], secondaryKey, 'Second attempt must use secondary');
  assert.equal(result.success, true, 'Result should succeed seamlessly');
  assert.equal(result.answeredBy, secondaryKey, 'Response generated using secondary key');
});

test('Groq CRM Helper: callGroq successfully executes with Groq API keys', async () => {
  const reply = await groqCrmHelper.callGroq({
    systemPrompt: 'You are a CRM assistant. Reply in exactly 2 words.',
    userMessage: 'Hello system',
    maxTokens: 10
  });

  assert.ok(reply && typeof reply === 'string', 'Should return a string reply from Groq');
  assert.ok(reply.trim().length > 0, 'Reply should not be empty');
  console.log('Live Groq call succeeded with response:', reply.trim());
});

test('Groq CRM Helper: answerWithGroqCRM handles general queries without error', async () => {
  const user = { name: 'Pankaj' };
  const reply = await groqCrmHelper.answerWithGroqCRM({
    message: 'hello who are you?',
    user,
    accessibleProjects: [{ projectName: 'ciis network' }],
    accessibleClients: [{ client: 'saniha', company: 'cds' }],
    language: 'en'
  });

  assert.ok(reply && typeof reply === 'string');
  assert.ok(reply.toLowerCase().includes('ciis') || reply.toLowerCase().includes('assistant') || reply.toLowerCase().includes('help'));
  console.log('answerWithGroqCRM live reply:', reply.trim());
});

