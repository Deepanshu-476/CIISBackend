const fs = require('fs');
const path = require('path');
const { BACKEND_DIR } = require('./data');
const { messageOf } = require('./http');

// Reads server.js and every mounted router file and lists all routes (method + full path).
const discoverRoutes = () => {
  const srv = fs.readFileSync(path.join(BACKEND_DIR, 'server.js'), 'utf8');
  const varReq = {};
  for (const m of srv.matchAll(/const\s+(\w+)\s*=\s*require\(["'`](\.[^"'`]+)["'`]\)/g)) varReq[m[1]] = m[2];
  const mounts = [];
  const mountRe = /app\.use\(\s*(\[[^\]]+\]|["'`][^"'`]+["'`])\s*,\s*(?:[\w]+\s*,\s*)*(?:require\(["'`](\.[^"'`]+)["'`]\)|(\w+))\s*\)/g;
  for (const m of srv.matchAll(mountRe)) {
    const prefixes = m[1].startsWith('[') ? [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(x => x[1]) : [m[1].slice(1, -1)];
    const file = m[2] || varReq[m[3]];
    if (file) prefixes.forEach(p => mounts.push({ prefix: p, file }));
  }
  const seen = new Set();
  const out = [];
  const parse = (file, prefix, depth = 0) => {
    let f = path.resolve(BACKEND_DIR, file);
    if (!f.endsWith('.js')) f += '.js';
    if (!fs.existsSync(f)) {
      const idx = f.replace(/\.js$/, '/index.js');
      if (!fs.existsSync(idx)) return;
      f = idx;
    }
    const src = fs.readFileSync(f, 'utf8');
    const local = {};
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*require\(["'`](\.[^"'`]+)["'`]\)/g)) local[m[1]] = m[2];
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]*)["'`]/g)) {
      const full = (prefix + m[2]).replace(/\/+$/, '') || '/';
      const key = `${m[1]} ${full}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method: m[1].toUpperCase(), path: full, file: path.relative(BACKEND_DIR, f) });
    }
    for (const m of src.matchAll(/router\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:[\w.]+\s*,\s*)*(?:require\(["'`](\.[^"'`]+)["'`]\)|(\w+))\s*\)/g)) {
      const sub = m[2] || local[m[3]];
      if (sub && depth < 3) parse(path.relative(BACKEND_DIR, path.resolve(path.dirname(f), sub)), prefix + m[1], depth + 1);
    }
  };
  mounts.forEach(({ prefix, file }) => parse(file, prefix));
  for (const m of srv.matchAll(/app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
    out.push({ method: m[1].toUpperCase(), path: m[2], file: 'server.js' });
  }
  return out;
};

// Old duplicate mounts of the same routers (the /api/... version is tested instead).
const ALIAS_PREFIXES = ['/task/', '/overtime/', '/departments', '/department/', '/department', '/job-roles', '/job-role', '/api/department/', '/api/job-role/'];
const isAlias = p => ALIAS_PREFIXES.some(a => p === a.replace(/\/$/, '') || p.startsWith(a.endsWith('/') ? a : a + '/'))
  || p === '/api/department' || p === '/api/job-role';

// GET routes that write data, start jobs, stream files or are debug-only: never called by the sweep.
const UNSAFE_GET = [
  /manual-/, /check-overdue/, /update-overdue/, /\/test(\/|$)/, /\/test1/, /debug/, /export/, /download/,
  /sample-excel/, /\/document$/, /\/files$/, /receipt-image/, /verify-email/, /\/stream/, /\/events/, /\/sse/,
  /\/backup/, /\/logout/, /\/socket-status/, /superAdmin/i, /\/uploads?\//,
];

const moduleOf = p => {
  const parts = p.split('/').filter(Boolean);
  const i = parts[0] === 'api' ? 1 : 0;
  return parts[i] === 'tasks' && parts[i + 1] ? `tasks/${parts[i + 1].startsWith(':') ? '*' : parts[i + 1]}` : (parts[i] || '/');
};

const fillParams = (p, ids) => {
  let unresolved = '';
  const filled = p.replace(/:(\w+)\??/g, (_, name) => {
    const n = name.toLowerCase();
    const map = [
      [/^(userid|employeeid|memberid)$/, ids.userId],
      [/^clientid$/, ids.clientId],
      [/^projectid$/, ids.projectId],
      [/^(companycode|code|identifier)$/, ids.companyCode],
      [/^companyid$/, ids.companyId],
      [/^(departmentid|department|deptid)$/, ids.departmentId],
      [/^(service)$/, 'SEO'],
      [/^(month)$/, String(new Date().getMonth() + 1)],
      [/^(year)$/, String(new Date().getFullYear())],
      [/^(filename|path|token|devicetoken)$/, null],
    ];
    for (const [re, v] of map) {
      if (!re.test(n)) continue;
      if (v == null) unresolved = /^(filename|path|token|devicetoken)$/.test(n) ? `needs a real ${name}` : `needs a ${name} (not created in this run)`;
      return v || 'x';
    }
    if (n === 'id' && /\/projects\//.test(p)) return ids.projectId || '000000000000000000000000';
    if (n === 'id' && /clientsservice/.test(p)) return ids.clientId || '000000000000000000000000';
    if (n === 'id' && /\/users\//.test(p)) return ids.userId;
    return '000000000000000000000000';
  });
  return { path: filled, unresolved };
};

const classify = (res) => {
  if (res.status === 0) return { result: 'fail', detail: `No response: ${res.error}` };
  if (res.status === 503 && /not configured|unavailable/i.test(messageOf(res))) return { result: 'warn', detail: `Service not set up on this server: ${messageOf(res)}` };
  if (res.status >= 500) return { result: 'fail', detail: `Server error ${res.status}: ${messageOf(res)}` };
  if (res.status === 404 && /route not found/i.test(messageOf(res))) return { result: 'fail', detail: 'Route not found (route listed in code but not reachable)' };
  if (res.status === 429) return { result: 'warn', detail: 'Rate limited' };
  return { result: 'pass', detail: '' };
};

const runSweep = async (ctx, { includeAliases = false, concurrency = 4, as = 'owner' } = {}) => {
  const { T, state, api } = ctx;
  const all = discoverRoutes();
  const gets = all.filter(r => r.method === 'GET');
  const targets = [];
  for (const r of gets) {
    if (!includeAliases && isAlias(r.path)) continue;
    if (r.path === '/' || r.path === '/api') continue;
    if (UNSAFE_GET.some(re => re.test(r.path))) continue;
    targets.push(r);
  }
  const ids = {
    userId: state.users.std?.id || state.users.owner.id,
    clientId: state.client?.id,
    projectId: state.lastProjectId,
    companyCode: state.companyCode,
    companyId: state.companyId,
    departmentId: state.depts?.main,
  };
  const token = state.users[as]?.token;
  T.setModule(`All GET APIs (sweep as ${as})`);
  T.log(`Sweep: ${all.length} routes found in code, ${gets.length} GET, ${targets.length} called (aliases ${includeAliases ? 'included' : 'skipped'}, write/job/download routes never called)`);

  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      if (T.aborted) return;
      const r = targets[i++];
      const { path: url, unresolved } = fillParams(r.path, ids);
      if (unresolved) {
        T.push({ name: r.path, method: 'GET', path: r.path, status: '', ms: 0, result: 'skip', detail: `Skipped: ${unresolved}`, group: moduleOf(r.path) });
        continue;
      }
      const res = await api('GET', url, { token });
      const c = classify(res);
      T.push({
        name: r.path,
        method: 'GET',
        path: url,
        status: res.status,
        ms: res.ms,
        result: c.result,
        detail: c.detail,
        serverMessage: res.status >= 400 ? messageOf(res) : '',
        group: moduleOf(r.path),
        file: r.file,
        as,
        response: c.result === 'fail' ? (typeof res.data === 'string' ? res.data.slice(0, 800) : res.data) : undefined,
      });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
};

const catalog = () => {
  const all = discoverRoutes();
  return all.map(r => ({ ...r, alias: isAlias(r.path), module: moduleOf(r.path), sweepable: r.method === 'GET' && !UNSAFE_GET.some(re => re.test(r.path)) }));
};

module.exports = { discoverRoutes, runSweep, catalog };
