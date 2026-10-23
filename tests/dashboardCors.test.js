const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const cors = require('cors');

test('dashboard preflight permits Cache-Control for an allowed frontend origin', async () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('const corsOptions =');
  const end = source.indexOf('app.use(cors(corsOptions));', start);
  const options = vm.runInNewContext(source.slice(start, end) + '\ncorsOptions;', {
    isAllowedOrigin: origin => origin === 'http://localhost:5173',
  });
  const middleware = cors(options);
  const server = http.createServer((req, res) => middleware(req, res, error => {
    res.statusCode = error ? 403 : 200;
    res.end();
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/dashboard-overview/data/company`;
    const headers = { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,cache-control' };
    const response = await fetch(url, { method: 'OPTIONS', headers });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    const allowed = response.headers.get('access-control-allow-headers').toLowerCase().split(/,\s*/);
    assert.ok(allowed.includes('cache-control'));
    assert.ok(allowed.includes('authorization'));
    const rejected = await fetch(url, { method: 'OPTIONS', headers: { ...headers, Origin: 'https://untrusted.example' } });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
