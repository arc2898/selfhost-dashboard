const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const config = require('../server/config');
const { safeResolve } = require('../server/middleware/security');

async function withTempRoot(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selfhost-dashboard-'));
  const previousRoot = config.fileRoot;
  config.fileRoot = root;
  try {
    await fn(root);
  } finally {
    config.fileRoot = previousRoot;
  }
}

test('safeResolve rejects path traversal and symlink escapes', async () => {
  await withTempRoot(async root => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'selfhost-outside-'));
    await fs.mkdir(path.join(root, 'nested'), { recursive: true });
    await fs.symlink(outside, path.join(root, 'escape-link'));

    assert.throws(() => safeResolve('../../etc/passwd'), /outside|escape/i);
    assert.throws(() => safeResolve('escape-link/secret.txt'), /outside|escape/i);
  });
});
