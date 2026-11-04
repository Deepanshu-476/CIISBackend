const { messageOf } = require('./http');

const SLOW_MS = Number(process.env.LAB_SLOW_MS || 1500);

// Collects test rows and streams each one to the page as it finishes.
class Runner {
  constructor({ api, emit }) {
    this.api = api;
    this.emit = emit || (() => {});
    this.rows = [];
    this.seq = 0;
    this.module = 'General';
    this.aborted = false;
  }

  setModule(name) {
    this.module = name;
    this.emit({ type: 'module', module: name });
  }

  log(text, level = 'info') {
    this.emit({ type: 'log', level, text, module: this.module });
  }

  push(row) {
    const full = { id: ++this.seq, module: this.module, at: new Date().toISOString(), ...row };
    if (full.result === 'pass' && full.ms > SLOW_MS) full.slow = true;
    this.rows.push(full);
    this.emit({ type: 'result', row: full });
    return full;
  }

  // Calls an API and checks the response.
  // check(res) returns true (pass), a string (fail reason), or { warn: '...' }.
  async call(name, method, path, opts = {}, check) {
    if (this.aborted) throw new Error('Run stopped');
    const res = await this.api(method, path, opts);
    let verdict = true;
    if (res.status === 0) {
      verdict = `No response: ${res.error}`;
    } else if (check) {
      try {
        verdict = check(res);
      } catch (err) {
        verdict = `Check crashed: ${err.message}`;
      }
    } else if (res.status >= 400) {
      verdict = `HTTP ${res.status}`;
    }
    if (res.status === 429) {
      verdict = { warn: 'Rate limited (429): this API allows only a few tries per 15 minutes per IP. Run again after 15 minutes to check it.' };
    }
    let result = 'pass';
    let detail = '';
    if (verdict === true || verdict === undefined) {
      result = 'pass';
    } else if (verdict && typeof verdict === 'object' && verdict.warn) {
      result = 'warn';
      detail = verdict.warn;
    } else {
      result = 'fail';
      detail = String(verdict);
    }
    const msg = messageOf(res);
    this.push({
      name,
      method,
      path: opts.displayPath || path,
      status: res.status,
      ms: res.ms,
      result,
      detail,
      expect: opts.expect || '',
      serverMessage: msg,
      as: opts.as || '',
      response: result === 'pass' ? undefined : trimForReport(res.data),
      request: result === 'pass' ? undefined : trimForReport(opts.body),
    });
    res.ok = result === 'pass';
    return res;
  }

  // A check that is not one HTTP call (for example "the list shows LEAVE for today").
  assert(name, ok, { detail = '', expect = '', warn = false, actual } = {}) {
    const result = ok ? 'pass' : (warn ? 'warn' : 'fail');
    this.push({
      name,
      method: 'CHECK',
      path: '',
      status: '',
      ms: 0,
      result,
      expect,
      detail: ok ? '' : detail,
      serverMessage: actual !== undefined ? `actual: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}` : '',
    });
    return ok;
  }

  skip(name, reason, { method = '', path = '' } = {}) {
    this.push({ name, method: method || 'SKIP', path, status: '', ms: 0, result: 'skip', detail: reason });
  }

  summary() {
    const by = r => this.rows.filter(x => x.result === r).length;
    const timed = this.rows.filter(r => r.ms > 0);
    const modules = {};
    for (const r of this.rows) {
      const m = modules[r.module] || (modules[r.module] = { pass: 0, fail: 0, warn: 0, skip: 0, ms: 0, calls: 0 });
      m[r.result] += 1;
      if (r.ms > 0) { m.ms += r.ms; m.calls += 1; }
    }
    return {
      total: this.rows.length,
      pass: by('pass'),
      fail: by('fail'),
      warn: by('warn'),
      skip: by('skip'),
      slow: this.rows.filter(r => r.slow).length,
      apiCalls: timed.length,
      totalMs: timed.reduce((s, r) => s + r.ms, 0),
      avgMs: timed.length ? Math.round(timed.reduce((s, r) => s + r.ms, 0) / timed.length) : 0,
      slowest: [...timed].sort((a, b) => b.ms - a.ms).slice(0, 10).map(r => ({ id: r.id, name: r.name, method: r.method, path: r.path, ms: r.ms })),
      modules,
    };
  }
}

const trimForReport = (value) => {
  if (value === undefined || value === null) return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 1500 ? text.slice(0, 1500) + '…' : value;
  } catch {
    return String(value).slice(0, 1500);
  }
};

module.exports = { Runner, SLOW_MS };
