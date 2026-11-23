const { createHmac } = require('node:crypto');
const { digest, problem } = require('./security');
const adsConfig = require('../marketingAdsConfigService');

const metaVersion = () => adsConfig.getMetaGraphApiVersion();
const googleVersion = () => adsConfig.getGoogleAdsApiVersion();
const oauthConfig = platform => platform === 'meta'
  ? { id: adsConfig.getMetaAppId(), secret: adsConfig.getMetaAppSecret(), callback: adsConfig.getMetaRedirectUri() }
  : { id: adsConfig.getGoogleClientId(), secret: adsConfig.getGoogleClientSecret(), callback: adsConfig.getGoogleRedirectUri() };

function enabled(platform) {
  return Boolean(Object.values(oauthConfig(platform)).every(Boolean) &&
    (platform === 'meta' ? adsConfig.getMetaWebhookVerifyToken() : adsConfig.getGoogleAdsDeveloperToken()));
}

async function request(url, options, platform) {
  let response;
  let body;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(7000) });
    body = await response.json();
  } catch {
    throw problem(502, 'The ads provider did not return a usable response. Try again.');
  }
  if (!response.ok || body.error) {
    const expired = body.error === 'invalid_grant' || body.error?.code === 190 || (response.status === 401 && platform === 'google');
    throw problem(502, expired ? 'Ads account authorization expired. Reconnect the account.'
      : 'The ads provider rejected the request. Check account access and app permissions.', expired);
  }
  return body;
}

function authorizationUrl(platform, state, verifier) {
  const { id, callback } = oauthConfig(platform);
  const meta = platform === 'meta';
  const url = new URL(meta ? `https://www.facebook.com/${metaVersion()}/dialog/oauth` : 'https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: id, redirect_uri: callback, state, response_type: 'code',
    ...(meta ? {
      scope: ['pages_show_list,pages_read_engagement,pages_manage_ads,pages_manage_metadata,leads_retrieval',
        process.env.META_ADDITIONAL_SCOPES].filter(Boolean).join(','),
      auth_type: 'rerequest',
      ...(process.env.META_LOGIN_CONFIG_ID ? { config_id: process.env.META_LOGIN_CONFIG_ID } : {})
    } : {
      scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent',
      code_challenge: Buffer.from(digest(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256'
    })
  }).toString();
  return url.toString();
}

async function googleToken(params) {
  const { id, secret } = oauthConfig('google');
  return request('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, ...params })
  }, 'google');
}

async function exchange(platform, code, verifier) {
  const { id, secret, callback } = oauthConfig(platform);
  if (platform === 'google') {
    const token = await googleToken({ code, code_verifier: verifier, redirect_uri: callback, grant_type: 'authorization_code' });
    if (!token.refresh_token) throw problem(502, 'Google did not grant offline access. Connect again and approve access.');
    return { refreshToken: token.refresh_token, accessToken: token.access_token };
  }
  const token = await graph('oauth/access_token', null, { client_id: id, client_secret: secret, code, redirect_uri: callback });
  const extended = await graph('oauth/access_token', null, {
    client_id: id, client_secret: secret, grant_type: 'fb_exchange_token', fb_exchange_token: token.access_token
  });
  return { accessToken: extended.access_token };
}

function graph(path, token, params = {}, options = {}) {
  const url = new URL(`https://graph.facebook.com/${metaVersion()}/${path}`);
  const secret = adsConfig.getMetaAppSecret();
  const proof = token && secret && createHmac('sha256', secret).update(token).digest('hex');
  url.search = new URLSearchParams({ ...params, ...(proof ? { appsecret_proof: proof } : {}) }).toString();
  return request(url, { ...options, headers: token ? { Authorization: `Bearer ${token}` } : {} }, 'meta');
}

async function graphList(path, token, params) {
  const items = [];
  let after;
  do {
    const result = await graph(path, token, { limit: 100, ...params, ...(after ? { after } : {}) });
    items.push(...(result.data || []));
    const next = result.paging?.next && result.paging?.cursors?.after;
    if (next === after) break;
    after = next;
  } while (after);
  return items;
}

const metaPages = token => graphList('me/accounts', token, { fields: 'id,name,access_token' });
async function metaPageDetails(page) {
  const info = await graph(page.id, page.access_token, {
    fields: 'business{id,name},instagram_business_account{id,username}'
  }).catch(() => ({}));
  return {
    id: page.id, name: page.name, businessName: info.business?.name || '',
    instagramName: info.instagram_business_account?.username || ''
  };
}
async function metaForms(id, token) {
  const forms = await graphList(`${id}/leadgen_forms`, token, { fields: 'id,name,questions' });
  return forms.map(form => ({
    id: form.id, name: form.name,
    questions: (form.questions || []).filter(q => q.key).map(q => ({ key: q.key, label: q.label || q.key }))
  }));
}
async function subscribeMeta(id, token) {
  const response = await graph(`${id}/subscribed_apps`, token, { subscribed_fields: 'leadgen' }, { method: 'POST' });
  if (!response.success) throw problem(502, 'Meta did not enable the Page lead webhook.');
}
async function testMeta(id, token) {
  const [forms, subscriptions] = await Promise.all([metaForms(id, token), graphList(`${id}/subscribed_apps`, token, { fields: 'id,subscribed_fields' })]);
  const appId = adsConfig.getMetaAppId();
  if (!subscriptions.some(app => app.id === appId && app.subscribed_fields?.includes('leadgen'))) {
    throw problem(409, 'This Page has no CRM leadgen subscription. Reconnect to restore it.', true);
  }
  return forms;
}
const unsubscribeMeta = (id, token) => graph(`${id}/subscribed_apps`, token, {}, { method: 'DELETE' });

async function metaLead(id, token) {
  const fields = 'id,created_time,field_data,form_id,platform';
  try {
    return await graph(id, token, { fields: `${fields},ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name` });
  } catch (error) {
    if (error.reconnect) throw error;
    return graph(id, token, { fields });
  }
}

function googleRequest(path, token, options = {}, managerId = '') {
  return request(`https://googleads.googleapis.com/${googleVersion()}/${path}`, {
    ...options, headers: {
      Authorization: `Bearer ${token}`, 'developer-token': adsConfig.getGoogleAdsDeveloperToken(),
      ...(managerId ? { 'login-customer-id': managerId } : {}), ...options.headers
    }
  }, 'google');
}

async function googleSearch(id, token, managerId, query) {
  const rows = [];
  let pageToken;
  do {
    const body = await googleRequest(`customers/${id}/googleAds:search`, token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, pageToken })
    }, managerId);
    rows.push(...(body.results || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return rows;
}

const refreshGoogle = async token => (await googleToken({ refresh_token: token, grant_type: 'refresh_token' })).access_token;
const googleCustomer = async (id, token, managerId) => (await googleSearch(id, token, managerId,
  'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1'))[0]?.customer;

async function googleAccounts(token) {
  const response = await googleRequest('customers:listAccessibleCustomers', token);
  const accessible = (response.resourceNames || []).map(name => name.split('/').pop());
  const accounts = new Map();
  const details = await Promise.all(accessible.map(async id => ({ id, customer: await googleCustomer(id, token).catch(() => null) })));
  for (const { id, customer } of details) {
    accounts.set(id, { id, name: customer?.descriptiveName || id, manager: Boolean(customer?.manager) });
  }
  await Promise.all(details.filter(row => row.customer?.manager).map(async ({ id }) => {
    const rows = await googleSearch(id, token, id,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client WHERE customer_client.status = ENABLED AND customer_client.level > 0')
      .catch(() => []);
    for (const { customerClient: client } of rows) {
      if (client && !client.manager && !accounts.has(client.id)) {
        accounts.set(client.id, { id: client.id, name: client.descriptiveName || client.id, managerId: id });
      }
    }
  }));
  return [...accounts.values()].filter(account => !account.manager);
}

async function googleCampaigns(id, token, managerId) {
  const rows = await googleSearch(id, token, managerId,
    'SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status != REMOVED ORDER BY campaign.id DESC LIMIT 100');
  return rows.map(({ campaign }) => ({ id: campaign.id, name: campaign.name }));
}

module.exports = {
  enabled, authorizationUrl, exchange, metaPages, metaPageDetails, metaForms, subscribeMeta, testMeta, unsubscribeMeta,
  metaLead, googleAccounts, googleCustomer, refreshGoogle, googleCampaigns
};
