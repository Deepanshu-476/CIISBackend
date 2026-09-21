const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const mongoose = require('mongoose');
const company = '507f1f77bcf86cd799439010';

async function run(result, failure) {
  const module = { exports: {} };
  let pipeline;
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/leadOverviewController'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === 'mongoose') return mongoose;
      return { aggregate: async stages => {
        pipeline = stages;
        if (failure) throw failure;
        return [result];
      } };
    }
  });
  let body;
  let error;
  await module.exports.overview({ crmCompany: company }, { json(value) { body = value; } }, value => { error = value; });
  return { body, pipeline, error };
}

test('overview scopes aggregation to company and computes disjoint status totals', async () => {
  const key = new Date().toISOString().slice(0, 7);
  const { body, pipeline } = await run({ totals: [{ total: 10, assigned: 4 }],
    statuses: [{ _id: 'new', count: 5 }, { _id: 'converted', count: 2 }, { _id: 'interested', count: 2 }, { _id: null, count: 1 }],
    months: [{ _id: key, leads: 3, converted: 1 }], days: [{ _id: new Date().toISOString().slice(0, 10), leads: 2, converted: 1 }] });
  assert.equal(String(pipeline[0].$match.company), company);
  assert.ok(pipeline[0].$match.company instanceof mongoose.Types.ObjectId);
  assert.equal(body.metrics.total, 10);
  assert.equal(body.metrics.unassigned, 6);
  assert.equal(body.metrics.new, 5);
  assert.equal(body.metrics.interested, 2);
  assert.equal(body.metrics.conversionRate, 20);
  assert.equal(body.funnel.reduce((sum, item) => sum + item.value, 0), 10);
  assert.equal(body.trends.length, 6);
  assert.equal(body.trends[5].leads, 3);
  assert.equal(body.trends[5].converted, 1);
  assert.equal(body.trendsByRange['7D'].length, 7);
  assert.equal(body.trendsByRange['30D'].length, 30);
  assert.equal(body.trendsByRange['7D'][6].converted, 1);
  assert.equal(body.trendsByRange['30D'][29].leads, 2);
  assert.equal(pipeline[1].$facet.months[1].$group.converted.$sum.$cond[0].$eq[1], 'converted');
  assert.equal(pipeline[1].$facet.days[1].$group.converted.$sum.$cond[0].$eq[1], 'converted');
  assert.equal(body.trends[0].leads, 0);
});

test('empty company returns zero metrics and empty day/month buckets', async () => {
  const { body } = await run({ totals: [], statuses: [], months: [] });
  assert.ok(Object.values(body.metrics).every(value => value === 0));
  assert.ok(body.trends.every(item => item.leads === 0));
  assert.ok(body.funnel.every(item => item.value === 0));
  assert.ok(Object.values(body.trendsByRange).flat().every(item => item.leads === 0 && item.converted === 0));
});

test('database failures reach error middleware', async () => {
  const failure = new Error('Database unavailable');
  const { body, error } = await run(null, failure);
  assert.equal(error, failure);
  assert.equal(body, undefined);
});
