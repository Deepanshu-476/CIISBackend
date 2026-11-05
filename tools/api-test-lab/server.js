// CIIS API Test Lab
// A separate small server (it does not change the backend). It serves one page
// that adds dummy data, runs every API flow against a running backend, times
// each call, lists what fails, and deletes the dummy data again.
//
//   node tools/api-test-lab/server.js
//   LAB_TARGET=http://localhost:3100 MONGO_URI=mongodb://127.0.0.1:27027/ciistest node tools/api-test-lab/server.js
//
// The backend under test (LAB_TARGET) must use the same database as MONGO_URI.
const path = require('path');
const fs = require('fs');
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env'), quiet: true });

const express = require('express');
const mongoose = require('mongoose');
const { createClient } = require('./lib/http');
const { Runner } = require('./lib/runner');
const data = require('./lib/data');
const { authFlow, setupFlow, inLiveWindow, LIVE_WINDOW } = require('./lib/flows/authSetup');
const { attendanceFlow, weekendFlow, leaveFlow } = require('./lib/flows/attendance');
const { tasksFlow, projectsFlow, pagePermissionFlow, clientFlow } = require('./lib/flows/work');
const { crmFlow } = require('./lib/flows/crm');
const { payrollFlow } = require('./lib/flows/payroll');
const { adminFlow } = require('./lib/flows/admin');
const { runSweep, catalog } = require('./lib/sweep');
const { hhmm, istKey } = require('./lib/time');

const LAB_PORT = Number(process.env.LAB_PORT || 4600);
const MONGO_URI = process.env.LAB_MONGO_URI || process.env.MONGO_URI;
let target = process.env.LAB_TARGET || `http://localhost:${process.env.PORT || 3000}`;
const mongoInfo = data.describeMongo(MONGO_URI);
const remoteAllowed = process.env.LAB_ALLOW_REMOTE_DB === '1';
const REPORT_DIR = path.join(__dirname, 'reports');

const MODULES = [
  { key: 'auth', label: 'Auth & Login', fn: authFlow },
  { key: 'setup', label: 'Setup: Departments, Job roles, Employees', fn: setupFlow, required: true },
  { key: 'attendance', label: 'Attendance (clock-in, shift rules, manual)', fn: attendanceFlow },
  { key: 'weekend', label: 'Weekend work & Overtime', fn: weekendFlow },
  { key: 'leave', label: 'Leave & Holidays', fn: leaveFlow },
  { key: 'tasks', label: 'Tasks (assigned & self)', fn: tasksFlow },
  { key: 'projects', label: 'Projects & project tasks', fn: projectsFlow },
  { key: 'clients', label: 'Clients & Client login', fn: clientFlow },
  { key: 'pages', label: 'Page management (permissions)', fn: pagePermissionFlow },
  { key: 'crm', label: 'CRM (leads, assignment, telecaller, reports)', fn: crmFlow },
  { key: 'payroll', label: 'Payroll (components, salary, payroll run, payslip)', fn: payrollFlow },
  { key: 'admin', label: 'Admin pages (users, branches, groups, meetings, alerts, support)', fn: adminFlow },
];

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- one run at a time; events are kept so a reloaded page can catch up ----
let current = null; // { id, runner, events, clients:Set, done, startedAt }
let lastReport = null;
try { lastReport = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, 'last-report.json'), 'utf8')); } catch { /* none yet */ }

const broadcast = (evt) => {
  if (!current) return;
  current.events.push(evt);
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of current.clients) res.write(line);
};

const dbGuard = (res) => {
  if (!MONGO_URI) {
    res.status(400).json({ ok: false, message: 'MONGO_URI is not set (backend .env or LAB_MONGO_URI).' });
    return false;
  }
  if (!mongoInfo.isLocal && !remoteAllowed) {
    res.status(403).json({
      ok: false,
      message: `Database ${mongoInfo.hosts}/${mongoInfo.db} is not local. Dummy data would go into a shared/live database. ` +
        'Start the lab with LAB_ALLOW_REMOTE_DB=1 only if you really want that.',
    });
    return false;
  }
  return true;
};

const ensureDb = async () => {
  await data.connect(MONGO_URI);
  return mongoose.connection.db;
};

app.get('/lab/info', async (req, res) => {
  let dbOk = false;
  let dbError = '';
  let inventory = null;
  if (MONGO_URI && (mongoInfo.isLocal || remoteAllowed)) {
    try {
      await ensureDb();
      dbOk = true;
      inventory = await data.inventory();
    } catch (err) {
      dbError = err.message;
    }
  }
  const state = data.readState();
  const routes = (() => { try { return catalog(); } catch { return []; } })();
  res.json({
    target,
    mongo: { ...mongoInfo, connected: dbOk, error: dbError, remoteAllowed },
    liveWindow: { open: inLiveWindow(), from: hhmm(LIVE_WINDOW.from), to: hhmm(LIVE_WINDOW.to), today: istKey() },
    modules: MODULES.map(({ key, label, required }) => ({ key, label, required: !!required })),
    state: state && {
      companyCode: state.companyCode,
      companyName: state.companyName,
      createdAt: state.createdAt,
      password: state.password,
      users: Object.fromEntries(Object.entries(state.users || {}).map(([k, u]) => [k, { email: u.email, name: u.name, password: u.password, note: u.note || '' }])),
    },
    inventory,
    running: !!(current && !current.done),
    routeCount: routes.length,
    getCount: routes.filter(r => r.method === 'GET').length,
    lastReport: lastReport ? { at: lastReport.finishedAt, summary: lastReport.summary } : null,
  });
});

app.post('/lab/target', (req, res) => {
  const t = String(req.body?.target || '').trim();
  if (!/^https?:\/\/[^\s]+$/.test(t)) return res.status(400).json({ ok: false, message: 'Give a URL like http://localhost:3100' });
  target = t.replace(/\/+$/, '');
  res.json({ ok: true, target });
});

app.get('/lab/ping', async (req, res) => {
  const api = createClient({ baseURL: target, timeoutMs: 8000 });
  const r = await api('GET', '/api');
  res.json({ ok: r.status > 0 && r.status < 500, status: r.status, ms: r.ms, error: r.error || '' });
});

app.get('/lab/catalog', (req, res) => {
  res.json({ routes: catalog() });
});

app.post('/lab/seed', async (req, res) => {
  if (!dbGuard(res)) return;
  if (current && !current.done) return res.status(409).json({ ok: false, message: 'A test run is in progress' });
  try {
    await ensureDb();
    const existing = data.readState();
    if (existing) {
      const found = await mongoose.connection.db.collection('companies').findOne({ companyCode: existing.companyCode });
      if (found) return res.json({ ok: true, message: `Dummy company ${existing.companyCode} already exists`, companyCode: existing.companyCode });
    }
    const state = await data.seedCompany();
    res.json({ ok: true, message: `Dummy company ${state.companyCode} + owner login created. Employees, departments, job roles and the client are created by the test run through the APIs.`, companyCode: state.companyCode });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/lab/delete', async (req, res) => {
  if (!dbGuard(res)) return;
  if (current && !current.done) return res.status(409).json({ ok: false, message: 'Stop the running test first' });
  try {
    await ensureDb();
    const logs = [];
    const result = await data.wipe({ keepBase: false, log: t => logs.push(t) });
    res.json({ ok: true, ...result, logs });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get('/lab/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  if (!current) return;
  for (const evt of current.events) res.write(`data: ${JSON.stringify(evt)}\n\n`);
  if (current.done) return;
  current.clients.add(res);
  req.on('close', () => current && current.clients.delete(res));
});

app.post('/lab/stop', (req, res) => {
  if (current && !current.done) {
    current.runner.aborted = true;
    broadcast({ type: 'log', level: 'warn', text: 'Stop requested — finishing the current call…' });
  }
  res.json({ ok: true });
});

app.get('/lab/report', (req, res) => {
  if (!lastReport) return res.status(404).json({ ok: false, message: 'No report yet' });
  res.setHeader('Content-Disposition', `attachment; filename="api-test-report-${(lastReport.finishedAt || '').slice(0, 19).replace(/[:T]/g, '-')}.json"`);
  res.json(lastReport);
});

// Readable report: one HTML file that opens without the lab and prints to PDF.
app.get('/lab/report.html', (req, res) => {
  if (!lastReport) return res.status(404).json({ ok: false, message: 'No report yet' });
  const stamp = (lastReport.finishedAt || '').slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="api-test-report-${stamp}.html"`);
  res.type('html').send(require('./lib/reportHtml').buildReportHtml(lastReport));
});

app.post('/lab/run', async (req, res) => {
  if (!dbGuard(res)) return;
  if (current && !current.done) return res.status(409).json({ ok: false, message: 'A test run is already in progress' });
  const wanted = new Set(Array.isArray(req.body?.modules) ? req.body.modules : MODULES.map(m => m.key));
  const sweep = req.body?.sweep || { enabled: true };
  const runId = Date.now().toString(36);
  const api = createClient({ baseURL: target, timeoutMs: Number(process.env.LAB_TIMEOUT_MS || 20000) });
  const runner = new Runner({ api, emit: evt => broadcast(evt) });
  current = { id: runId, runner, events: [], clients: new Set(), done: false, startedAt: new Date().toISOString() };
  res.json({ ok: true, runId });

  const startedAt = Date.now();
  broadcast({ type: 'start', runId, target, at: current.startedAt, modules: [...wanted], sweep });
  try {
    await ensureDb();
    // 0. reachability
    const ping = await api('GET', '/api');
    if (ping.status === 0) throw new Error(`Backend ${target} is not reachable (${ping.error}). Start it first.`);
    runner.log(`Backend ${target} answered in ${ping.ms} ms`);

    // 1. dummy company
    let state = data.readState();
    const exists = state && await mongoose.connection.db.collection('companies').findOne({ companyCode: state.companyCode });
    if (!exists) {
      if (state) data.clearStateFile();
      state = await data.seedCompany({ log: t => runner.log(t) });
    }
    // 2. clear the previous run's activity, keep logins
    await data.wipe({ keepBase: true, log: t => runner.log(t) });
    const pageCount = await data.ensureCompanyPages(state);
    runner.log(`Dummy company plan: ${pageCount} pages enabled (HR + CRM + telecaller)`);

    const ctx = { T: runner, api, state, db: mongoose.connection.db, save: () => data.writeState(state) };

    for (const m of MODULES) {
      if (runner.aborted) break;
      if (!m.required && !wanted.has(m.key)) continue;
      broadcast({ type: 'phase', key: m.key, label: m.label });
      try {
        await m.fn(ctx);
      } catch (err) {
        if (runner.aborted) break;
        runner.push({ name: `${m.label}: stopped early`, method: 'ERROR', path: '', status: '', ms: 0, result: 'fail', detail: err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err.message });
      }
    }
    if (!runner.aborted && sweep.enabled !== false) {
      broadcast({ type: 'phase', key: 'sweep', label: 'All GET APIs (sweep)' });
      await runSweep(ctx, { includeAliases: !!sweep.includeAliases, concurrency: Number(sweep.concurrency || 4), as: sweep.as || 'owner' });
      if (sweep.asEmployee) await runSweep(ctx, { includeAliases: !!sweep.includeAliases, concurrency: Number(sweep.concurrency || 4), as: 'std' });
      if (sweep.asClient && state.users.client) await runSweep(ctx, { includeAliases: !!sweep.includeAliases, concurrency: Number(sweep.concurrency || 4), as: 'client' });
    }
  } catch (err) {
    runner.push({ name: 'Run stopped', method: 'ERROR', path: '', status: '', ms: 0, result: 'fail', detail: err.message });
  }

  const summary = runner.summary();
  lastReport = {
    runId,
    target,
    database: `${mongoInfo.hosts}/${mongoInfo.db}`,
    startedAt: current.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    aborted: runner.aborted,
    summary,
    rows: runner.rows,
  };
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'last-report.json'), JSON.stringify(lastReport, null, 2));
  } catch { /* report file is optional */ }
  broadcast({ type: 'done', summary, durationMs: lastReport.durationMs, aborted: runner.aborted });
  current.done = true;
  for (const c of current.clients) c.end();
  current.clients.clear();
});

app.listen(LAB_PORT, () => {
  console.log(`\nCIIS API Test Lab → http://localhost:${LAB_PORT}`);
  console.log(`  Backend under test : ${target}`);
  console.log(`  Database           : ${mongoInfo.hosts}/${mongoInfo.db}${mongoInfo.isLocal ? '' : remoteAllowed ? '  (REMOTE — allowed by LAB_ALLOW_REMOTE_DB=1)' : '  (REMOTE — blocked)'}\n`);
});
