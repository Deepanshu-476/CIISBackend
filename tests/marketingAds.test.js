const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Lead = require('../models/Lead');
const Company = require('../models/Company');
const User = require('../models/User');
const Permission = require('../models/PagePermission');
const Integration = require('../models/AdIntegration');
const Delivery = require('../models/AdLeadWebhookLog');
const Session = require('../models/AdOAuthSession');
const History = require('../models/LeadAssignmentHistory');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const { normalize } = require('../services/marketingAds/normalize');
const { processNext } = require('../services/marketingAds/ingest');

const prefix = '/api/crm/marketing-ads';
const metaHook = '/api/integrations/meta/webhook';
const ids = Array.from({ length: 5 }, (_, index) => String(1000 + index));
const metaPages = ids.map(id => ({ id, name: `Page ${id}`, access_token: `test-page-${id}` }));
const googleIds = ids.map(id => `123456${id}`);
const json = body => Response.json(body);

test('normalization tolerates missing and malformed form fields', () => {
  const companyId = new mongoose.Types.ObjectId();
  const fields = normalize('meta', { field_data: [
    null, { name: 'FULL_NAME', values: [' Jane  Singh '] }, { name: 'email', values: ['not an email'] },
    { name: 'gender', values: ['constructor'] }, { name: 'preferred_budget', values: [' 5 lakh '] }
  ] }, { form_id: '55' }, {
    _id: companyId, mappings: [{ formId: '55', fields: [{ key: 'preferred_budget', label: 'Budget' }, { key: 'town', label: 'Town' }] }]
  });
  assert.equal(fields.name, 'Jane  Singh');
  assert.equal(fields.phone, '');
  assert.equal(fields.email, '');
  assert.equal(fields.gender, '');
  assert.deepEqual(fields.marketing.answers, [{ label: 'Budget', value: '5 lakh' }, { label: 'Town', value: '' }]);
});

test('OAuth, tenant routing, webhook validation, assignment, deduplication and retry', async t => {
  let mongo;
  let server;
  const realFetch = global.fetch;
  t.after(async () => {
    global.fetch = realFetch;
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await mongo?.stop();
  });
  mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Integration, Delivery, Session, Lead, History].map(model => model.init()));
  const app = express();
  app.use('/api/integrations', require('../routes/adWebhookRoutes'));
  app.use(express.json());
  app.use(prefix, require('../routes/marketingAdsRoutes'));
  app.use('/api/crm/leads', require('../routes/crmLeadRoutes'));
  app.use('/api/crm/telecaller', require('../routes/telecallerRoutes'));
  app.use('/api/calls', require('../routes/callRoutes'));
  app.use('/api/followups', require('../routes/followUpRoutes'));
  app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    JWT_SECRET: randomBytes(24).toString('hex'),
    ADS_INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ADS_CRM_ORIGIN: origin, ADS_PUBLIC_API_ORIGIN: origin,
    META_APP_ID: '101', META_APP_SECRET: 'test-meta-secret', META_WEBHOOK_VERIFY_TOKEN: 'test-meta-verify',
    META_REDIRECT_URI: origin + prefix + '/oauth/meta/callback',
    GOOGLE_CLIENT_ID: 'test-google-id', GOOGLE_CLIENT_SECRET: 'test-google-secret',
    GOOGLE_REDIRECT_URI: origin + prefix + '/oauth/google/callback', GOOGLE_ADS_DEVELOPER_TOKEN: 'test-developer-token'
  });

  const notifications = require('../HR-CDS/utils/systemNotificationService');
  const notify = t.mock.method(notifications, 'notifyDirectUsers', async () => []);
  let failMeta = false;
  let revokeGoogle = false;
  global.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return realFetch(input, options);
    const path = url.pathname.split('/').slice(2).join('/');
    if (url.hostname === 'oauth2.googleapis.com') {
      if (revokeGoogle && options.body.get('grant_type') === 'refresh_token') {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return json({ access_token: 'test-google-access', refresh_token: 'test-google-refresh' });
    }
    if (url.hostname === 'googleads.googleapis.com') {
      if (path === 'customers:listAccessibleCustomers') return json({ resourceNames: googleIds.map(id => `customers/${id}`) });
      const id = path.split('/')[1];
      const { query } = JSON.parse(options.body);
      return json({ results: query.includes('FROM campaign')
        ? [{ campaign: { id: '900', name: 'Test campaign' } }]
        : [{ customer: { id, descriptiveName: `Account ${id}`, manager: false } }] });
    }
    assert.equal(url.hostname, 'graph.facebook.com');
    if (path === 'oauth/access_token') return json({ access_token: 'test-meta-access' });
    if (path === 'me/accounts') return json({ data: metaPages });
    if (path.endsWith('/leadgen_forms')) return json({ data: [{ id: '55', name: 'Form 55', questions: [{ key: 'budget' }] }] });
    if (path.endsWith('/subscribed_apps')) return json(options.method
      ? { success: true } : { data: [{ id: '101', subscribed_fields: ['leadgen'] }] });
    if (path === '888') {
      if (failMeta) return Response.json({ error: { code: 190 } }, { status: 400 });
      return json({ id: path, form_id: '55', platform: 'ig',
        field_data: [{ name: 'first_name', values: ['Asha'] }, { name: 'budget', values: ['50k'] }] });
    }
    assert.ok(ids.includes(path), path);
    return json({ business: { name: 'Business' }, instagram_business_account: { username: 'shop' } });
  };

  async function tenant(name) {
    const company = new mongoose.Types.ObjectId();
    const owner = new mongoose.Types.ObjectId();
    await Company.collection.insertOne({ _id: company, companyName: name, companyCode: name.toUpperCase(),
      companyEmail: `${name}@example.com`, companyPhone: name, dbIdentifier: name, loginUrl: `https://${name}.example.com`, allowedPages: ['crm'], isActive: true });
    await User.collection.insertOne({ _id: owner, company, name, email: `${name}@example.com`, employeeId: name,
      companyRole: 'owner', isActive: true });
    await Permission.create({ company, pageKey: 'admin-crm-lead-sources', name: 'Lead Sources',
      path: '/ciisUser/crm/admin/lead-sources', editUsers: [{ user: owner }] });
    return { company, owner, token: jwt.sign({ id: owner }, process.env.JWT_SECRET) };
  }

  const first = await tenant('first');
  const second = await tenant('second');
  const crm = (tenant, path, method = 'GET', body) => realFetch(origin + path, {
    method, redirect: 'manual', headers: { Authorization: `Bearer ${tenant.token}`, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) })
  });
  const api = (tenant, path, method, body) => crm(tenant, prefix + path, method, body);
  async function getJson(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }
  async function begin(tenant, platform, account) {
    const start = await getJson(await api(tenant, `/oauth/${platform}/start`, 'POST', { connectionId: account?._id }));
    const authUrl = new URL(start.url);
    const state = authUrl.searchParams.get('state');
    if (platform === 'google') assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    const path = `/oauth/${platform}/callback?state=${state}&code=test`;
    const callback = await api(tenant, path);
    assert.equal(callback.status, 302);
    const session = new URL(callback.headers.get('location')).searchParams.get('session');
    assert.ok(session);
    assert.equal(new URL((await api(tenant, path)).headers.get('location')).searchParams.get('oauth'), 'expired');
    return session;
  }
  async function connect(tenant, platform, accountId, account) {
    const session = await begin(tenant, platform, account);
    const assets = await getJson(await api(tenant, `/oauth/sessions/${session}`));
    assert.equal(assets.items.length, 5);
    const response = await api(tenant, `/oauth/sessions/${session}/save`, 'POST', { accountId, formIds: ['55'] });
    const { item } = await getJson(response);
    assert.equal(item.credentials, undefined);
    assert.equal(item.webhookKey, undefined);
    return item;
  }

  const meta = [];
  const google = [];
  for (let i = 0; i < 5; i++) {
    meta.push(await connect(first, 'meta', ids[i]));
    google.push(await connect(first, 'google', googleIds[i]));
  }
  const session = await begin(second, 'meta');
  const denied = await api(first, `/oauth/sessions/${session}`);
  assert.equal(denied.status, 404);
  assert.equal((await api(second, `/oauth/sessions/${session}/save`, 'POST', { accountId: ids[0], formIds: ['55'] })).status, 409);
  assert.equal((await getJson(await api(first, '/accounts'))).items.length, 10);
  assert.equal((await getJson(await api(second, '/accounts'))).items.length, 0);
  assert.equal((await api(second, `/accounts/${google[0]._id}/webhook`)).status, 404);
  assert.equal((await api(first, `/accounts/${meta[0]._id}/test`, 'POST')).status, 200);
  assert.equal((await api(first, `/accounts/${google[0]._id}/test`, 'POST')).status, 200);

  const foreign = await connect(second, 'google', googleIds[0]);
  const localHook = await getJson(await api(first, `/accounts/${google[0]._id}/webhook`));
  const foreignHook = await getJson(await api(second, `/accounts/${foreign._id}/webhook`));
  assert.notEqual(localHook.key, foreignHook.key);
  const settings = { assignedTo: String(first.owner), leadStatus: 'interested',
    mappings: [{ formId: '9007199254740993', fields: [{ key: 'JOB_TITLE', label: 'Role' }, { key: 'CITY', label: 'Location' }] }] };
  assert.equal((await api(second, `/accounts/${foreign._id}`, 'PATCH', settings)).status, 400);
  await getJson(await api(first, `/accounts/${google[0]._id}`, 'PATCH', settings));
  const googleDelivery = (hook, body) => realFetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_key: hook.key, ...body }).replace('"FORM64"', '9007199254740993') });
  const submission = { lead_id: 'g1', form_id: 'FORM64', campaign_id: 900,
    user_column_data: [{ column_id: 'PHONE_NUMBER', string_value: '+91 (98765) 43210' }, { column_id: 'JOB_TITLE', string_value: 'Engineer' }] };
  assert.equal((await googleDelivery(localHook, { ...submission, google_key: 'wrong' })).status, 403);
  assert.equal((await googleDelivery(localHook, { ...submission, customer_id: googleIds[1] })).status, 400);
  await Promise.all(Array.from({ length: 5 }, async () => assert.equal((await googleDelivery(localHook, submission)).status, 200)));
  assert.equal((await googleDelivery(localHook, { ...submission, lead_id: 'g2' })).status, 200);
  assert.equal((await googleDelivery(foreignHook, submission)).status, 200);
  assert.equal((await api(first, `/accounts/${google[0]._id}/test-webhook`, 'POST')).status, 200);
  while (await processNext()) { /* Drain the queued deliveries. */ }

  const lead = await Lead.findOne({ company: first.company }).lean();
  assert.equal(lead.name, '');
  assert.equal(lead.email, '');
  assert.equal(lead.phone, '+919876543210');
  assert.equal(lead.campaignName, 'Test campaign');
  assert.equal(lead.marketing.sourceType, 'paid_ads');
  assert.equal(lead.status, 'interested');
  assert.equal(String(lead.assignedTo), String(first.owner));
  assert.equal(await History.countDocuments({ lead: lead._id }), 1);
  assert.equal(notify.mock.calls.length, 2);
  assert.deepEqual(lead.marketing.answers, [{ label: 'Role', value: 'Engineer' }, { label: 'Location', value: '' }]);
  assert.equal(await Lead.countDocuments({ company: first.company }), 1);
  assert.equal(await Lead.countDocuments({ company: second.company }), 1);
  assert.equal((await Delivery.findOne({ company: first.company, externalLeadId: 'g1' })).duplicates, 4);
  assert.equal((await Delivery.findOne({ company: first.company, externalLeadId: 'g2' })).status, 'duplicate');

  const challenge = await realFetch(origin + metaHook + '?hub.mode=subscribe&hub.verify_token=test-meta-verify&hub.challenge=proof');
  assert.equal(await challenge.text(), 'proof');
  const metaDelivery = (formId, sign = true) => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: ids[0], changes: [
      { field: 'leadgen', value: { leadgen_id: '888', form_id: formId, page_id: ids[0] } }
    ] }] });
    const hash = createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex');
    return realFetch(origin + metaHook, { method: 'POST', body, headers: {
      'Content-Type': 'application/json', 'X-Hub-Signature-256': sign ? `sha256=${hash}` : 'invalid'
    } });
  };
  assert.equal((await metaDelivery('55', false)).status, 403);
  assert.equal((await metaDelivery('45')).status, 200);
  assert.equal(await Delivery.countDocuments({ platform: 'meta' }), 0);
  failMeta = true;
  assert.equal((await metaDelivery('55')).status, 200);
  assert.equal(await processNext(), true);
  const failure = await Delivery.findOne({ platform: 'meta' });
  assert.equal(failure.status, 'failed');
  assert.equal((await Integration.findById(meta[0]._id)).status, 'reconnect');
  assert.equal((await api(second, `/logs/${failure._id}/retry`, 'POST')).status, 404);
  failMeta = false;
  await connect(first, 'meta', ids[0], meta[0]);
  assert.equal((await api(first, `/logs/${failure._id}/retry`, 'POST')).status, 202);
  assert.equal(await processNext(), true);
  const metaLead = await Lead.findOne({ company: first.company, 'marketing.platform': 'meta' }).lean();
  assert.equal(metaLead.marketing.channel, 'Instagram');
  assert.deepEqual(metaLead.marketing.answers, [{ label: 'budget', value: '50k' }]);

  await t.test('ads leads are visible, assignable and callable through the CRM web APIs', async () => {
    const staffId = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: staffId, company: first.company, name: 'Ads Telecaller', employeeId: 'ads-agent',
      email: 'ads-agent@example.com', companyRole: 'employee', isActive: true
    });
    const staff = { token: jwt.sign({ id: staffId }, process.env.JWT_SECRET) };
    await Permission.insertMany([
      { company: first.company, pageKey: 'admin-crm-all-leads', name: 'All Leads',
        path: '/ciisUser/crm/admin/all-leads', editUsers: [{ user: first.owner }] },
      { company: first.company, pageKey: 'admin-telecaller-call-workspace', name: 'Call Workspace',
        path: '/ciisUser/telecaller/call-workspace', editUsers: [{ user: staffId }] },
      { company: second.company, pageKey: 'admin-telecaller-call-workspace', name: 'Call Workspace',
        path: '/ciisUser/telecaller/call-workspace', editUsers: [{ user: second.owner }] }
    ]);
    const all = await getJson(await crm(first, '/api/crm/leads?page=1&limit=10&source=Google%20Ads'));
    assert.equal(all.total, 1);
    assert.equal(all.items[0].marketing.answers[0].value, 'Engineer');
    const receiptDay = new Date(+new Date(all.items[0].createdAt) + 19800000).toISOString().slice(0, 10);
    const dated = await getJson(await crm(first,
      `/api/crm/leads?page=1&limit=10&source=Google%20Ads&dateField=leadDate&from=${receiptDay}&to=${receiptDay}`));
    assert.equal(dated.total, 1);
    assert.equal(dated.items[0].leadDate, '');
    const metaList = await getJson(await crm(first, '/api/crm/leads?page=1&limit=10&source=Meta%20Ads'));
    assert.equal(metaList.items[0].marketing.channel, 'Instagram');
    assert.equal((await getJson(await crm(staff, '/api/crm/telecaller'))).items.length, 0);
    assert.equal((await crm(second, '/api/calls/start', 'POST', { leadId: lead._id })).status, 404);

    for (const item of [lead, metaLead]) {
      const assigned = await getJson(await crm(first, `/api/crm/leads/${item._id}/assign`, 'PUT', {
        userId: staffId, reason: 'Route the ads lead to the telecaller'
      }));
      assert.equal(String(assigned.item.assignedTo?._id || assigned.item.assignedTo), String(staffId));
    }
    const queue = await getJson(await crm(staff, '/api/crm/telecaller'));
    assert.equal(queue.items.length, 2);
    const detail = await getJson(await crm(staff, `/api/crm/telecaller/${lead._id}`));
    assert.equal(detail.item.marketing.formId, '9007199254740993');

    const start = await getJson(await crm(staff, '/api/calls/start', 'POST', { leadId: lead._id }), 201);
    assert.ok(start._id);
    assert.equal(start.leadPhone, '+919876543210');
    assert.equal((await crm(staff, '/api/calls/start', 'POST', { leadId: metaLead._id })).status, 400);
    const followUp = new Date(Date.now() + 3600000).toISOString();
    const endTime = new Date().toISOString();
    const call = { id: 'ads-callback-1', endTime, outcome: 'Need Callback', callType: 'Outbound',
      duration: 42, followUp, notes: 'Call back tomorrow', callLogId: start._id };
    assert.equal((await crm(staff, `/api/crm/telecaller/${metaLead._id}/calls`, 'POST', call)).status, 409);
    assert.equal((await Lead.findById(metaLead._id)).callHistory.length, 0);
    const noDate = await crm(staff, `/api/crm/telecaller/${lead._id}/calls`, 'POST', { ...call, followUp: null });
    assert.equal(noDate.status, 400);
    const recorded = await getJson(await crm(staff, `/api/crm/telecaller/${lead._id}/calls`, 'POST', call));
    assert.equal(recorded.item.status, 'follow-up');
    assert.equal(recorded.item.nextFollowUp, followUp);
    assert.equal(recorded.item.callHistory[0].date, start.startTime);
    const log = await CallLog.findById(start._id).lean();
    assert.equal(log.startTime.toISOString(), start.startTime);
    assert.equal(log.endTime.toISOString(), endTime);
    assert.equal(log.duration, 42);
    assert.equal(log.leadSourceName, 'Google Ads');
    const pending = await FollowUp.findOne({ lead: lead._id, status: 'pending' }).lean();
    assert.equal(pending.date.toISOString(), followUp);

    const conversion = { id: 'ads-converted-2', outcome: 'Converted', callType: 'Outbound', notes: 'Converted after callback' };
    for (let times = 0; times < 2; times += 1) {
      const converted = await getJson(await crm(staff, `/api/crm/telecaller/${lead._id}/calls`, 'POST', conversion));
      assert.equal(converted.item.status, 'converted');
      assert.equal(converted.item.nextFollowUp, null);
      assert.equal(converted.item.callHistory.length, 2);
    }
    assert.equal(await FollowUp.countDocuments({ lead: lead._id, status: 'pending' }), 0);
    assert.equal(await CallLog.countDocuments({ lead: lead._id }), 2);
  });


  revokeGoogle = true;
  assert.equal((await api(first, `/accounts/${google[0]._id}/test`, 'POST')).status, 502);
  assert.equal((await Integration.findById(google[0]._id)).status, 'reconnect');
  revokeGoogle = false;
  await connect(first, 'google', googleIds[0], google[0]);
  assert.equal((await getJson(await api(first, `/accounts/${google[0]._id}/webhook`))).key, localHook.key);
  assert.equal((await api(first, `/accounts/${google[0]._id}`, 'DELETE')).status, 204);
  assert.equal((await googleDelivery(localHook, { lead_id: 'disconnected' })).status, 403);
  await connect(first, 'google', googleIds[0], google[0]);
  assert.notEqual((await getJson(await api(first, `/accounts/${google[0]._id}/webhook`))).key, localHook.key);

  assert.equal((await api(first, `/accounts/${meta[0]._id}`, 'DELETE')).status, 204);
  assert.equal((await metaDelivery('55')).status, 200);
  assert.equal((await Delivery.findById(failure._id)).duplicates, 0);
});
