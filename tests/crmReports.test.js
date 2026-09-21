const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const controller = require('../controllers/crmReportController');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');

const company = new mongoose.Types.ObjectId();
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('CRM reports overview returns live counts and calculated conversion rate', async () => {
  const originals = { leadCount: Lead.countDocuments, callCount: CallLog.countDocuments, followCount: FollowUp.countDocuments };
  Lead.countDocuments = async filter => filter.status === 'converted' ? 2 : filter.assignedTo ? 6 : 10;
  CallLog.countDocuments = async () => 7;
  FollowUp.countDocuments = async () => 3;
  try {
    const res = response();
    await controller.report({ params: { type: 'overview' }, query: {}, crmCompany: company }, res, error => { throw error; });
    assert.equal(res.body.summary.find(item => item.label === 'Total Leads').value, 10);
    assert.equal(res.body.rows.find(item => item.Metric === 'Conversion Rate').Value, '20.0%');
  } finally {
    Lead.countDocuments = originals.leadCount; CallLog.countDocuments = originals.callCount; FollowUp.countDocuments = originals.followCount;
  }
});

test('visits report is an honest empty live report while Field Marketing is disabled', async () => {
  const res = response();
  await controller.report({ params: { type: 'visits' }, query: {}, crmCompany: company }, res, error => { throw error; });
  assert.equal(res.body.rows.length, 0);
  assert.match(res.body.message, /disabled/i);
});

test('reports reject unknown types and invalid date ranges', async () => {
  const unknown = response();
  await controller.report({ params: { type: 'unknown' }, query: {}, crmCompany: company }, unknown, error => { throw error; });
  assert.equal(unknown.code, 404);
  await assert.rejects(() => controller.report({ params: { type: 'overview' }, query: { from: '2026-09-22', to: '2026-09-20' }, crmCompany: company }, response(), error => { throw error; }), /valid report date range/);
});
