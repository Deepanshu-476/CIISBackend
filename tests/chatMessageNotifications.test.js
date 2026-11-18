const test = require('node:test');
const assert = require('node:assert/strict');
const {chatMessageNotifications} = require('../HR-CDS/chat/utils/chatMessageNotifications');
const conversation = {_id: 'conversation', companyId: 'company', isGroup: true, groupName: 'Project', members: ['sender', 'tagged', 'other', 'muted']};
const build = overrides => chatMessageNotifications({conversation, senderId: 'sender', senderName: 'Vansh', text: '@Tagged hello', messageId: 'message', mentions: [{user: 'tagged'}], isMuted: id => id === 'muted', ...overrides});

test('tagged user receives one personal notification; others get the regular message', () => {
  const batches = build();
  assert.deepEqual(batches.map(batch => batch.userIds), [['other'], ['tagged']]);
  const mention = batches[1];
  assert.equal(mention.title, 'Vansh mentioned you in Project');
  assert.equal(mention.priority, 'high');
  assert.equal(mention.type, 'group_chat_message');
  assert.equal(mention.data.conversationId, 'conversation');
  assert.equal(mention.data.messageId, 'message');
  assert.equal(mention.data.isMention, true);
  assert.equal(mention.dedupe, false);
});

test('explicit tags notify muted chat members but never sender, outsiders or duplicate tags', () => {
  const batches = build({mentions: [{user: 'muted'}, {user: 'muted'}, {user: 'sender'}, {user: 'outsider'}]});
  assert.deepEqual(batches[1].userIds, ['muted']);
  assert.deepEqual(batches[1].data.mentionedUserIds, ['muted']);
  assert.deepEqual(batches[0].userIds, ['tagged', 'other']);
});

test('untagged messages retain mute behavior and attachment-only messages still notify', () => {
  const batches = build({mentions: [], text: '', file: 'image.jpg'});
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].userIds, ['tagged', 'other']);
  assert.equal(batches[0].message, 'Vansh: Sent an attachment');
});

test('direct chat mention keeps the existing chat navigation and delivery type', () => {
  const batches = build({conversation: {...conversation, isGroup: false, members: ['sender', {_id: 'tagged'}]}});
  assert.equal(batches.length, 1);
  assert.equal(batches[0].type, 'chat_message');
  assert.equal(batches[0].title, 'Vansh mentioned you');
});
