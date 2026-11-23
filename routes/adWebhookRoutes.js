const express = require('express');
const { createHmac } = require('node:crypto');
const mongoose = require('mongoose');
const Integration = require('../models/AdIntegration');
const { equal, open } = require('../services/marketingAds/security');
const { clean, numericId } = require('../services/marketingAds/normalize');
const { enqueue } = require('../services/marketingAds/ingest');
const adsConfig = require('../services/marketingAdsConfigService');

const router = express.Router();
const rawJson = express.raw({ type: 'application/json', limit: '256kb', inflate: false });
const ids = new Set(['id', 'form_id', 'campaign_id', 'adgroup_id', 'ad_group_id', 'creative_id', 'customer_id', 'page_id', 'leadgen_id', 'ad_id']);
function parse(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  try {
    return JSON.parse(buffer.toString('utf8'), (key, value, context) =>
      ids.has(key) && typeof value === 'number' ? context?.source || value : value);
  } catch {
    return null;
  }
}

router.get('/meta/webhook', (req, res) => {
  const token = adsConfig.getMetaWebhookVerifyToken();
  const challenge = req.query['hub.challenge'];
  if (!token || req.query['hub.mode'] !== 'subscribe' || !equal(req.query['hub.verify_token'], token) || typeof challenge !== 'string') {
    return res.sendStatus(403);
  }
  return res.type('text/plain').send(challenge);
});

router.post('/meta/webhook', rawJson, async (req, res) => {
  const secret = adsConfig.getMetaAppSecret();
  if (!secret || !Buffer.isBuffer(req.body)) return res.sendStatus(403);
  const signature = 'sha256=' + createHmac('sha256', secret).update(req.body).digest('hex');
  if (!equal(req.get('X-Hub-Signature-256'), signature)) return res.sendStatus(403);
  const body = parse(req.body);
  if (body?.object !== 'page' || !Array.isArray(body.entry)) return res.sendStatus(400);
  for (const entry of body.entry) {
    const page = numericId(entry?.id);
    if (!page || !Array.isArray(entry.changes)) continue;
    const connection = await Integration.findOne({
      platform: 'meta', externalAccountId: page, status: { $in: ['connected', 'reconnect'] }, ownsMetaPage: true
    }).lean();
    if (!connection) continue;
    for (const change of entry.changes) {
      const event = change?.value;
      const id = numericId(event?.leadgen_id);
      const form = numericId(event?.form_id);
      if (change?.field !== 'leadgen' || !id || (event.page_id && numericId(event.page_id) !== page) ||
        !connection.forms.some(item => item.id === form)) continue;
      await enqueue(connection, id, event);
    }
  }
  return res.sendStatus(200);
});

router.post('/google-ads/webhook/:id', rawJson, async (req, res) => {
  const body = parse(req.body);
  if (!body || typeof body.google_key !== 'string' || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid webhook request.' });
  const connection = await Integration.findOne({
    _id: req.params.id, platform: 'google', status: { $in: ['connected', 'reconnect'] }
  }).select('+webhookKey').lean();
  if (!connection?.webhookKey || !equal(body.google_key, open(connection.webhookKey))) return res.status(403).json({ message: 'Webhook key verification failed.' });
  if (body.customer_id != null && numericId(body.customer_id) !== connection.externalAccountId) return res.status(400).json({ message: 'Webhook account does not match.' });
  const id = clean(body.lead_id, 250);
  const test = body.is_test === true;
  if (!test && (!id || typeof body.lead_id !== 'string' || body.lead_id.length > 250 || (body.user_column_data != null && !Array.isArray(body.user_column_data)))) {
    return res.status(400).json({ message: 'Invalid lead payload.' });
  }
  const { google_key: _key, ...payload } = body;
  await enqueue(connection, id, payload, test);
  return res.json({});
});

const directoryIngest = require('../services/directoryLeadIngestService');

function extractBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    const str = req.body.toString('utf8');
    try {
      return JSON.parse(str);
    } catch {
      return Object.fromEntries(new URLSearchParams(str));
    }
  }
  return req.query || {};
}

// IndiaMART Webhook Endpoint (Supports GET verification & POST lead ingestion)
router.all('/indiamart/webhook/:companyIdentifier', async (req, res) => {
  if (req.method === 'GET' && !req.query.SENDER_MOBILE && !req.query.MOBILE) {
    return res.json({ success: true, message: 'IndiaMART Webhook active' });
  }
  try {
    const payload = { ...req.query, ...extractBody(req) };
    const result = await directoryIngest.ingestIndiaMartLead(req.params.companyIdentifier, payload);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Justdial Webhook Endpoint (Supports GET & POST query/body parameters)
router.all('/justdial/webhook/:companyIdentifier', async (req, res) => {
  if (req.method === 'GET' && !req.query.mobile && !req.query.leadid && !req.query.phone) {
    return res.json({ success: true, message: 'Justdial Webhook active' });
  }
  try {
    const payload = { ...req.query, ...extractBody(req) };
    const result = await directoryIngest.ingestJustdialLead(req.params.companyIdentifier, payload);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  return res.sendStatus([400, 413, 415].includes(error.status) ? error.status : 503);
});

module.exports = router;
