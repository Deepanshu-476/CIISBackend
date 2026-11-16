const { getRedis } = require('../../socket/redis');
const memory = new Map();                 // fallback when Redis is off
const KEY = (id) => `ciis:call:${id}`;
const TTL_SEC = 4 * 60 * 60;              // a call room lives max 4h

// participants stored as a plain object { [userId]: {status, user, expiresAt, socketId} }
const save = async (room) => {
  if (!room?.callId) return;
  const r = getRedis();
  const plain = { ...room, ringTimeout: undefined };
  if (!r) { memory.set(String(room.callId), plain); return; }
  await r.set(KEY(room.callId), JSON.stringify(plain), { EX: TTL_SEC });
  await r.sAdd('ciis:calls', String(room.callId));
};

const get = async (callId) => {
  if (!callId) return null;
  const r = getRedis();
  if (!r) return memory.get(String(callId)) || null;
  const raw = await r.get(KEY(callId));
  return raw ? JSON.parse(raw) : null;
};

const ANSWER_KEY = (callId, userId) => `ciis:call:${callId}:answer:${userId}`;

// The answer claim must die with the participant's place in the call. While it lives, that user's
// next accept in the SAME call (re-invited from "Add people"/"Call again") loses the claim and the
// server tells their phone the call was answered elsewhere, so they can never pick up again.
const releaseAnswer = async (callId, userId) => {
  const r = getRedis();
  if (!r || !callId || !userId) return;
  await r.del(ANSWER_KEY(callId, userId)).catch(() => {});
};

const releaseAnswers = async (callId, userIds = []) => {
  const r = getRedis();
  if (!r || !callId || !userIds.length) return;
  await Promise.all(userIds.filter(Boolean).map(userId => r.del(ANSWER_KEY(callId, userId)).catch(() => {})));
};

const remove = async (callId, participantIds = []) => {
  if (!callId) return;
  const r = getRedis();
  if (!r) { memory.delete(String(callId)); return; }
  await releaseAnswers(callId, participantIds);
  await r.del(KEY(callId));
  await r.sRem('ciis:calls', String(callId));
};

const listAll = async () => {               // used by sync-incoming / disconnect
  const r = getRedis();
  if (!r) return [...memory.values()];
  const ids = await r.sMembers('ciis:calls');
  const rooms = await Promise.all(ids.map(get));
  ids.forEach((id, i) => { if (!rooms[i]) r.sRem('ciis:calls', id); });   // clean expired
  return rooms.filter(Boolean);
};

// Atomic "first device wins" when two devices accept at the same time
const claimAnswer = async (callId, userId, socketId) => {
  const r = getRedis();
  if (!r) return true;   // single process: JS is single-threaded, handled by status check
  const ok = await r.set(ANSWER_KEY(callId, userId), socketId, { NX: true, EX: TTL_SEC });
  return ok === 'OK';
};

const withCallLock = async (callId, fn) => {
  const r = getRedis();
  if (!r || !callId) return await fn();
  const lockKey = `ciis:call:${callId}:lock`;
  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    const acquired = await r.set(lockKey, '1', { NX: true, PX: 2000 });
    if (acquired === 'OK') {
      try {
        return await fn();
      } finally {
        await r.del(lockKey).catch(() => {});
      }
    }
    await new Promise(res => setTimeout(res, 30 + Math.random() * 40));
  }
  return await fn();
};

module.exports = { save, get, remove, listAll, claimAnswer, releaseAnswer, releaseAnswers, withCallLock };
