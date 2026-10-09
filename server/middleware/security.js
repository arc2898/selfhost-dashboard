const fs = require('fs');
const path = require('path');
const config = require('../config');

function ensureWithinRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative))) {
    return;
  }
  const err = new Error('Path escapes the configured file root');
  err.code = 'EACCESS_PATH';
  throw err;
}

function realRoot() {
  const root = path.resolve(config.fileRoot);
  return fs.existsSync(root) ? fs.realpathSync(root) : root;
}

/**
 * Resolves a user-supplied relative path against FILE_ROOT and guarantees
 * the result cannot escape FILE_ROOT, including symlink-based escapes.
 * Throws if the resulting path would fall outside the root.
 */
function safeResolve(relativePath = '') {
  const root = realRoot();
  const cleaned = (relativePath || '').replace(/\\/g, '/');
  const resolved = path.resolve(root, cleaned || '.');
  ensureWithinRoot(root, resolved);

  const relToRoot = path.relative(root, resolved);
  const parts = relToRoot ? relToRoot.split(path.sep).filter(Boolean) : [];
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        const actual = fs.realpathSync(current);
        ensureWithinRoot(root, actual);
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }

  return resolved;
}

function toRelative(absolutePath) {
  const root = realRoot();
  return path.relative(root, absolutePath).replace(/\\/g, '/') || '.';
}

module.exports = { safeResolve, toRelative };
