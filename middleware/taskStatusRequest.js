// Deduplicate retries after authentication; retain only short-lived responses.
const requests = new Map();
const TTL = 120000;
module.exports = (req, res, next) => {
  const id = req.body?._statusRequestId;
  const actor = req.user?._id || req.user?.id;
  if (!actor || typeof id !== 'string' || id.length > 100) return next();
  const now = Date.now();
  for (const [key, entry] of requests) {
    if (entry.finished && now - entry.createdAt > TTL) requests.delete(key);
  }
  const key = `${actor}:${req.originalUrl}:${id}`;
  const fingerprint = JSON.stringify([req.body.status, req.body.completed, req.body.remarks, req.body.remark]);
  const existing = requests.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return res.status(409).json({ success: false, error: 'Status request ID was reused with different data' });
    }
    return existing.result.then(result => res.status(result.status).json(result.body));
  }
  if (requests.size >= 1000) return next();
  let resolve;
  const entry = { createdAt: now, fingerprint, finished: false, result: new Promise(done => { resolve = done; }) };
  requests.set(key, entry);
  const originalJson = res.json.bind(res);
  const finish = (status, body) => {
    if (entry.finished) return;
    entry.finished = true;
    resolve({ status, body });
    if (status >= 500) requests.delete(key);
  };
  res.json = body => {
    finish(res.statusCode || 200, body);
    return originalJson(body);
  };
  res.once('finish', () => finish(res.statusCode, { success: false, error: 'Status request did not return a JSON result' }));
  return next();
};
