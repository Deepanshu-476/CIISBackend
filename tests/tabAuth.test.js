const assert = require('node:assert/strict');
const test = require('node:test');
const { scopeTabAuth } = require('../utils/tabAuth');
const authSocket = require('../middleware/authSocket');
const authController = require('../controllers/authController');

test('tab requests ignore legacy auth cookies and retain their own bearer token', () => {
  const req = {
    get: () => 'tab',
    headers: { authorization: 'Bearer tab-token' },
    cookies: {
      auth_token: 'other-account',
      access_token: 'other-account',
      refresh_token: 'other-account',
      token: 'other-account',
      preference: 'dark',
    },
  };
  const responseHeaders = {};
  let continued = false;
  scopeTabAuth(req, { set: (name, value) => { responseHeaders[name] = value; } }, () => { continued = true; });
  assert.equal(continued, true);
  assert.deepEqual(req.cookies, { preference: 'dark' });
  assert.equal(req.headers.authorization, 'Bearer tab-token');
  assert.equal(responseHeaders['Cache-Control'], 'private, no-store');
});

test('a tab socket without a token does not authenticate with a shared cookie', async () => {
  const socket = {
    handshake: { auth: { mode: 'tab' }, headers: { cookie: 'auth_token=other-account' } },
  };
  await authSocket(socket, error => {
    assert.equal(error?.message, 'Authentication token required');
  });
});

test('web tab logout leaves cookies alone while legacy logout clears them', async () => {
  for (const mode of ['tab', undefined]) {
    const cleared = [];
    const res = {
      clearCookie: name => cleared.push(name),
      status: code => ({ json: body => ({ code, body }) }),
    };
    const response = await authController.logout({ get: () => mode }, res);
    assert.equal(response.code, 200);
    assert.deepEqual(cleared, mode === 'tab' ? [] : ['auth_token', 'access_token', 'refresh_token']);
  }
});
