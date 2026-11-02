const test = require('node:test');
const assert = require('node:assert/strict');

test('authController.logout cleans up deviceToken when provided', async () => {
  let deletedQuery = null;
  const mockDevice = {
    deleteMany: async query => {
      deletedQuery = query;
      return {deletedCount: 1};
    },
  };

  // Mock require cache
  const originalRequire = require;
  const authController = require('../controllers/authController');

  const req = {
    body: {deviceToken: 'test-fcm-token-123'},
  };
  const cookiesCleared = [];
  const res = {
    clearCookie: name => cookiesCleared.push(name),
    status: code => ({
      json: data => ({code, data}),
    }),
  };

  // Temporarily stub Device in require cache
  const devicePath = require.resolve('../models/Device');
  require.cache[devicePath] = {
    id: devicePath,
    filename: devicePath,
    loaded: true,
    exports: mockDevice,
  };

  const response = await authController.logout(req, res);
  assert.deepEqual(deletedQuery, {deviceToken: 'test-fcm-token-123'});
  assert.equal(cookiesCleared.includes('auth_token'), true);
  assert.equal(response.data.success, true);
});
