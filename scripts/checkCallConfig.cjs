#!/usr/bin/env node
/**
 * Calling configuration check. Run it on the VPS inside a backend directory:
 *
 *   cd /var/www/CIISWEBBACKEND && node scripts/checkCallConfig.cjs
 *   cd /var/www/app1          && node scripts/checkCallConfig.cjs
 *
 * It reads that backend's .env and reports the two settings that make calls fail quietly:
 *   - COTURN_STATIC_AUTH_SECRET: without it /api/chat/turn-credentials returns 503 and calls fall
 *     back to STUN only, so calls across different networks drop after a few seconds.
 *   - REDIS_URL: without it Socket.IO and the call store are per-process, so the web backend and
 *     the app backend cannot ring each other.
 * It also prints a sample TURN credential so it can be compared with the running Coturn secret.
 */
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const ok = (text) => `\u001b[32mOK\u001b[0m   ${text}`;
const bad = (text) => `\u001b[31mFAIL\u001b[0m ${text}`;
const warn = (text) => `\u001b[33mWARN\u001b[0m ${text}`;

const splitList = (value = '') => String(value).split(',').map(item => item.trim()).filter(Boolean);

const getCoturnUrls = () => {
  const urls = splitList(process.env.COTURN_URLS || process.env.TURN_URLS);
  if (urls.length) return urls;
  const host = String(process.env.COTURN_HOST || process.env.TURN_HOST || '').trim();
  if (!host) return [];
  return [`stun:${host}:3478`, `turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`];
};

const lines = [];
let failed = false;

console.log(`\nCalling configuration for ${process.cwd()}\n`);

// 1. TURN
const secret = String(process.env.COTURN_STATIC_AUTH_SECRET || process.env.TURN_STATIC_AUTH_SECRET || '').trim();
const urls = getCoturnUrls();
const turnUrls = urls.filter(url => /^turns?:/i.test(url));

if (!secret) {
  failed = true;
  lines.push(bad('COTURN_STATIC_AUTH_SECRET is empty -> /api/chat/turn-credentials returns 503.'));
  lines.push('       Read it from the running Coturn container and put it in this .env:');
  lines.push("       docker inspect rtc-coturn-1 --format '{{json .Args}}' | tr ',' '\\n' | grep static-auth-secret");
} else {
  lines.push(ok(`COTURN_STATIC_AUTH_SECRET is set (${secret.length} characters).`));
}

if (!turnUrls.length) {
  failed = true;
  lines.push(bad('No turn: URL configured. Set COTURN_URLS (or at least COTURN_HOST).'));
} else {
  lines.push(ok(`TURN urls: ${turnUrls.join(', ')}`));
}

if (secret && turnUrls.length) {
  const ttl = Math.max(60, Number(process.env.COTURN_CREDENTIAL_TTL_SECONDS || 3600));
  const username = `${Math.floor(Date.now() / 1000) + ttl}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  lines.push(`     Sample credential -> username ${username}, credential ${credential.slice(0, 8)}...`);
  lines.push('     Verify the relay itself with:');
  lines.push(`     turnutils_uclient -y -n 1 -W '${'<secret>'}' ${String(process.env.COTURN_HOST || 'turn.ciisnetwork.in')}`);
}

// 2. Redis
const redisUrl = String(process.env.REDIS_URL || '').trim();
if (!redisUrl) {
  failed = true;
  lines.push(bad('REDIS_URL is empty -> this backend keeps calls in its own memory.'));
  lines.push('       Web backend and app backend then cannot ring each other. Set the SAME url in both:');
  lines.push('       REDIS_URL=redis://127.0.0.1:6379');
} else {
  lines.push(ok(`REDIS_URL is set (${redisUrl.replace(/:\/\/.*@/, '://***@')}).`));
}

lines.forEach(line => console.log(line));

if (!redisUrl) {
  console.log(`\n${warn('Skipping the Redis connection test because REDIS_URL is not set.')}\n`);
  process.exit(failed ? 1 : 0);
}

(async () => {
  try {
    const { createClient } = require('redis');
    const client = createClient({ url: redisUrl });
    client.on('error', () => {});
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    console.log(`\n${ok(`Redis reachable (PING -> ${pong}).`)}\n`);
  } catch (error) {
    failed = true;
    console.log(`\n${bad(`Redis not reachable: ${error.message}`)}`);
    console.log('       sudo apt install -y redis-server && sudo systemctl enable --now redis-server\n');
  }
  process.exit(failed ? 1 : 0);
})();
