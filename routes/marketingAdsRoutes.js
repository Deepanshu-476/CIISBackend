const express = require('express');
const mongoose = require('mongoose');
const Integration = require('../models/AdIntegration');
const Session = require('../models/AdOAuthSession');
const Delivery = require('../models/AdLeadWebhookLog');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Department = require('../models/Department');
const Client = require('../HR-CDS/models/Client');
const { protect } = require('../middleware/authMiddleware');
const sourcePermission = require('../middleware/leadSourcePermission');
const { canSeeAllBranches } = require('../utils/branchScope');
const provider = require('../services/marketingAds/providers');
const { clean, keyOf, numericId } = require('../services/marketingAds/normalize');
const { digest, encryptionKey, open, problem, random, seal } = require('../services/marketingAds/security');
const adsConfig = require('../services/marketingAdsConfigService');

const router = express.Router();
const routePath = '/ciisUser/crm/admin/marketing-ads';
const validPlatform = platform => ['meta', 'google'].includes(platform);
const noMetaLease = () => ({ $or: [{ metaLeaseUntil: { $exists: false } }, { metaLeaseUntil: { $lte: new Date() } }] });
const metaLease = () => ({ metaLease: random(), metaLeaseUntil: new Date(Date.now() + 60000) });
const clearMetaLease = { metaLease: 1, metaLeaseUntil: 1 };
const leadStatuses = Lead.schema.path('status').enumValues;
const userId = req => req.user._id || req.user.id;
const companyAdmin = (req, res, next) => canSeeAllBranches(req.user)
  ? next() : res.status(403).json({ message: 'Marketing Ads requires company administrator access.' });

function returnUrl(params = {}) {
  const url = new URL(routePath, adsConfig.getAdsCrmOrigin());
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function available(platform) {
  try {
    encryptionKey();
    return Boolean(provider.enabled(platform) && returnUrl() && adsConfig.getAdsPublicApiOrigin());
  } catch {
    return false;
  }
}

function webhookUrl(id) {
  return new URL(`/api/integrations/google-ads/webhook/${id}`, adsConfig.getAdsPublicApiOrigin()).toString();
}

async function connectionFor(req, select = '') {
  if (!mongoose.isValidObjectId(req.params.id)) throw problem(404, 'Connection was not found.');
  const connection = await Integration.findOne({ company: req.crmCompany, _id: req.params.id }).select(select);
  if (!connection) throw problem(404, 'Connection was not found.');
  return connection;
}

const viewConnection = item => {
  const { credentials, webhookKey, ownsMetaPage, metaLease, metaLeaseUntil, ...safe } = typeof item.toObject === 'function' ? item.toObject() : item;
  return safe;
};

router.get('/oauth/:platform/callback', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { platform } = req.params;
  if (!validPlatform(platform) || !available(platform)) return res.sendStatus(404);
  const { state, code } = req.query;
  if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state)) return res.redirect(returnUrl({ oauth: 'expired' }));
  const session = await Session.findOneAndUpdate({
    stateHash: digest(state), platform, consumed: { $ne: true }, expiresAt: { $gt: new Date() }
  }, { consumed: true }).select('+verifier');
  if (!session) return res.redirect(returnUrl({ oauth: 'expired' }));
  if (typeof code !== 'string' || !code) return res.redirect(returnUrl({ oauth: 'denied' }));
  try {
    const credentials = await provider.exchange(platform, code, open(session.verifier));
    await Session.updateOne({ _id: session._id }, {
      $set: { credentials: seal(credentials), expiresAt: new Date(Date.now() + 20 * 60 * 1000) },
      $unset: { verifier: 1 }
    });
    return res.redirect(returnUrl({ session: String(session._id) }));
  } catch {
    return res.redirect(returnUrl({ oauth: 'failed' }));
  }
});

router.use(protect, companyAdmin, sourcePermission('view'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const edit = sourcePermission('edit');

router.post('/oauth/:platform/start', edit, async (req, res) => {
  const { platform } = req.params;
  if (!validPlatform(platform) || !available(platform)) throw problem(503, 'This ads provider is not configured on the server.');
  const connection = req.body?.connectionId;
  if (connection && (!mongoose.isValidObjectId(connection) || !await Integration.exists({ _id: connection, company: req.crmCompany, platform }))) {
    throw problem(404, 'Connection was not found.');
  }
  const state = random();
  const verifier = random();
  await Session.create({
    company: req.crmCompany, user: userId(req), platform, connection: connection || undefined,
    stateHash: digest(state), verifier: seal(verifier), expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });
  res.json({ url: provider.authorizationUrl(platform, state, verifier) });
});

async function pendingSession(req) {
  if (!mongoose.isValidObjectId(req.params.session)) throw problem(404, 'Ads sign-in session expired. Connect the account again.');
  const pending = await Session.findOne({
    _id: req.params.session, user: userId(req), company: req.crmCompany,
    expiresAt: { $gt: new Date() }, credentials: { $exists: true }
  }).select('+credentials').lean();
  if (!pending) throw problem(404, 'Ads sign-in session expired. Connect the account again.');
  return pending;
}

async function metaAssets(pending, pageId) {
  const pages = await provider.metaPages(open(pending.credentials).accessToken);
  if (!pageId) return pages;
  const page = pages.find(item => item.id === pageId);
  if (!page?.access_token) throw problem(400, 'Choose a Facebook Page you can manage.');
  return page;
}

router.get('/oauth/sessions/:session', edit, async (req, res) => {
  const pending = await pendingSession(req);
  const existing = pending.connection && await Integration.findOne({ _id: pending.connection, company: req.crmCompany }).lean();
  const items = pending.platform === 'meta'
    ? await Promise.all((await metaAssets(pending)).map(provider.metaPageDetails))
    : await provider.googleAccounts(open(pending.credentials).accessToken);
  res.json({ platform: pending.platform, items, existing: existing ? viewConnection(existing) : null });
});

router.get('/oauth/sessions/:session/forms/:pageId', edit, async (req, res) => {
  const pending = await pendingSession(req);
  if (pending.platform !== 'meta') throw problem(404, 'Meta sign-in session was not found.');
  const page = await metaAssets(pending, req.params.pageId);
  res.json({ items: await provider.metaForms(page.id, page.access_token) });
});

function selectedForms(input, forms) {
  const ids = Array.isArray(input) ? [...new Set(input)] : [];
  if (!ids.length || ids.some(id => typeof id !== 'string' || !forms.some(form => form.id === id))) {
    throw problem(400, 'Select at least one available Meta lead form.');
  }
  return forms.filter(form => ids.includes(form.id)).map(({ id, name }) => ({ id, name }));
}

router.post('/oauth/sessions/:session/save', edit, async (req, res) => {
  const pending = await pendingSession(req);
  const { platform, company } = pending;
  const accountId = numericId(req.body?.accountId);
  if (!accountId) throw problem(400, 'Select an ads account.');
  const filter = { company, platform, externalAccountId: accountId };
  const reconnect = pending.connection && await Integration.findOne({ _id: pending.connection, company, platform });
  if (pending.connection && (!reconnect || reconnect.externalAccountId !== accountId)) {
    throw problem(400, 'Reconnect with the same ads account.');
  }
  const now = new Date();
  const credentials = open(pending.credentials);
  let account;
  if (platform === 'meta') {
    const page = await metaAssets(pending, accountId);
    const [detail, forms] = await Promise.all([provider.metaPageDetails(page), provider.metaForms(page.id, page.access_token)]);
    const fields = {
      accountName: detail.name || page.id, businessName: detail.businessName, instagramName: detail.instagramName,
      forms: selectedForms(req.body?.formIds, forms), credentials: seal({ pageToken: page.access_token })
    };
    const lease = metaLease();
    try {
      account = await Integration.findOneAndUpdate({ ...filter, ...noMetaLease() }, {
        $set: { ownsMetaPage: true, ...lease },
        $setOnInsert: { status: 'connecting', createdBy: pending.user }
      }, { upsert: true, new: true });
    } catch (error) {
      if (error.code === 11000) throw problem(409, 'This Meta Page already has a connection or is being updated.');
      throw error;
    }
    const leased = { ...filter, metaLease: lease.metaLease };
    try {
      await provider.subscribeMeta(page.id, page.access_token);
      const saved = await Integration.findOneAndUpdate(leased, {
        $set: { ...fields, status: 'connected', lastSyncAt: now }, $unset: clearMetaLease
      }, { new: true });
      if (!saved) throw problem(409, 'The connection changed. Reload Marketing Ads and try again.');
      account = saved;
    } catch (error) {
      await Integration.updateOne(leased, { $unset: {
        ...clearMetaLease, ...(['connecting', 'disconnected'].includes(account.status) && { ownsMetaPage: 1 })
      } });
      throw error;
    }
  } else {
    const token = await provider.refreshGoogle(credentials.refreshToken);
    const candidate = (await provider.googleAccounts(token)).find(row => row.id === accountId);
    if (!candidate) throw problem(400, 'Choose a Google Ads account you can access.');
    const customer = await provider.googleCustomer(accountId, token, candidate.managerId);
    if (!customer || customer.manager) throw problem(400, 'Choose an advertiser account.');
    const campaigns = await provider.googleCampaigns(accountId, token, candidate.managerId).catch(() => []);
    account = await Integration.findOneAndUpdate(filter, {
      $set: {
        accountName: customer.descriptiveName || accountId, managerId: candidate.managerId || '',
        campaigns, credentials: seal({ refreshToken: credentials.refreshToken }), status: 'connected', lastSyncAt: now
      },
      $setOnInsert: { webhookKey: seal(random()), createdBy: pending.user }
    }, { new: true, upsert: true });
    await Integration.updateOne({ _id: account._id, company, webhookKey: { $exists: false } }, { $set: { webhookKey: seal(random()) } });
  }
  await Session.deleteOne({ _id: pending._id, user: pending.user, company });
  res.json({ item: viewConnection(account) });
});

router.get('/accounts', async (req, res) => {
  const company = req.crmCompany;
  const filter = { company };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [items, counts, total, receivedToday, failed] = await Promise.all([
    Integration.find(filter).sort({ updatedAt: -1 }).lean(),
    Lead.aggregate([{ $match: { company: new mongoose.Types.ObjectId(company), 'marketing.integration': { $exists: true } } },
      { $group: { _id: '$marketing.integration', total: { $sum: 1 } } }]),
    Lead.countDocuments({ company, 'marketing.integration': { $exists: true } }),
    Lead.countDocuments({ company, 'marketing.integration': { $exists: true }, createdAt: { $gte: today } }),
    Delivery.countDocuments({ company, status: 'failed' })
  ]);
  const totals = new Map(counts.map(row => [String(row._id), row.total]));
  res.json({ items: items.map(item => ({ ...viewConnection(item), leads: totals.get(String(item._id)) || 0 })),
    summary: { total, receivedToday, failed }, available: { meta: available('meta'), google: available('google') }, leadStatuses });
});

router.get('/assignment-options', edit, async (req, res) => {
  const company = req.crmCompany;
  const [staff, departments, branches] = await Promise.all([
    User.find({ company, isActive: true, companyRole: { $not: /^client$/i } }).select('name').sort({ name: 1 }).lean(),
    Department.find({ company, isActive: { $ne: false } }).select('name').sort({ name: 1 }).lean(),
    Branch.find({ company, isActive: { $ne: false } }).select('name').sort({ name: 1 }).lean()
  ]);
  const clients = new Set((await Client.distinct('userId', { userId: { $in: staff.map(user => user._id) } })).map(String));
  res.json({ staff: staff.filter(user => !clients.has(String(user._id))), departments, branches });
});

function sanitizedMappings(input, platform, formIds) {
  if (!Array.isArray(input) || input.length > 200) throw problem(400, 'Invalid ad form mappings.');
  const seen = new Set();
  return input.map(row => {
    const formId = row?.formId === '' ? '' : numericId(row?.formId);
    if ((!formId && row?.formId !== '') || seen.has(formId) ||
      (platform === 'meta' && formId && !formIds.includes(formId)) || !Array.isArray(row.fields) || row.fields.length > 4) {
      throw problem(400, 'Use up to four fields per form, with one mapping per form.');
    }
    seen.add(formId);
    const fields = row.fields.map(field => ({ key: keyOf(field?.key), label: clean(field?.label, 80) }));
    if (fields.some(field => !field.key || !field.label) || new Set(fields.map(field => field.key)).size !== fields.length) {
      throw problem(400, 'Enter a distinct question key and label for each custom field.');
    }
    return { formId, fields };
  });
}

router.get('/accounts/:id/forms', edit, async (req, res) => {
  const account = await connectionFor(req, '+credentials');
  if (account.platform !== 'meta' || !account.credentials) throw problem(409, 'Connect Meta before editing selected forms.');
  res.json({ items: await provider.metaForms(account.externalAccountId, open(account.credentials).pageToken) });
});

router.patch('/accounts/:id', edit, async (req, res) => {
  const account = await connectionFor(req, '+credentials');
  const body = req.body || {};
  const { company } = account;
  const update = {};
  if (Object.hasOwn(body, 'formIds')) {
    if (account.platform !== 'meta' || !account.credentials) throw problem(409, 'Connect Meta before editing selected forms.');
    update.forms = selectedForms(body.formIds, await provider.metaForms(account.externalAccountId, open(account.credentials).pageToken));
  }
  if (Object.hasOwn(body, 'mappings')) {
    update.mappings = sanitizedMappings(body.mappings, account.platform, (update.forms || account.forms).map(form => form.id));
  }
  if (Object.hasOwn(body, 'leadStatus')) {
    if (!leadStatuses.includes(body.leadStatus)) throw problem(400, 'Choose a valid CRM lead status.');
    update.leadStatus = body.leadStatus;
  }
  for (const [field, model] of [['assignedTo', User], ['department', Department], ['branch', Branch]]) {
    if (!Object.hasOwn(body, field)) continue;
    const id = body[field];
    if (id && (!mongoose.isValidObjectId(id) || !await model.exists({ _id: id, company, isActive: { $ne: false },
      ...(field === 'assignedTo' && { companyRole: { $not: /^client$/i } }) }) ||
      (field === 'assignedTo' && await Client.exists({ userId: id })))) {
      throw problem(400, 'Choose an active assignment option from your company.');
    }
    update[field] = id || null;
  }
  const saved = await Integration.findOneAndUpdate({
    _id: account._id, company, updatedAt: account.updatedAt, ...noMetaLease()
  }, update, { new: true });
  if (!saved) throw problem(409, 'The connection changed. Reload and try again.');
  res.json({ item: viewConnection(saved) });
});

router.post('/accounts/:id/test', edit, async (req, res) => {
  const account = await connectionFor(req, '+credentials');
  if (!account.credentials) throw problem(409, 'Reconnect the ads account before testing.');
  const credentials = open(account.credentials);
  const sameCredentials = { _id: account._id, company: account.company, credentials: account.credentials, ...noMetaLease() };
  const update = { status: 'connected', lastSyncAt: new Date() };
  try {
    if (account.platform === 'meta') {
      const forms = await provider.testMeta(account.externalAccountId, credentials.pageToken);
      if (!forms.some(form => account.forms.some(selected => selected.id === form.id))) {
        throw problem(409, 'Select an available Meta lead form before testing.');
      }
    } else {
      const token = await provider.refreshGoogle(credentials.refreshToken);
      const customer = await provider.googleCustomer(account.externalAccountId, token, account.managerId);
      if (!customer) throw problem(409, 'Google Ads could not find this account.', true);
      update.campaigns = await provider.googleCampaigns(account.externalAccountId, token, account.managerId);
    }
    if (!(await Integration.updateOne(sameCredentials, update)).matchedCount) throw problem(409, 'The connection changed. Try again.');
    res.json({ message: 'Ads account connection verified.' });
  } catch (error) {
    if (error.reconnect) await Integration.updateOne(sameCredentials, { status: 'reconnect' });
    throw error;
  }
});

router.get('/accounts/:id/webhook', edit, async (req, res) => {
  const account = await connectionFor(req, '+webhookKey');
  if (account.platform !== 'google' || !account.webhookKey) throw problem(409, 'Connect Google Ads before configuring the webhook.');
  res.json({ url: webhookUrl(account._id), key: open(account.webhookKey) });
});

router.post('/accounts/:id/test-webhook', edit, async (req, res) => {
  const account = await connectionFor(req, '+webhookKey');
  if (account.platform !== 'google' || !account.webhookKey) throw problem(409, 'Connect Google Ads before testing the webhook.');
  let response;
  try {
    response = await fetch(webhookUrl(account._id), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_key: open(account.webhookKey), is_test: true, customer_id: account.externalAccountId })
    });
  } catch {
    throw problem(502, 'The public webhook could not be reached. Check the public API URL and HTTPS proxy.');
  }
  if (!response.ok) throw problem(502, 'The public webhook rejected the test. Check the webhook configuration.');
  res.json({ message: 'The CRM webhook accepted the test. Send test data from Google Ads to verify the form setup.' });
});

router.delete('/accounts/:id', edit, async (req, res) => {
  const account = await connectionFor(req, '+credentials');
  const filter = { _id: account._id, company: account.company, updatedAt: account.updatedAt, ...noMetaLease() };
  const removeMeta = account.platform === 'meta' && account.ownsMetaPage;
  const lease = removeMeta ? metaLease() : {};
  // Detach local routing first. OAuth grants may be shared across several connections.
  const disconnected = await Integration.findOneAndUpdate(filter, {
    $set: { status: 'disconnected', ...lease }, $unset: { credentials: 1, webhookKey: 1 }
  }, { new: true });
  if (!disconnected) throw problem(409, 'The connection changed. Reload and try again.');
  if (removeMeta) {
    if (account.credentials) {
      try {
        await provider.unsubscribeMeta(account.externalAccountId, open(account.credentials).pageToken);
      } catch {
        // The Page token may already be revoked. Disconnected routing rejects future deliveries.
      }
    }
    await Integration.updateOne({ _id: account._id, company: account.company, metaLease: lease.metaLease },
      { $unset: { ...clearMetaLease, ownsMetaPage: 1 } });
  }
  res.sendStatus(204);
});

router.get('/logs', async (req, res) => {
  const filter = { company: req.crmCompany };
  const { platform, account, status, date } = req.query;
  if (validPlatform(platform)) filter.platform = platform;
  if (mongoose.isValidObjectId(account)) filter.integration = account;
  if (Delivery.schema.path('status').enumValues.includes(status)) filter.status = status;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))) {
    const day = new Date(date);
    filter.receivedAt = { $gte: day, $lt: new Date(+day + 86400000) };
  }
  const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
  const [items, total] = await Promise.all([
    Delivery.find(filter).select('-claim -availableAt -expiresAt').sort({ receivedAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
    Delivery.countDocuments(filter)
  ]);
  res.json({ items, total, page });
});

router.post('/logs/:id/retry', edit, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw problem(404, 'Failed delivery was not found.');
  const job = await Delivery.findOneAndUpdate({
    company: req.crmCompany, _id: req.params.id, status: 'failed', payload: { $exists: true }
  }, {
    $set: { status: 'queued', availableAt: new Date(), attempts: 0 }, $unset: { error: 1, processedAt: 1, expiresAt: 1 }
  });
  if (!job) throw problem(404, 'Failed delivery was not found.');
  res.status(202).json({ message: 'Lead delivery queued for retry.' });
});

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.adsError) return res.status(error.status).json({ message: error.message });
  if (error.code === 11000) return res.status(409).json({ message: 'This ads connection changed. Reload Marketing Ads and try again.' });
  return res.status(500).json({ message: 'Marketing Ads could not complete the request. Try again.' });
});

module.exports = router;
