const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');

const config = require('../server/config');
const fileService = require('../server/services/fileService');

async function withTempRoot(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-zip-test-'));
  const previousRoot = config.fileRoot;
  config.fileRoot = root;
  try {
    await fn(root);
  } finally {
    config.fileRoot = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

function writeZip(filePath, entries) {
  const zip = new AdmZip();
  for (const [name, value] of entries) zip.addFile(name, Buffer.from(value));
  zip.writeZip(filePath);
}

test('extractZip extracts normal files inside the selected directory', async () => {
  await withTempRoot(async root => {
    await fs.mkdir(path.join(root, 'archives'));
    await fs.mkdir(path.join(root, 'out'));
    writeZip(path.join(root, 'archives', 'safe.zip'), [['nested/hello.txt', 'hello world']]);
    await fileService.extractZip('archives/safe.zip', 'out');
    assert.equal(await fs.readFile(path.join(root, 'out', 'nested', 'hello.txt'), 'utf8'), 'hello world');
  });
});

test('validateZipEntryName rejects traversal and absolute paths', () => {
  assert.deepEqual(fileService.validateZipEntryName('nested/safe.txt'), ['nested', 'safe.txt']);
  assert.throws(() => fileService.validateZipEntryName('../escape.txt'), /escapes|absolute|invalid/i);
  assert.throws(() => fileService.validateZipEntryName('/etc/passwd'), /escapes|absolute|invalid/i);
  assert.throws(() => fileService.validateZipEntryName('C:/Windows/win.ini'), /escapes|absolute|invalid/i);
  assert.throws(() => fileService.validateZipEntryName('nested/../escape.txt'), /escapes|absolute|invalid/i);
});

test('extractZip refuses to follow symlinks already inside the destination', async t => {
  if (process.platform === 'win32') t.skip('Symlink creation requires elevated permissions on some Windows hosts');
  await withTempRoot(async root => {
    const destination = path.join(root, 'out');
    const outside = path.join(root, 'outside');
    await fs.mkdir(destination);
    await fs.mkdir(outside);
    try {
      await fs.symlink(outside, path.join(destination, 'linked'));
    } catch {
      t.skip('This host does not permit symlink creation');
      return;
    }
    writeZip(path.join(root, 'through-link.zip'), [['linked/owned.txt', 'not allowed']]);
    await assert.rejects(fileService.extractZip('through-link.zip', 'out'), /symbolic link|symlink/i);
    await assert.rejects(fs.access(path.join(outside, 'owned.txt')), { code: 'ENOENT' });
  });
});

test('extractZip does not silently overwrite existing files', async () => {
  await withTempRoot(async root => {
    await fs.mkdir(path.join(root, 'out'));
    await fs.writeFile(path.join(root, 'out', 'present.txt'), 'original');
    writeZip(path.join(root, 'collision.zip'), [['present.txt', 'replacement']]);
    await assert.rejects(fileService.extractZip('collision.zip', 'out'), /overwrite|exist/i);
    assert.equal(await fs.readFile(path.join(root, 'out', 'present.txt'), 'utf8'), 'original');
  });
});
