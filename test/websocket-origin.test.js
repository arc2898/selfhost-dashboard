const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedWebSocketOrigin } = require('../server/ws/origin');

test('accepts same-origin browser handshakes', () => {
  assert.equal(isAllowedWebSocketOrigin('https://dashboard.example.test', 'dashboard.example.test'), true);
  assert.equal(isAllowedWebSocketOrigin('http://localhost:8443', 'localhost:8443'), true);
});

test('rejects cross-origin, invalid, and opaque origins', () => {
  assert.equal(isAllowedWebSocketOrigin('https://attacker.example', 'dashboard.example.test'), false);
  assert.equal(isAllowedWebSocketOrigin('file:///tmp/page.html', 'dashboard.example.test'), false);
  assert.equal(isAllowedWebSocketOrigin('not a URL', 'dashboard.example.test'), false);
});

test('allows non-browser clients without Origin; cookie authentication remains required', () => {
  assert.equal(isAllowedWebSocketOrigin(undefined, 'dashboard.example.test'), true);
});
