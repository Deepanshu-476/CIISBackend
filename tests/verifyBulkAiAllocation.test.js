const assert = require('assert');
const { describe, it } = require('node:test');
const companyAiController = require('../controllers/companyAiSettingsController');
const User = require('../models/User');

describe('CIIS AI Bulk Token Allocation & Access Tests', () => {
  it('returns 400 when no userIds are provided', async () => {
    const req = {
      params: { companyId: 'comp1' },
      body: { userIds: [], updates: { enabled: false } },
    };
    let statusCode = null;
    let responseData = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        responseData = data;
        return res;
      },
    };

    await companyAiController.bulkUpdateEmployeeTokenAllocations(req, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);
    assert.strictEqual(responseData.message, 'No employees specified');
  });

  it('updates fields properly on valid bulk payload', async () => {
    // Mock User.updateMany
    let capturedFilter = null;
    let capturedSet = null;
    const origUpdateMany = User.updateMany;
    User.updateMany = async (filter, update) => {
      capturedFilter = filter;
      capturedSet = update;
      return { acknowledged: true, modifiedCount: 3 };
    };

    try {
      const req = {
        params: { companyId: 'comp1' },
        body: {
          userIds: ['user1', 'user2', 'user3'],
          updates: { enabled: false, customDailyTokenLimit: 20000 },
        },
      };
      let statusCode = null;
      let responseData = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          responseData = data;
          return res;
        },
      };

      await companyAiController.bulkUpdateEmployeeTokenAllocations(req, res);
      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseData.success, true);
      assert.strictEqual(capturedFilter.company, 'comp1');
      assert.deepStrictEqual(capturedFilter._id.$in, ['user1', 'user2', 'user3']);
      assert.strictEqual(capturedSet.$set['aiConfig.enabled'], false);
      assert.strictEqual(capturedSet.$set['aiConfig.customDailyTokenLimit'], 20000);
    } finally {
      User.updateMany = origUpdateMany;
    }
  });

  it('handles bulk enable correctly', async () => {
    let capturedSet = null;
    const origUpdateMany = User.updateMany;
    User.updateMany = async (filter, update) => {
      capturedSet = update;
      return { acknowledged: true, modifiedCount: 2 };
    };

    try {
      const req = {
        params: { companyId: 'comp1' },
        body: {
          userIds: ['user4', 'user5'],
          updates: { enabled: true },
        },
      };
      let statusCode = null;
      let responseData = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          responseData = data;
          return res;
        },
      };

      await companyAiController.bulkUpdateEmployeeTokenAllocations(req, res);
      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseData.success, true);
      assert.strictEqual(capturedSet.$set['aiConfig.enabled'], true);
    } finally {
      User.updateMany = origUpdateMany;
    }
  });
});
