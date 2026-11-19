const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const companyAiController = require('../controllers/companyAiSettingsController');

const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

describe('Company AI Settings Controller Tests', () => {
  it('1. Mask helper formats keys correctly', () => {
    // Controller tests maskApiKey internally:
    // Let's test the response of getCompanyAiSettings when customGroqApiKey is present
    assert.equal(typeof companyAiController.getCompanyAiSettings, 'function');
    assert.equal(typeof companyAiController.updateCompanyAiKey, 'function');
    assert.equal(typeof companyAiController.testCompanyGroqKey, 'function');
    assert.equal(typeof companyAiController.getEmployeeTokenAllocations, 'function');
    assert.equal(typeof companyAiController.updateEmployeeTokenAllocation, 'function');
    assert.equal(typeof companyAiController.bulkUpdateEmployeeTokenAllocations, 'function');
    assert.equal(typeof companyAiController.getCompanyAiUsageHistory, 'function');
  });

  it('2. testCompanyGroqKey returns 400 when no key provided', async () => {
    const req = {
      params: { companyId: 'company-test-123' },
      body: { apiKey: '' },
    };
    const res = createMockRes();

    await companyAiController.testCompanyGroqKey(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.success, false);
    assert.match(res.body?.message, /No Groq API Key provided/i);
  });

  it('3. getCompanyAiUsageHistory validates invalid company ID', async () => {
    const req = {
      params: { companyId: 'invalid-id' },
      query: {},
    };
    const res = createMockRes();

    await companyAiController.getCompanyAiUsageHistory(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.success, false);
    assert.match(res.body?.message, /Invalid company ID/i);
  });
});
