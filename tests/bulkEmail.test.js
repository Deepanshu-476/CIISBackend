const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSimpleHtml, isValidEmail, getLimits, companyHasPage } = require('../HR-CDS/utils/bulkEmailService');

test('simple-mode email escapes what the user typed and keeps paragraphs', () => {
  const html = buildSimpleHtml({
    heading: '<script>alert(1)</script>',
    body: 'Hi {{name}},\n\nLine one\nLine two',
    buttonText: 'Open',
    buttonUrl: 'javascript:alert(1)',
    footer: 'Acme & Co',
  }, 'Test <Co>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Line one<br>Line two'));
  assert.ok(html.includes('Test &lt;Co&gt;'));
  assert.ok(html.includes('Acme &amp; Co'));
  assert.ok(!html.includes('javascript:'), 'non-http button links are dropped');
  assert.ok(buildSimpleHtml({ buttonText: 'Go', buttonUrl: 'https://example.com' }).includes('href="https://example.com"'));
});

test('email validation and company limits', () => {
  assert.equal(isValidEmail('Anil@Example.com'), true);
  assert.equal(isValidEmail('anil@example'), false);
  assert.equal(isValidEmail('a b@example.com'), false);
  assert.deepEqual(getLimits({}), { daily: 100, monthly: 2000 });
  assert.deepEqual(getLimits({ bulkEmailLimits: { daily: 0, monthly: 50 } }), { daily: 0, monthly: 50 });
  assert.equal(companyHasPage({ allowedPages: ['dashboard', 'bulk-email'] }), true);
  assert.equal(companyHasPage({ allowedPages: ['dashboard'] }), false);
});
