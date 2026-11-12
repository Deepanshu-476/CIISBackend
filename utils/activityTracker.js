const mongoose = require('mongoose');
const PageActivity = require('../models/PageActivity');

// Records which page each user opens and what they change there, for the company
// "User Activity" page and the super admin usage view.
// - Views are sent by the website / app (POST /api/activity/views).
// - Actions are every successful POST/PUT/PATCH/DELETE; the client tells us the page it was
//   on through the X-Page-Path header.
// - Logins are written by the login handlers (recordLogin).
// Rows are buffered and written in batches so tracking never slows a request down.

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 5000;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Writes that are not something a person "did" on a page (read receipts, typing, counters ...).
const IGNORED_WRITES = [
  /^\/api\/(activity|badges|auth|app-version)(\/|$)/i,
  /^\/api\/notifications(\/|$)/i,
  /\/(read|read-all|mark-read|mark-all-read|seen|delivered|typing|heartbeat|ping|presence|view|views|impression|dismiss)(\/|$)/i,
  // Requests that only look something up (POST used for a bigger query body).
  /\/(preview|calculate|validate|check|search|lookup|by-path)(\/|$)/i,
];

let buffer = [];
let timer = null;

const toId = value => {
  const raw = value && typeof value === 'object' ? (value._id || value.id) : value;
  const text = String(raw || '').trim();
  return OBJECT_ID.test(text) ? new mongoose.Types.ObjectId(text) : null;
};

const userBranches = user => {
  const list = [user?.branch, user?.branchId, ...(Array.isArray(user?.assignedBranches) ? user.assignedBranches : [])];
  const seen = new Set();
  return list.map(toId).filter(id => id && !seen.has(String(id)) && seen.add(String(id)));
};

// "/ciisUser/emp-client/64ab...?x=1" -> "/ciisUser/emp-client/:id"
const normalizePath = value => {
  let text = String(value || '').trim();
  if (!text) return '';
  try {
    if (/^https?:\/\//i.test(text)) text = new URL(text).pathname;
  } catch {
    return '';
  }
  text = text.split(/[?#]/)[0];
  const parts = text.split('/').filter(Boolean).map(part => {
    let decoded = part;
    try { decoded = decodeURIComponent(part); } catch { /* keep raw */ }
    if (OBJECT_ID.test(decoded) || UUID.test(decoded) || /^\d{3,}$/.test(decoded)) return ':id';
    return decoded.slice(0, 60);
  });
  return `/${parts.join('/')}`.slice(0, 200);
};

const clientSource = req => {
  const value = String(req?.get?.('x-client-app') || '').trim().toLowerCase();
  return value === 'web' || value === 'app' ? value : 'unknown';
};

const flush = async () => {
  if (!buffer.length) return;
  const rows = buffer;
  buffer = [];
  try {
    await PageActivity.insertMany(rows, { ordered: false });
  } catch (error) {
    console.error('[activity] write failed:', error.message);
  }
};

const ensureTimer = () => {
  if (timer) return;
  timer = setInterval(() => { flush(); }, FLUSH_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
};

const record = (user, row) => {
  const company = toId(user?.company);
  const userId = toId(user?._id || user?.id);
  if (!company || !userId) return; // super admin / client portal without a company
  if (buffer.length >= MAX_BUFFER) return;
  buffer.push({
    company,
    user: userId,
    branches: userBranches(user),
    createdAt: new Date(),
    ...row,
  });
  ensureTimer();
};

const isClientPortalUser = user => /^client$/i.test(String(user?.companyRole || user?.role || ''));

// Express middleware: log successful writes made by logged-in company users.
const trackWrites = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const apiPath = req.originalUrl.split('?')[0];
  if (IGNORED_WRITES.some(pattern => pattern.test(apiPath))) return next();
  res.on('finish', () => {
    const user = req.user;
    if (!user || res.statusCode >= 400 || isClientPortalUser(user)) return;
    record(user, {
      type: 'action',
      path: normalizePath(req.get('x-page-path')),
      method: req.method,
      endpoint: normalizePath(apiPath),
      status: res.statusCode,
      source: clientSource(req),
    });
  });
  next();
};

const recordViews = (user, views = [], source = 'unknown') => {
  if (isClientPortalUser(user)) return 0;
  let count = 0;
  views.slice(0, 50).forEach(view => {
    const path = normalizePath(view?.path);
    if (!path) return;
    const durationMs = Number(view?.durationMs);
    const at = view?.at ? new Date(view.at) : null;
    record(user, {
      type: 'view',
      path,
      source,
      ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs: Math.min(durationMs, 12 * 60 * 60 * 1000) } : {}),
      // Clients batch views; keep the time the page was opened when it is recent and sane.
      ...(at && !Number.isNaN(at.getTime()) && Math.abs(Date.now() - at.getTime()) < 24 * 60 * 60 * 1000 ? { createdAt: at } : {}),
    });
    count += 1;
  });
  return count;
};

const recordLogin = (user, req) => {
  if (isClientPortalUser(user)) return;
  record(user, { type: 'login', path: '', source: clientSource(req) });
};

module.exports = { trackWrites, recordViews, recordLogin, normalizePath, flush };
