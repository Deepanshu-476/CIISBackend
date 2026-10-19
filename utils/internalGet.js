// Runs a GET through one of this app's routers in-process (same middleware and permission checks as
// over HTTP) and resolves with { status, body } without serializing the response. Used by /api/badges
// to replace several client requests with one.
const internalGet = (router, req, url) => new Promise(resolve => {
  const fakeReq = Object.create(req);
  fakeReq.method = 'GET';
  fakeReq.url = url;
  fakeReq.originalUrl = url;
  fakeReq.baseUrl = '';
  fakeReq.params = {};
  fakeReq.body = {};

  const headers = {};
  let settled = false;
  const finish = result => {
    if (settled) return;
    settled = true;
    resolve(result);
  };
  const fakeRes = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    status(code) { this.statusCode = code; return this; },
    set(key, value) { if (typeof key === 'object') Object.assign(headers, key); else headers[key] = value; return this; },
    header(key, value) { return this.set(key, value); },
    setHeader(key, value) { headers[key] = value; },
    getHeader(key) { return headers[key]; },
    append() { return this; },
    vary() { return this; },
    json(body) { finish({ status: this.statusCode, body }); return this; },
    send(body) { finish({ status: this.statusCode, body }); return this; },
    end() { finish({ status: this.statusCode, body: undefined }); return this; },
    sendStatus(code) { this.statusCode = code; finish({ status: code, body: undefined }); return this; },
  };

  try {
    router(fakeReq, fakeRes, error => finish({ status: error ? (error.status || 500) : 404, body: undefined, error }));
  } catch (error) {
    finish({ status: 500, body: undefined, error });
  }
});

module.exports = { internalGet };
