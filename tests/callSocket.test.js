const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const pushes = [], emitted = [], queries = [], timers = [], history = [];
  const io = {sockets: {adapter: {rooms: new Map()}, sockets: new Map()}, to: room => ({emit: (event, data) => emitted.push({room, event, data})})};
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../HR-CDS/chat/socket/callSocket'), 'utf8'), {
    module, require(name) {
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
  function socket(userId, companyId = 'company') {
    const handlers = new Map();
    const s = {userId, companyId, user: {_id: userId, name: userId}, on: (event, handler) => handlers.set(event, handler),
      emit: (event, data) => emitted.push({room: userId, event, data})};
    module.exports(io, s);
    return {run: (event, ...args) => handlers.get(event)(...args)};
  }
  return {socket, pushes, emitted, queries, timers, history};
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
  receiver.run('call:sync-incoming', {callId: invite.callId}, result => { restored = result; });
  assert.equal(restored.success, true);
  assert.equal(restored.call.fromUserId, 'caller');
  const stranger = f.socket('stranger');
  stranger.run('call:sync-incoming', {callId: invite.callId}, result => assert.equal(result.success, false));
  stranger.run('call:accept', {callId: invite.callId});
  assert.ok(f.emitted.some(e => e.room === 'stranger' && e.event === 'call:unavailable'));
  receiver.run('call:accept', {callId: invite.callId});
  assert.ok(f.emitted.some(e => e.room === 'user:receiver' && e.event === 'call:joined'));
  assert.ok(f.pushes.some(p => p.data.type === 'call:cancelled' && p.userIds.includes('receiver')));
});

test('caller hangup cancels background ringing and prevents stale restoration', async () => {
  const f = fixture();
  const caller = f.socket('caller');
  await caller.run('call:invite', invite);
  caller.run('call:end', {callId: invite.callId});
  assert.ok(f.pushes.some(p => p.data.type === 'call:cancelled' && p.userIds.includes('receiver')));
  f.socket('receiver').run('call:sync-incoming', {callId: invite.callId}, result => assert.equal(result.success, false));
});

test('ring timeout clears the invitation and background notification', async () => {
  const f = fixture();
  await f.socket('caller').run('call:invite', invite);
  f.timers[0]();
  assert.ok(f.pushes.some(p => p.data.type === 'call:cancelled'));
  f.socket('receiver').run('call:sync-incoming', {}, result => assert.equal(result.success, false));
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
  f.socket('receiver').run('call:accept', {callId: invite.callId});
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
  receiver.run('call:accept', {callId: 'call-1'});
  caller.run('call:end', {callId: 'call-1'});
  assert.deepEqual(f.history.map(item => item[0]), ['started', 'answered', 'finished']);
  assert.equal(f.history[2][2], 'answered');
});

test('unanswered call is recorded as finished when the ring times out', async () => {
  const f = fixture();
  await f.socket('caller').run('call:invite', invite);
  f.timers[0]();
  assert.deepEqual(f.history.map(item => item[0]), ['started', 'finished']);
  assert.equal(f.history[1][2], 'unanswered');
});
