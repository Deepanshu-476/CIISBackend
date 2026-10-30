const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const messages = [], exports = {};
  const admin = {apps: [{}], app: () => ({options: {projectId: 'test'}}), messaging: () => ({sendEachForMulticast: async message => {messages.push(message); return {successCount: 1, failureCount: 0, responses: [{success: true}]};}})};
  vm.runInNewContext(fs.readFileSync('HR-CDS/utils/firebasePushService.js', 'utf8'), {
    exports, __dirname: '/test', process: {env: {}, cwd: () => '/test'}, console, setTimeout,
    require: name => name === 'firebase-admin' ? admin : name.includes('Device') ? {find: () => ({select: async () => [{deviceToken: 'fake-device-token', userId: 'user'}]})} : name === 'fs' ? fs : name === 'path' ? require('node:path') : {},
  });
  return {send: exports.sendPushToUsers, messages};
}

test('task reminder background push requests Android reminder sound channel and APNs default sound', async () => {
  const f = fixture();
  const result = await f.send({userIds: ['user'], title: 'Reminder', body: 'Due soon', data: {type: 'task_due_reminder', taskId: 'task'}});
  assert.equal(result.sent, 1);
  const message = f.messages[0];
  assert.equal(message.android.priority, 'high');
  assert.equal(message.android.notification.channelId, 'ciis_task_reminders_v1');
  assert.equal(message.android.notification.sound, 'default');
  assert.equal(message.apns.payload.aps.sound, 'default');
  assert.equal(message.notification.title, 'Reminder');
  assert.equal(message.data.taskId, 'task');
});

test('pending reminders use the reminder channel; unrelated alerts retain their channel', async () => {
  const f = fixture();
  await f.send({userIds: ['user'], data: {type: 'task_pending_reminder'}});
  await f.send({userIds: ['user'], data: {type: 'attendance_clock_in'}});
  assert.equal(f.messages[0].android.notification.channelId, 'ciis_task_reminders_v1');
  assert.equal(f.messages[1].android.notification.channelId, 'ciis_high_priority');
});

test('call push remains data-only and keeps its call delivery settings', async () => {
  const f = fixture();
  await f.send({userIds: ['user'], data: {type: 'call:incoming'}});
  assert.equal(f.messages[0].notification, undefined);
  assert.equal(f.messages[0].android.ttl, 45000);
});
