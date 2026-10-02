const path = require('path');
const config = require('../config');

/**
 * Resolves a user-supplied relative path against FILE_ROOT and guarantees
 * the result cannot escape FILE_ROOT (blocks "../../etc/passwd" style attacks,
 * absolute path injection, and symlink-adjacent tricks at the string level).
 * Throws if the resulting path would fall outside the root.
 */
function safeResolve(relativePath = '') {
  const cleaned = (relativePath || '').replace(/\\/g, '/');
  const resolved = path.resolve(config.fileRoot, '.' + path.posix.sep + cleaned);
  const rootWithSep = config.fileRoot.endsWith(path.sep) ? config.fileRoot : config.fileRoot + path.sep;
  if (resolved !== config.fileRoot && !resolved.startsWith(rootWithSep)) {
    const err = new Error('Path escapes the configured file root');
    err.code = 'EACCESS_PATH';
    throw err;
  }
  return resolved;
}

function toRelative(absolutePath) {
  return path.relative(config.fileRoot, absolutePath).replace(/\\/g, '/') || '.';
}

module.exports = { safeResolve, toRelative };
