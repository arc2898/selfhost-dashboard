const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const config = require('../server/config');
const { safeResolve, safeResolveInRoot } = require('../server/middleware/security');

async function withTempRoot(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selfhost-dashboard-'));
  const previousRoot = config.fileRoot;
  config.fileRoot = root;
  try {
    await fn(root);
  } finally {
    config.fileRoot = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('safeResolve rejects path traversal', async () => {
  await withTempRoot(async () => {
    assert.throws(() => safeResolve('../../etc/passwd'), /outside|escape/i);
    assert.throws(() => safeResolve('/etc/passwd'), /outside|escape/i);
    assert.throws(() => safeResolve('C:/Windows/win.ini'), /outside|escape/i);
    assert.throws(() => safeResolve(String.fromCharCode(0)), /outside|escape/i);
  });
});

test('safeResolve rejects symlink escapes and dangling symlinks', async () => {
  await withTempRoot(async root => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'selfhost-outside-'));
    try {
      await fs.mkdir(path.join(root, 'nested'), { recursive: true });
      try {
        await fs.symlink(outside, path.join(root, 'escape-link'), 'junction');
        await fs.symlink(path.join(outside, 'missing-target'), path.join(root, 'dangling-link'), 'file');
      } catch {
        // Some Windows runners do not grant symlink creation privileges.
        return;
      }
      assert.throws(() => safeResolve('escape-link/secret.txt'), /outside|escape/i);
      assert.throws(() => safeResolve('dangling-link'), /dangling|escape/i);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test('safeResolveInRoot enforces each configured media root independently', async () => {
  await withTempRoot(async root => {
    const media = path.join(root, 'media');
    await fs.mkdir(media);
    await fs.writeFile(path.join(media, 'movie.mp4'), 'sample');
    assert.equal(await fs.realpath(safeResolveInRoot(media, 'movie.mp4')), await fs.realpath(path.join(media, 'movie.mp4')));
    assert.throws(() => safeResolveInRoot(media, '../secret.txt'), /outside|escape/i);
  });
});
