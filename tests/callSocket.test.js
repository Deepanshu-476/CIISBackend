const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const pushes = [], emitted = [], queries = [], timers = [], history = [];
  const roomsStore = new Map();
  const io = {
    sockets: {adapter: {rooms: new Map()}, sockets: new Map()},
    to: room => ({emit: (event, data) => emitted.push({room, event, data})}),
    in: () => ({fetchSockets: async () => []}),
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../HR-CDS/chat/socket/callSocket'), 'utf8'), {
    module, require(name) {
      if (name.includes('presence')) return {
        isUserOnline: async () => false,
      };
      if (name.includes('callStore')) return {
        save: async (room) => { roomsStore.set(room.callId, JSON.parse(JSON.stringify(room))); return room; },
        get: async (callId) => roomsStore.has(callId) ? JSON.parse(JSON.stringify(roomsStore.get(callId))) : null,
        remove: async (callId) => roomsStore.delete(callId),
        listAll: async () => Array.from(roomsStore.values()),
        claimAnswer: async (callId, userId, socketId) => {
          const room = roomsStore.get(callId);
          if (!room) return { success: false, reason: 'Call not found' };
          const p = room.participants?.[userId];
          if (!p) return { success: false, reason: 'Not a participant' };
          if (p.status === 'joined' && p.socketId && p.socketId !== socketId) {
            return { success: false, reason: 'Already answered on another device', alreadyAnswered: true };
          }
          p.status = 'joined';
          p.socketId = socketId;
          room.answeredAt = room.answeredAt || Date.now();
          return { success: true, room };
        },
        withCallLock: async (callId, fn) => fn(),
      };
      if (name.includes('models/User')) return {findOne: query => {
        queries.push(query);
        return {select: () => ({lean: async () => query.company === 'company' && ['receiver', 'second'].includes(query._id) ? {_id: query._id} : null})};
      }};
      if (name.includes('firebasePushService')) return {sendPushToUsers: async payload => { pushes.push(payload); return {success: true}; }};
      if (name.includes('callHistory')) return {
        recordCallStarted: room => history.push(['started', room.callId]),
        recordParticipantsAdded: (callId, ids) => history.push(['added', callId, ids]),
        recordCallAnswered: (callId, userId) => history.push(['answered', callId, userId]),
        recordCallFinished: room => history.push(['finished', room.callId, room.answeredAt ? 'answered' : 'unanswered']),
      };
      throw new Error(name);
    }, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, Date, console,
  });
  function socket(userId, companyId = 'company', socketIdSuffix = '') {
    const handlers = new Map();
    const id = 'sock-' + userId + (socketIdSuffix ? '-' + socketIdSuffix : '');
    const s = {
      id,
      userId,
      companyId,
      user: {_id: userId, name: userId},
      data: {userId, companyId, user: {_id: userId, name: userId}},
      on: (event, handler) => handlers.set(event, handler),
      emit: (event, data) => emitted.push({room: userId, event, data}),
      to: room => ({emit: (event, data) => emitted.push({room, event, data})}),
    };
    module.exports(io, s);
    return {
      id,
      userId,
      run: (event, ...args) => handlers.get(event)(...args),
    };
  }
  return {socket, pushes, emitted, queries, timers, history, roomsStore};
}
const invite = {callId: 'call-1', callType: 'video', conversationId: 'conversation', participantIds: ['receiver']};

test('offline receiver gets a push invitation with metadata and expiry', async () => {
  const f = fixture();
  await f.socket('caller').run('call:invite', invite);
  const push = f.pushes.find(p => p.data.type === 'call:incoming');
  assert.ok(push, 'must push even when receiver has no socket or recent lastSeen');
  assert.deepEqual(Array.from(push.userIds), ['receiver']);
  assert.equal(push.data.fromUser._id, 'caller');
  assert.equal(push.data.conversationId, 'conversation');
  assert.equal(push.data.callType, 'video');
  assert.ok(push.data.expiresAt > Date.now());
  assert.equal(f.queries[0].company, 'company');
});

test('cold-started receiver restores and accepts only its own invitation', async () => {
  const f = fixture();
  await f.socket('caller').run('call:invite', invite);
  const receiver = f.socket('receiver');
  let restored;
  await receiver.run('call:sync-incoming', {callId: invite.callId}, result => { restored = result; });
  assert.equal(restored.success, true);
  assert.equal(restored.call.fromUserId, 'caller');
  const stranger = f.socket('stranger');
  await stranger.run('call:sync-incoming', {callId: invite.callId}, result => assert.equal(result.success, false));
  await stranger.run('call:accept', {callId: invite.callId});
  assert.ok(f.emitted.some(e => e.room === 'stranger' && e.event === 'call:unavailable'));
  await receiver.run('call:accept', {callId: invite.callId});
  assert.ok(f.emitted.some(e => (e.room === receiver.id || e.room === 'user:receiver') && e.event === 'call:joined'));
  assert.ok(f.pushes.some(p => p.data.type === 'call:cancelled' && p.userIds.includes('receiver')));
});

test('caller hangup cancels background ringing and prevents stale restoration', async () => {
  const f = fixture();
  const caller = f.socket('caller');
  await caller.run('call:invite', invite);
  await caller.run('call:end', {callId: invite.callId});
  assert.ok(f.pushes.some(p => p.data.type === 'call:cancelled' && p.userIds.includes('receiver')));
  await f.socket('receiver').run('call:sync-incoming', {callId: invite.callId}, result => assert.equal(result.success, false));
});

test('ring timeout clears the invitation and background notification', async () => {
  const f = fixture();
  await f.socket('caller').run('call:invite', invite);
  await f.timers[0]();
  assert.ok(f.pushes.some(p => p.data.type === 'call:cancelled'));
  await f.socket('receiver').run('call:sync-incoming', {}, result => assert.equal(result.success, false));
});

test('cross-company recipients are unavailable', async () => {
  const f = fixture();
  await f.socket('caller', 'other-company').run('call:invite', invite);
  assert.equal(f.pushes.length, 0);
  assert.ok(f.emitted.some(e => e.event === 'call:unavailable'));
});

test('group add-participants push uses the existing call type', async () => {
  const f = fixture();
  const caller = f.socket('caller');
  await caller.run('call:invite', invite);
  await f.socket('receiver').run('call:accept', {callId: invite.callId});
  await caller.run('call:add-participants', {callId: invite.callId, participantIds: ['second']});
  const push = f.pushes.find(p => p.data.type === 'call:incoming' && p.userIds.includes('second'));
  assert.ok(push);
  assert.equal(push.data.callType, 'video');
  assert.equal(push.data.fromUser._id, 'caller');
});

test('call history records start, answer and finish', async () => {
  const f = fixture();
  const caller = f.socket('caller');
  const receiver = f.socket('receiver');
  await caller.run('call:invite', invite);
  await receiver.run('call:accept', {callId: 'call-1'});
  await caller.run('call:end', {callId: 'call-1'});
  assert.deepEqual(f.history.map(item => item[0]), ['started', 'answered', 'finished']);
  assert.equal(f.history[2][2], 'answered');
});

test('unanswered call is recorded as finished when the ring times out', async () => {
  const f = fixture();
  await f.socket('caller').run('call:invite', invite);
  await f.timers[0]();
  assert.deepEqual(f.history.map(item => item[0]), ['started', 'finished']);
  assert.equal(f.history[1][2], 'unanswered');
});

test('multi-device: device 1 answers, device 2 receives answered-elsewhere', async () => {
  const f = fixture();
  const caller = f.socket('caller');
  await caller.run('call:invite', invite);

  const deviceApp = f.socket('receiver', 'company', 'app');
  const deviceWeb = f.socket('receiver', 'company', 'web');

  await deviceApp.run('call:accept', {callId: 'call-1'});

  // Only the winning socket gets call:joined
  assert.ok(f.emitted.some(e => e.room === deviceApp.id && e.event === 'call:joined'));
  assert.ok(!f.emitted.some(e => e.room === deviceWeb.id && e.event === 'call:joined'));

  // Other devices of the same user receive call:answered-elsewhere
  assert.ok(f.emitted.some(e => e.room === 'user:receiver' && e.event === 'call:answered-elsewhere'));

  // If stale device later rejects, it should be ignored
  await deviceWeb.run('call:reject', {callId: 'call-1'});
  const room = await f.roomsStore.get('call-1');
  assert.equal(room.participants.receiver.status, 'joined');
});
