const mongoose = require('mongoose');
const { messageOf } = require('../http');

const is = (...codes) => r => (codes.includes(r.status) ? true : `expected ${codes.join('/')}, got ${r.status}: ${messageOf(r)}`);
const denied = r => ([401, 403].includes(r.status) ? true : `expected 401/403 (no access), got ${r.status}: ${messageOf(r)}`);
const rejected = r => (r.status >= 400 && r.status < 500 ? true : `expected a 4xx rejection, got ${r.status}: ${messageOf(r)}`);

const has = (data, needle) => {
  try { return JSON.stringify(data || '').includes(String(needle)); } catch { return false; }
};

// Returns the first value found at any of the dotted paths.
const pick = (obj, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

const idOf = (obj, ...paths) => {
  const v = pick(obj, ...paths);
  if (!v) return undefined;
  return typeof v === 'object' ? String(v._id || v.id || '') || undefined : String(v);
};

// Direct DB lookup, used only to find an id when an API response does not include it.
const findId = async (collection, filter, sort = { _id: -1 }) => {
  const row = await mongoose.connection.db.collection(collection).find(filter).sort(sort).limit(1).next();
  return row ? String(row._id) : undefined;
};

const oid = id => new mongoose.Types.ObjectId(String(id));

// Finds an array of rows anywhere in a typical list response.
const rowsOf = (data) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of ['data', 'tasks', 'leaves', 'requests', 'items', 'results', 'projects', 'clients', 'users', 'docs', 'records', 'holidays']) {
    const v = data[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const inner = rowsOf(v);
      if (inner.length) return inner;
    }
  }
  return [];
};

module.exports = { is, denied, rejected, has, pick, idOf, findId, oid, rowsOf, messageOf };
