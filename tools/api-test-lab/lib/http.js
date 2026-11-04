const axios = require('axios');

// One HTTP call against the backend under test. Never throws: network errors and
// timeouts come back as status 0 with an error message, so a broken API is a
// failed test row instead of a crashed run.
const createClient = ({ baseURL, timeoutMs = 20000 }) => async (method, path, { token, body, query, headers } = {}) => {
  const started = process.hrtime.bigint();
  try {
    const res = await axios({
      method,
      url: baseURL.replace(/\/+$/, '') + path,
      data: body,
      params: query,
      timeout: timeoutMs,
      validateStatus: () => true,
      maxRedirects: 0,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    return { status: res.status, data: res.data, ms: Math.round(ms) };
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      status: 0,
      data: null,
      ms: Math.round(ms),
      error: err.code === 'ECONNABORTED' ? `Timeout after ${timeoutMs} ms` : (err.code || err.message),
    };
  }
};

const messageOf = (res) => {
  if (!res) return '';
  if (res.error) return res.error;
  const d = res.data;
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 200);
  const msg = d.message || d.error || d.msg || (Array.isArray(d.errors) ? d.errors.map(e => e.msg || e.message || e).join(', ') : '');
  return typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(msg).slice(0, 300);
};

module.exports = { createClient, messageOf };
