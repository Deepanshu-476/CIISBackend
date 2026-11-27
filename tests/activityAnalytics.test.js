const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog } = require('../tools/api-test-lab/lib/sweep');
const { aiAndAnalyticsFlow } = require('../tools/api-test-lab/lib/flows/aiAndAnalytics');
const { extrasFlow } = require('../tools/api-test-lab/lib/flows/extras');

test('api-test-lab discovers routes and registers new flows cleanly', () => {
  assert.equal(typeof aiAndAnalyticsFlow, 'function');
  assert.equal(typeof extrasFlow, 'function');
  const routes = catalog();
  assert.ok(routes.length > 800, `Expected >800 routes, got ${routes.length}`);
  assert.ok(routes.some(r => r.path === '/api/activity/summary'));
  assert.ok(routes.some(r => r.path === '/api/ai/task-agent/entitlement'));
  assert.ok(routes.some(r => r.path === '/api/breaks/today'));
  assert.ok(routes.some(r => r.path === '/api/week-off/my-schedule'));
  assert.ok(routes.some(r => r.path === '/api/client-plans'));
  assert.ok(routes.some(r => r.path === '/api/crm/marketing-ads/accounts'));
});
