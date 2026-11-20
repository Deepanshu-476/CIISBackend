const assert = require('assert');
const { describe, it } = require('node:test');
const companyAiController = require('../controllers/companyAiSettingsController');

describe('CIIS AI Access & Visibility Tests', () => {
  it('allows privileged user (admin/owner) to access AI', async () => {
    const req = {
      user: {
        _id: '507f1f77bcf86cd799439011',
        name: 'Admin User',
        companyRole: 'admin',
        aiConfig: { enabled: false }, // Even if disabled flag somehow set, privileged bypasses
      },
      params: { companyId: 'comp1' },
    };
    let responseData = null;
    let statusCode = null;
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

    await companyAiController.getMyAiAccess(req, res);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.hasAccess, true);
    assert.strictEqual(responseData.isPrivileged, true);
  });

  it('denies client user from accessing AI', async () => {
    const req = {
      user: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Client User',
        companyRole: 'client',
      },
      params: { companyId: 'comp1' },
    };
    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
        return res;
      },
    };

    await companyAiController.getMyAiAccess(req, res);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.hasAccess, false);
    assert.strictEqual(responseData.isClient, true);
  });

  it('denies regular employee when aiConfig.enabled is false', async () => {
    const req = {
      user: {
        _id: '507f1f77bcf86cd799439013',
        name: 'Employee One',
        companyRole: 'employee',
        aiConfig: { enabled: false, customDailyTokenLimit: 10000 },
      },
      params: { companyId: 'comp1' },
    };
    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
        return res;
      },
    };

    await companyAiController.getMyAiAccess(req, res);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.hasAccess, false);
    assert.strictEqual(responseData.aiConfig.enabled, false);
  });

  it('denies regular employee when customDailyTokenLimit is 0', async () => {
    const req = {
      user: {
        _id: '507f1f77bcf86cd799439014',
        name: 'Employee Zero Tokens',
        companyRole: 'employee',
        aiConfig: { enabled: true, customDailyTokenLimit: 0 },
      },
      params: { companyId: 'comp1' },
    };
    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
        return res;
      },
    };

    await companyAiController.getMyAiAccess(req, res);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.hasAccess, false);
    assert.strictEqual(responseData.aiConfig.customDailyTokenLimit, 0);
  });

  it('allows regular employee when enabled is true and tokens > 0', async () => {
    const req = {
      user: {
        _id: '507f1f77bcf86cd799439015',
        name: 'Employee Active',
        companyRole: 'employee',
        aiConfig: { enabled: true, customDailyTokenLimit: 15000 },
      },
      params: { companyId: 'comp1' },
    };
    let responseData = null;
    const res = {
      status: () => res,
      json: (data) => {
        responseData = data;
        return res;
      },
    };

    await companyAiController.getMyAiAccess(req, res);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.hasAccess, true);
    assert.strictEqual(responseData.aiConfig.enabled, true);
  });
});
