const test = require('node:test');
const assert = require('node:assert/strict');
const { getEmailFailure } = require('../utils/emailFailure');
test('Gmail DATA quota response gives actionable error without exposing SMTP details', () => {
  const result = getEmailFailure({ response: '550-5.4.5 Daily user sending limit exceeded private-smtp-id' });
  assert.equal(result.errorCode, 'EMAIL_QUOTA_EXCEEDED');
  assert.match(result.message, /24 hours/);
  assert.doesNotMatch(result.message, /private-smtp-id/);
});
test('provider outbound block is distinguished from quota', () => {
  assert.equal(getEmailFailure({ message: '554 5.7.1 Outbound sending is disabled for this account' }).errorCode, 'EMAIL_SENDING_DISABLED');
});
test('unknown SMTP failures use a safe generic message', () => {
  assert.equal(getEmailFailure({ message: 'secret SMTP diagnostic' }).errorCode, 'EMAIL_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(getEmailFailure({ message: 'secret SMTP diagnostic' }).message, /secret/);
});
