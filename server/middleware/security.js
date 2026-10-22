const fs = require('fs');
const path = require('path');
const config = require('../config');

function ensureWithinRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) return;
  const err = new Error('Path escapes the configured root');
  err.code = 'EACCESS_PATH';
  throw err;
}

function rootRealPath(rootPath) {
  const root = path.resolve(rootPath);
  return fs.existsSync(root) ? fs.realpathSync(root) : root;
}

function safeResolveInRoot(rootPath, relativePath = '') {
  const root = rootRealPath(rootPath);
  if (typeof relativePath !== 'string') {
    const err = new Error('Path must be a string');
    err.code = 'EACCESS_PATH';
    throw err;
  }

  const cleaned = relativePath.replace(/\\/g, '/');
  const hasDrivePrefix = cleaned.length >= 2 && /^[a-zA-Z]:/.test(cleaned);
  if (cleaned.includes(String.fromCharCode(0)) || path.posix.isAbsolute(cleaned) || hasDrivePrefix) {
    const err = new Error('Path escapes the configured root');
    err.code = 'EACCESS_PATH';
    throw err;
  }

  const resolved = path.resolve(root, cleaned || '.');
  ensureWithinRoot(root, resolved);
  const relative = path.relative(root, resolved);
  let current = root;
  for (const part of (relative ? relative.split(path.sep).filter(Boolean) : [])) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        let actual;
        try {
          actual = fs.realpathSync(current);
        } catch {
          const err = new Error('Dangling symbolic links are not allowed');
          err.code = 'EACCESS_PATH';
          throw err;
        }
        ensureWithinRoot(root, actual);
      }
    } catch (error) {
      if (error && error.code === 'EACCESS_PATH') throw error;
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  return resolved;
}

function safeResolve(relativePath = '') {
  return safeResolveInRoot(config.fileRoot, relativePath);
}

function toRelative(absolutePath) {
  const root = rootRealPath(config.fileRoot);
  return path.relative(root, absolutePath).replace(/\\/g, '/') || '.';
}

module.exports = { safeResolve, safeResolveInRoot, toRelative };
