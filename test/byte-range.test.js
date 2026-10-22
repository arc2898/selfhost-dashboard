const test = require('node:test');
const assert = require('node:assert/strict');
const parseByteRange = require('../server/utils/byteRange');

test('parses explicit and open-ended byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
});

test('parses suffix ranges and clamps the end to file length', () => {
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=8-200', 10), { start: 8, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-200', 10), { start: 0, end: 9 });
});

test('rejects malformed, multiple, negative, and out-of-bounds ranges', () => {
  for (const header of ['bytes=10-10', 'bytes=5-2', 'bytes=-0', 'bytes=abc-def', 'bytes=1-2,4-5', 'items=1-2', 'bytes=-', 'bytes=1--2']) {
    assert.equal(parseByteRange(header, 10), false, header);
  }
  assert.equal(parseByteRange('bytes=0-0', 0), false);
});

test('returns null when no range is requested', () => {
  assert.equal(parseByteRange(undefined, 10), null);
});
