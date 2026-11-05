// Builds one self-contained HTML file from a lab report: summary, modules,
// every failure with what the server answered, slowest calls and the full list.
// It opens without the lab server and prints cleanly to PDF from the browser.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Login responses carry real tokens; never write them into a file that gets shared.
const SECRET_KEYS = /token|password|secret|credential|otp/i;
const redact = value => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[hidden]' : redact(v)]));
};
const responseText = response => {
  if (response === undefined || response === null || response === '') return '';
  const text = typeof response === 'string' ? response : JSON.stringify(redact(response), null, 2);
  return text.length > 1500 ? `${text.slice(0, 1500)}\n… (cut)` : text;
};

const fmtDate = iso => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) + ' IST' : '—');
const badge = result => `<span class="b ${esc(result)}">${esc(String(result || '').toUpperCase())}</span>`;
const call = r => (r.method ? `<code>${esc(r.method)} ${esc(r.path)}</code>` : '<span class="muted">—</span>');

function buildReportHtml(report) {
  const s = report.summary || {};
  const rows = report.rows || [];
  const problems = rows.filter(r => r.result === 'fail' || r.result === 'warn');
  const modules = Object.entries(s.modules || {});
  const verdict = s.fail ? `${s.fail} failed` : 'All passed';

  const moduleRows = modules.map(([name, m]) => `
    <tr class="${m.fail ? 'bad' : ''}"><td>${esc(name)}</td><td class="n pass">${m.pass}</td><td class="n ${m.fail ? 'fail' : ''}">${m.fail}</td>
    <td class="n">${m.warn}</td><td class="n">${m.skip}</td><td class="n">${m.calls ? Math.round(m.ms / m.calls) : 0}</td></tr>`).join('');

  const problemBlocks = problems.map(r => `
    <div class="prob is-${esc(r.result)}">
      <div class="ph">${badge(r.result)} <b>${esc(r.name)}</b> <span class="muted">· ${esc(r.module)}</span></div>
      <table class="kv">
        <tr><th>API</th><td>${call(r)}</td></tr>
        <tr><th>Called as</th><td>${esc(r.as || '—')}</td></tr>
        <tr><th>Expected</th><td>${esc(r.expect || '—')}</td></tr>
        <tr><th>Got</th><td>HTTP ${esc(r.status || '—')}${r.ms != null ? ` · ${esc(r.ms)} ms` : ''}</td></tr>
        <tr><th>Problem</th><td>${esc(r.detail || '—')}</td></tr>
        ${r.serverMessage ? `<tr><th>Server said</th><td>${esc(r.serverMessage)}</td></tr>` : ''}
      </table>
      ${responseText(r.response) ? `<details><summary>Server response</summary><pre>${esc(responseText(r.response))}</pre></details>` : ''}
    </div>`).join('');

  const slowRows = (s.slowest || []).map(r => `<tr><td>${call(r)}<div class="muted">${esc(r.name)}</div></td><td class="n">${esc(r.ms)}</td></tr>`).join('');

  const allRows = rows.map(r => `<tr class="${r.result === 'fail' ? 'bad' : ''}"><td class="n">${esc(r.id)}</td><td>${badge(r.result)}</td><td>${esc(r.module)}</td>
    <td>${esc(r.name)}${r.detail && r.result !== 'pass' ? `<div class="muted">${esc(r.detail)}</div>` : ''}</td><td>${call(r)}</td><td>${esc(r.as || '')}</td><td class="n">${esc(r.status ?? '')}</td><td class="n">${esc(r.ms ?? '')}</td></tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CIIS API Test Report</title>
<style>
:root{--bg:#fff;--fg:#1d2330;--muted:#667085;--line:#e4e7ec;--soft:#f6f7f9;--pass:#14804a;--fail:#c4320a;--warn:#a15c07;--skip:#5a6474;--badbg:#fff4ef}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--fg:#e6e9ef;--muted:#98a2b3;--line:#2a303c;--soft:#1a1f29;--pass:#4ec98a;--fail:#ff8a65;--warn:#f0b54a;--skip:#a0a9b8;--badbg:#2a1c18}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{margin:0 0 4px;font-size:24px}h2{margin:32px 0 10px;font-size:17px}
.muted{color:var(--muted);font-size:12.5px}code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0 18px}
.verdict{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:600;background:var(--soft)}.verdict.bad{color:var(--fail)}.verdict.ok{color:var(--pass)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}.tile{background:var(--soft);border-radius:10px;padding:12px}
.tile b{display:block;font-size:22px}.tile span{color:var(--muted);font-size:12.5px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}.n{text-align:right;white-space:nowrap}.pass{color:var(--pass)}.fail{color:var(--fail)}
tr.bad td{background:var(--badbg)}.wrap{overflow-x:auto}
.b{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:5px;background:var(--soft)}
.b.pass{color:var(--pass)}.b.fail{color:var(--fail)}.b.warn{color:var(--warn)}.b.skip{color:var(--skip)}
.prob{border:1px solid var(--line);border-left:4px solid var(--fail);border-radius:8px;padding:12px;margin:10px 0;break-inside:avoid}.prob.is-warn{border-left-color:var(--warn)}
.ph{margin-bottom:6px}.kv th{width:110px;border:0;padding:3px 8px 3px 0}.kv td{border:0;padding:3px 0}
pre{background:var(--soft);padding:10px;border-radius:6px;overflow-x:auto;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
summary{cursor:pointer;color:var(--muted);font-size:12.5px;margin-top:6px}
@media print{details{display:block}details>summary{display:none}main{max-width:none}}
</style></head><body><main>
<h1>CIIS API Test Report</h1>
<div class="meta muted"><span>Run: ${esc(fmtDate(report.startedAt))}</span><span>Backend: ${esc(report.target)}</span><span>Database: ${esc(report.database)}</span><span>Took ${((report.durationMs || 0) / 1000).toFixed(1)} s</span>${report.aborted ? '<span class="fail">Stopped before the end</span>' : ''}</div>
<span class="verdict ${s.fail ? 'bad' : 'ok'}">${esc(verdict)}</span>

<h2>Summary</h2>
<div class="tiles">
<div class="tile"><b>${s.total ?? 0}</b><span>Total checks</span></div>
<div class="tile"><b class="pass">${s.pass ?? 0}</b><span>Passed</span></div>
<div class="tile"><b class="fail">${s.fail ?? 0}</b><span>Failed</span></div>
<div class="tile"><b>${s.warn ?? 0}</b><span>Warnings</span></div>
<div class="tile"><b>${s.skip ?? 0}</b><span>Skipped</span></div>
<div class="tile"><b>${s.slow ?? 0}</b><span>Slow (&gt;1.5 s)</span></div>
<div class="tile"><b>${s.apiCalls ?? 0}</b><span>API calls</span></div>
<div class="tile"><b>${s.avgMs ?? 0} ms</b><span>Avg time</span></div>
</div>

<h2>Failures and warnings (${problems.length})</h2>
${problemBlocks || '<p class="muted">None.</p>'}

<h2>By module</h2>
<div class="wrap"><table><tr><th>Module</th><th class="n">Pass</th><th class="n">Fail</th><th class="n">Warn</th><th class="n">Skip</th><th class="n">Avg ms</th></tr>${moduleRows}</table></div>

<h2>Slowest API calls</h2>
<div class="wrap"><table><tr><th>API</th><th class="n">ms</th></tr>${slowRows}</table></div>

<h2>All checks (${rows.length})</h2>
<div class="wrap"><table><tr><th class="n">#</th><th>Result</th><th>Module</th><th>Check</th><th>API</th><th>As</th><th class="n">HTTP</th><th class="n">ms</th></tr>${allRows}</table></div>
<p class="muted">Tokens, passwords and other secrets in server responses are shown as [hidden].</p>
</main></body></html>`;
}

module.exports = { buildReportHtml };
