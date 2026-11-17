const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'local-plan-lifecycle-test-secret';
process.env.DISABLE_SCHEDULED_JOBS = 'true';
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const {MongoMemoryReplSet} = require('mongodb-memory-server');
const Company = require('../models/Company');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Branch = require('../models/Branch');
const emailService = require('../services/emailService');
emailService.sendCompanyRegistrationEmails = async () => ({success: true});
require('../services/emailSettingsService').getLoginSettings = async () => ({companyLoginOtpEnabled: false, superAdminLoginOtpEnabled: false});
const auth = require('../middleware/authMiddleware');
const authController = require('../controllers/authController');
const {subscriptionState, companyDetails, isReadOnlyRequest} = require('../utils/companySubscription');
const subscriptionSocket = require('../middleware/subscriptionSocket');
let db, server, origin, platformToken, companyToken, companyId, planId, ownerId;
const payload = {name: 'Lifecycle Premium', price: 499, durationDays: 30, features: ['Attendance', 'Projects'], allowedPages: ['user-dashboard', 'attendance', 'projects'], allowedSuperAdminPages: ['company-details', 'create-user']};

const request = async (path, method = 'GET', body, token) => {
  const response = await fetch(origin + path, {
    method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  return {status: response.status, body: await response.json()};
};
test.before(async () => {
  db = await MongoMemoryReplSet.create({replSet: {count: 1}, instanceOpts: [{port: 20000 + process.pid % 20000}]});
  await mongoose.connect(db.getUri());
  await Promise.all([Company, User, Plan, Branch].map(model => model.init()));
  const platformCompany = await Company.create({companyName: 'Platform Test Company', companyEmail: 'platform@example.com', companyAddress: 'Local', companyPhone: '9876543211', ownerName: 'Platform Owner', companyCode: 'PLATFORM', dbIdentifier: 'platform-test', subscriptionExpiry: new Date(Date.now() - 3 * 86400000)});
  const platform = await User.create({name: 'Platform Owner', email: 'ashutoshrai130@gmail.com', password: 'TestPassword123', department: 'Management', jobRole: 'super_admin', companyRole: 'Owner', company: platformCompany._id, companyCode: 'PLATFORM'});
  platformToken = jwt.sign({id: String(platform._id)}, process.env.JWT_SECRET);
  const app = express(); app.use(express.json());
  app.use('/api/plans', require('../routes/planRoutes'));
  app.use('/api/company', require('../routes/companyRoutes'));
  app.use('/api/sidebar', require('../routes/sidebarConfigs'));
  app.post('/api/auth/company/:companyCode/login', authController.companyLogin);
  app.post('/api/auth/login', authController.login);
  app.all('/api/test-action', auth.protect, (req, res) => res.json({success: true}));
  server = await new Promise(resolve => {const listening = app.listen(0, '127.0.0.1', () => resolve(listening));});
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (db) await db.stop();
});

test('expiry boundary is the end of the IST date and view/session requests stay available', () => {
  const company = {subscriptionExpiry: '2026-11-17T00:00:00Z', allowedPages: ['projects']};
  assert.equal(subscriptionState(company, new Date('2026-11-17T18:29:59.999Z')).expired, false);
  assert.equal(subscriptionState(company, new Date('2026-11-17T18:30:00Z')).readOnly, true);
  assert.deepEqual(companyDetails(company).allowedPages, ['projects']);
  assert.equal(isReadOnlyRequest({method: 'GET', originalUrl: '/api/projects'}), true);
  assert.equal(isReadOnlyRequest({method: 'POST', originalUrl: '/api/auth/logout'}), true);
  assert.equal(isReadOnlyRequest({method: 'POST', originalUrl: '/api/chat/messages/delivered'}), true);
  assert.equal(isReadOnlyRequest({method: 'POST', originalUrl: '/api/projects'}), false);
});

test('platform creates a plan and public registration copies its actual entitlements', async () => {
  let response = await request('/api/plans', 'POST', {...payload, durationDays: 1.5}, platformToken);
  assert.equal(response.status, 400);
  response = await request('/api/plans', 'POST', payload, platformToken);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  planId = response.body.plan._id;
  const listed = await request('/api/plans');
  assert.equal(listed.body.plans[0]._id, planId);
  response = await request('/api/company', 'POST', {
    companyName: 'Lifecycle Test Company', companyEmail: 'plans@example.com', companyAddress: 'Local Test Address',
    companyPhone: '9876543210', ownerName: 'Test Owner', ownerEmail: 'owner@example.com', ownerPassword: 'TestPassword123', planId,
    allowedPages: ['all'], subscriptionPlan: 'Forged plan', subscriptionAmount: 0,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  companyId = response.body.company.id; ownerId = response.body.owner.id;
  companyToken = jwt.sign({id: ownerId}, process.env.JWT_SECRET);
  const current = await request('/api/company/subscription/current', 'GET', undefined, companyToken);
  assert.equal(current.body.company.subscriptionPlan, payload.name);
  assert.equal(current.body.company.subscriptionAmount, payload.price);
  assert.equal(current.body.company.planDurationDays, payload.durationDays);
  assert.deepEqual(current.body.company.allowedPages, payload.allowedPages);
  assert.deepEqual(current.body.company.allowedSuperAdminPages, payload.allowedSuperAdminPages);
  assert.deepEqual(current.body.company.planFeatures, payload.features);
  assert.equal(current.body.company.subscription.readOnly, false);
  const company = await Company.findById(companyId);
  assert.ok(Math.abs(new Date(company.subscriptionExpiry) - new Date(company.createdAt) - 30 * 86400000) < 5000);
});

test('a company owner with super_admin jobRole cannot create, modify or assign platform plans', async () => {
  for (const [path, method, body] of [
    ['/api/plans', 'POST', {...payload, name: 'Unauthorized'}],
    [`/api/plans/${planId}`, 'PUT', {...payload, price: 0}],
    [`/api/plans/${planId}/status`, 'PATCH', {isActive: false}],
    [`/api/company/${companyId}/subscription`, 'PATCH', {subscriptionExpiry: '2099-01-01', planId}],
  ]) {
    assert.equal((await request(path, method, body, companyToken)).status, 403, path);
  }
  assert.equal((await request('/api/plans?includeInactive=true', 'GET', undefined, companyToken)).status, 403);
  // A stale token must not hang the public catalog endpoint.
  assert.equal((await request('/api/plans', 'GET', undefined, 'invalid-token')).status, 200);
});

test('expiry applies to an already logged-in session: viewing works, every mutation is denied', async () => {
  assert.equal((await request('/api/test-action', 'POST', {}, companyToken)).status, 200);
  await Company.updateOne({_id: companyId}, {$set: {subscriptionExpiry: new Date(Date.now() - 2 * 86400000)}});
  assert.equal((await request('/api/test-action', 'GET', undefined, companyToken)).status, 200);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await request('/api/test-action', method, {}, companyToken);
    assert.equal(response.status, 403);
    assert.equal(response.body.errorCode, 'SUBSCRIPTION_EXPIRED');
  }
  const current = await request('/api/company/subscription/current', 'GET', undefined, companyToken);
  assert.equal(current.body.company.subscription.readOnly, true);
  assert.deepEqual(current.body.company.allowedPages, payload.allowedPages);
  await require('../models/SidebarConfig').collection.insertOne({
    companyId: new mongoose.Types.ObjectId(companyId), departmentId: new mongoose.Types.ObjectId(), role: 'user', isActive: true,
    menuItems: [
      {id: 'projects', name: 'Projects', icon: 'Folder', path: '/ciisUser/projects'},
      {id: 'chat', name: 'Chat', icon: 'Message', path: '/ciisUser/chat'},
    ],
  });
  const sidebar = await request(`/api/sidebar?companyId=${companyId}`, 'GET', undefined, companyToken);
  assert.equal(sidebar.status, 200);
  assert.deepEqual(sidebar.body.data[0].menuItems.map(item => item.id), ['projects']);
  assert.equal((await request('/api/plans', 'GET', undefined, companyToken)).body.plans.length, 1);
  const company = await Company.findById(companyId);
  const login = await request(`/api/auth/company/${company.companyCode}/login`, 'POST', {email: 'owner@example.com', password: 'TestPassword123', companyCode: company.companyCode});
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.token);
  assert.equal(login.body.companyDetails.subscription.readOnly, true);
  assert.equal(login.body.companyDetails.subscriptionPlan, payload.name);
  assert.deepEqual(login.body.companyDetails.allowedPages, payload.allowedPages);
  const standard = await request('/api/auth/login', 'POST', {email: 'owner@example.com', password: 'TestPassword123', companyCode: company.companyCode});
  assert.equal(standard.status, 200, JSON.stringify(standard.body));
});

test('socket mutations are denied while viewing packets are allowed, including an existing connection', async () => {
  const emitted = [], acknowledgements = [];
  let dispatched = 0;
  const socket = {companyId, user: {email: 'owner@example.com', jobRole: 'super_admin'}, emit: (...args) => emitted.push(args)};
  const guard = subscriptionSocket(socket);
  await guard(['chat:send-message', {}, value => acknowledgements.push(value)], () => {dispatched++;});
  await guard(['call:invite', {}], () => {dispatched++;});
  assert.equal(dispatched, 0);
  assert.equal(emitted.length, 2);
  assert.equal(acknowledgements[0].errorCode, 'SUBSCRIPTION_EXPIRED');
  await guard(['chat:join-conversation', {}], () => {dispatched++;});
  assert.equal(dispatched, 1);
});

test('platform renewal copies new plan access and unlocks the same session without activating disabled employees', async () => {
  const disabled = await User.create({name: 'Disabled Employee', email: 'disabled@example.com', password: 'TestPassword123', department: 'Test', jobRole: 'user', company: companyId, companyCode: (await Company.findById(companyId)).companyCode, isActive: false});
  const changed = {...payload, name: 'Lifecycle Pro', durationDays: 60, price: 999, allowedPages: ['user-dashboard', 'chat'], features: ['Team chat']};
  const newPlan = await request('/api/plans', 'POST', changed, platformToken);
  const start = new Date().toISOString().slice(0, 10);
  const renewal = await request(`/api/company/${companyId}/subscription`, 'PATCH', {
    planId: newPlan.body.plan._id, subscriptionStartDate: start, subscriptionExpiry: '2099-01-01', amount: 1,
  }, platformToken);
  assert.equal(renewal.status, 200, JSON.stringify(renewal.body));
  assert.equal(renewal.body.company.subscriptionAmount, 999);
  assert.equal(renewal.body.company.planDurationDays, 60);
  assert.deepEqual(renewal.body.company.allowedPages, changed.allowedPages);
  assert.equal(new Date(renewal.body.company.subscriptionExpiry).getTime(), require('../HR-CDS/utils/subscriptionDates').endOfIstDay(new Date(new Date(start).getTime() + 60 * 86400000)).getTime());
  assert.equal((await User.findById(disabled._id)).isActive, false);
  assert.equal((await request('/api/test-action', 'POST', {}, companyToken)).status, 200);
  const sidebar = await request(`/api/sidebar?companyId=${companyId}`, 'GET', undefined, companyToken);
  assert.deepEqual(sidebar.body.data[0].menuItems.map(item => item.id), ['chat']);
  const company = await Company.findById(companyId);
  assert.equal(company.subscriptionPayments.length, 2);
});

test('inactive plans cannot be registered or assigned and are hidden from the renewal catalog', async () => {
  assert.equal((await request(`/api/plans/${planId}/status`, 'PATCH', {isActive: false}, platformToken)).status, 200);
  const catalog = await request('/api/plans');
  assert.equal(catalog.body.plans.some(plan => plan._id === planId), false);
  const adminCatalog = await request('/api/plans?includeInactive=true', 'GET', undefined, platformToken);
  assert.equal(adminCatalog.body.plans.length, 2);
  const renewal = await request(`/api/company/${companyId}/subscription`, 'PATCH', {planId, subscriptionStartDate: '2026-11-17', subscriptionExpiry: '2026-12-17'}, platformToken);
  assert.equal(renewal.status, 404);
});
