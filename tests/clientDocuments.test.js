const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture() {
  const filename = require.resolve('../HR-CDS/routes/clientDocumentRoutes');
  const localRequire = createRequire(filename);
  const state = { client: { _id: 'linked-client', companyCode: 'CAREER' }, events: [], queries: [] };
  const overrides = {
    fs: { existsSync: () => true },
    '../models/Client': { findById: () => ({ lean: async () => state.client }) },
    '../models/ClientDocument': {
      find: () => ({ sort: () => ({ lean: async () => [] }) }),
      findById: () => ({ lean: async () => ({ _id: 'doc', client: 'linked-client', path: '/fixture.pdf' }) }),
    },
    '../models/ClientDocumentDownload': {
      countDocuments: async query => { state.queries.push(query); return 2; },
      create: async event => { state.events.push(event); },
    },
    '../../middleware/authMiddleware': { protect: (_req, _res, next) => next() },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), console, Buffer, Date,
    require: name => overrides[name] || localRequire(name),
  }, { filename });
  const request = async (routePath, user, downloadError = null) => {
    const route = module.exports.stack.find(layer => layer.route?.path === routePath && layer.route.methods.get).route;
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      download(_file, _name, callback) { callback(downloadError); },
    };
    await route.stack.at(-1).handle({ user, query: { clientId: 'linked-client' }, params: { id: 'doc' } }, response);
    return response;
  };
  return { state, request };
}

const user = { _id: 'user', companyRole: 'client', companyCode: 'CAREER', additionalDetails: JSON.stringify({ clientIds: ['linked-client'] }) };

test('linked client arrays allow document access and return real rolling download counts', async () => {
  const { request, state } = fixture();
  const response = await request('/', user);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.downloadsLast30Days, 2);
  assert.equal(state.queries[0].client, 'linked-client');
  assert.ok(Math.abs(state.queries[0].downloadedAt.$gte.getTime() - (Date.now() - 30 * 86400000)) < 1000);
});

test('unlinked clients and other companies remain denied', async () => {
  const { request } = fixture();
  assert.equal((await request('/', { ...user, additionalDetails: '{}' })).statusCode, 403);
  assert.equal((await request('/', { ...user, companyCode: 'OTHER' })).statusCode, 403);
});

test('count successful transfers only', async () => {
  const { request, state } = fixture();
  await request('/:id/download', user);
  assert.equal(state.events.length, 1);
  await request('/:id/download', user, new Error('Transfer failed'));
  assert.equal(state.events.length, 1);
});
