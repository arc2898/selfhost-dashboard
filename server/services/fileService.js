const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const mime = require('mime-types');
const { safeResolve, toRelative } = require('../middleware/security');

const TEXT_EXT = new Set(['.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.htm',
  '.py', '.sh', '.yml', '.yaml', '.xml', '.env', '.ini', '.conf', '.log', '.c', '.cpp', '.h', '.java',
  '.go', '.rs', '.rb', '.php', '.sql', '.gitignore', '.toml']);

async function statEntry(fullPath, name) {
  const st = await fsp.stat(fullPath);
  const ext = path.extname(name).toLowerCase();
  return {
    name,
    isDirectory: st.isDirectory(),
    sizeBytes: st.size,
    modifiedAt: st.mtime,
    createdAt: st.birthtime,
    permissions: '0' + (st.mode & 0o777).toString(8),
    mimeType: st.isDirectory() ? null : (mime.lookup(ext) || 'application/octet-stream'),
    extension: ext,
    isText: TEXT_EXT.has(ext),
    isHidden: name.startsWith('.'),
  };
}

async function listDirectory(relPath = '.', { includeHidden = false, sortBy = 'name', order = 'asc' } = {}) {
  const dir = safeResolve(relPath);
  const names = await fsp.readdir(dir);
  let entries = await Promise.all(
    names
      .filter(n => includeHidden || !n.startsWith('.'))
      .map(async n => statEntry(path.join(dir, n), n))
  );

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => a.sizeBytes - b.sizeBytes,
    modified: (a, b) => new Date(a.modifiedAt) - new Date(b.modifiedAt),
    type: (a, b) => (a.extension || '').localeCompare(b.extension || ''),
  };
  entries.sort(sorters[sortBy] || sorters.name);
  if (order === 'desc') entries.reverse();
  // Folders first, always
  entries.sort((a, b) => (b.isDirectory - a.isDirectory));

  const usage = await getRootUsage();
  return { path: toRelative(dir), entries, storage: usage };
}

async function getRootUsage() {
  // Cheap approximation: report FILE_ROOT's filesystem usage via statfs where available.
  try {
    const stats = await fsp.statfs(require('../config').fileRoot);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    return { totalBytes: total, freeBytes: free, usedBytes: total - free };
  } catch {
    return null;
  }
}

async function mkdir(relPath) {
  const dir = safeResolve(relPath);
  await fsp.mkdir(dir, { recursive: false });
}

async function createFile(relPath) {
  const file = safeResolve(relPath);
  const handle = await fsp.open(file, 'wx');
  await handle.close();
}

async function rename(relPath, newName) {
  if (/[\\/]/.test(newName)) throw Object.assign(new Error('Invalid name'), { status: 400 });
  const from = safeResolve(relPath);
  const to = path.join(path.dirname(from), newName);
  safeResolve(toRelative(to));
  await fsp.rename(from, to);
}

async function remove(relPaths) {
  for (const p of relPaths) {
    const full = safeResolve(p);
    await fsp.rm(full, { recursive: true, force: false });
  }
}

async function copyEntries(relPaths, destRelDir) {
  const destDir = safeResolve(destRelDir);
  for (const p of relPaths) {
    const src = safeResolve(p);
    const dest = path.join(destDir, path.basename(src));
    await fsp.cp(src, dest, { recursive: true, errorOnExist: true });
  }
}

async function moveEntries(relPaths, destRelDir) {
  const destDir = safeResolve(destRelDir);
  for (const p of relPaths) {
    const src = safeResolve(p);
    const dest = path.join(destDir, path.basename(src));
    await fsp.rename(src, dest);
  }
}

async function duplicate(relPath) {
  const src = safeResolve(relPath);
  const ext = path.extname(src);
  const base = path.basename(src, ext);
  const dir = path.dirname(src);
  let candidate = path.join(dir, `${base} (copy)${ext}`);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (copy ${i})${ext}`);
    i++;
  }
  await fsp.cp(src, candidate, { recursive: true });
  return toRelative(candidate);
}

async function readTextFile(relPath) {
  const full = safeResolve(relPath);
  const st = await fsp.stat(full);
  if (st.size > 5 * 1024 * 1024) throw Object.assign(new Error('File too large to edit in-browser'), { status: 413 });
  return fsp.readFile(full, 'utf8');
}

async function writeTextFile(relPath, content) {
  const full = safeResolve(relPath);
  await fsp.writeFile(full, content, 'utf8');
}

function absolutePath(relPath) {
  return safeResolve(relPath);
}

async function search(relDir, query, results = [], depth = 0) {
  if (depth > 12) return results; // guard against runaway recursion
  const dir = safeResolve(relDir);
  const names = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of names) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.toLowerCase().includes(query.toLowerCase())) {
      results.push(toRelative(path.join(dir, entry.name)));
    }
    if (entry.isDirectory() && results.length < 500) {
      await search(toRelative(path.join(dir, entry.name)), query, results, depth + 1);
    }
    if (results.length >= 500) break;
  }
  return results;
}

function zipDirectoryToStream(relPath, res) {
  const full = safeResolve(relPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => res.destroy(err));
  archive.pipe(res);
  archive.directory(full, path.basename(full));
  archive.finalize();
}

function zipMultipleToStream(relPaths, res, zipName) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => res.destroy(err));
  archive.pipe(res);
  for (const p of relPaths) {
    const full = safeResolve(p);
    const st = fs.statSync(full);
    if (st.isDirectory()) archive.directory(full, path.basename(full));
    else archive.file(full, { name: path.basename(full) });
  }
  archive.finalize();
}

async function extractZip(relPath, destRelDir) {
  const zipPath = safeResolve(relPath);
  const destDir = safeResolve(destRelDir);
  const zip = new AdmZip(zipPath);

  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    const normalized = path.posix.normalize(entryName);
    if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
      throw Object.assign(new Error('Zip entry escapes the extraction directory'), { status: 400 });
    }
    const target = path.resolve(destDir, entryName);
    const relative = path.relative(destDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw Object.assign(new Error('Zip entry escapes the extraction directory'), { status: 400 });
    }
  }

  zip.extractAllTo(destDir, true);
}

module.exports = {
  listDirectory, mkdir, createFile, rename, remove, copyEntries, moveEntries,
  duplicate, readTextFile, writeTextFile, absolutePath, search,
  zipDirectoryToStream, zipMultipleToStream, extractZip, statEntry,
};
