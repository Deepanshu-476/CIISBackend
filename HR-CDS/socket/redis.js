let pubClient = null;   // also used as the general Redis client (presence, call rooms)
let subClient = null;

const attachRedisAdapter = async (io) => {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[socket] REDIS_URL not set — using in-memory adapter (single server only)');
    return null;
  }
  try {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    pubClient = createClient({ url });
    subClient = pubClient.duplicate();
    pubClient.on('error', (e) => console.error('[redis pub]', e.message));
    subClient.on('error', (e) => console.error('[redis sub]', e.message));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient, {
      key: process.env.SOCKET_REDIS_PREFIX || 'ciis-socket',
    }));
    console.log('[socket] Redis adapter attached');
    return pubClient;
  } catch (err) {
    console.warn('[socket] Redis adapter initialization failed — using in-memory adapter:', err.message);
    return null;
  }
};

const getRedis = () => (pubClient?.isReady ? pubClient : null);

module.exports = { attachRedisAdapter, getRedis };
