const DEFAULT_TTL_MS = Number(process.env.IN_MEMORY_CACHE_TTL_MS || 5 * 60 * 1000);

const store = new Map();

const getCacheKey = (namespace, parts = {}) => {
  const normalized = Object.keys(parts)
    .sort()
    .map(key => `${key}:${String(parts[key] ?? "")}`)
    .join("|");
  return `${namespace}|${normalized}`;
};

const getCached = (key) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
};

const setCached = (key, value, ttlMs = DEFAULT_TTL_MS) => {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
};

const getOrSetCached = async (key, loader, ttlMs = DEFAULT_TTL_MS) => {
  const cached = getCached(key);
  if (cached) return cached;
  const value = await loader();
  return setCached(key, value, ttlMs);
};

const invalidateCache = (prefix) => {
  for (const key of store.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      store.delete(key);
    }
  }
};

module.exports = {
  DEFAULT_TTL_MS,
  getCacheKey,
  getCached,
  setCached,
  getOrSetCached,
  invalidateCache,
};
