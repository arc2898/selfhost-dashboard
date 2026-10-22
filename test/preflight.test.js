const test = require('node:test');
const assert = require('node:assert/strict');
const { hasSecureJwtSecret } = require('../server/preflight');

test('secure JWT secret validation rejects known defaults and short secrets', () => {
  assert.equal(hasSecureJwtSecret(''), false);
  assert.equal(hasSecureJwtSecret('INSECURE_DEV_SECRET_CHANGE_ME'), false);
  assert.equal(hasSecureJwtSecret('change_this_to_a_long_random_string'), false);
  assert.equal(hasSecureJwtSecret('short-secret'), false);
});

test('secure JWT secret validation accepts a strong unique secret', () => {
  assert.equal(hasSecureJwtSecret('f'.repeat(96)), true);
});
