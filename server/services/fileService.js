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
  // lstat avoids following a symlink just to populate directory metadata.
  const st = await fsp.lstat(fullPath);
  const isSymlink = st.isSymbolicLink();
  const isDirectory = !isSymlink && st.isDirectory();
  const ext = path.extname(name).toLowerCase();
  return {
    name,
    isDirectory,
    isSymlink,
    sizeBytes: st.size,
    modifiedAt: st.mtime,
    createdAt: st.birthtime,
    permissions: '0' + (st.mode & 0o777).toString(8),
    mimeType: isDirectory || isSymlink ? null : (mime.lookup(ext) || 'application/octet-stream'),
    extension: ext,
    isText: !isSymlink && TEXT_EXT.has(ext),
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

const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function zipError(message, status = 400) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

function assertContained(base, target) {
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw zipError('Zip entry escapes the extraction directory');
  }
}

async function ensureSafeDirectory(root, target) {
  assertContained(root, target);
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fsp.mkdir(current); } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stat = await fsp.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw zipError('A symlink or non-directory blocks a safe extraction path');
    }
  }
}

async function inspectMerge(stagePath, destinationPath) {
  const entries = await fsp.readdir(stagePath, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(stagePath, entry.name);
    const target = path.join(destinationPath, entry.name);
    let existing = null;
    try { existing = await fsp.lstat(target); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && existing.isSymbolicLink()) {
      throw zipError('Extraction refuses to follow an existing symbolic link');
    }
    if (entry.isDirectory()) {
      if (existing && !existing.isDirectory()) throw zipError('Extraction would overwrite an existing file', 409);
      if (existing) await inspectMerge(source, target);
    } else if (existing) {
      throw zipError('Extraction refuses to overwrite existing files', 409);
    }
  }
}

async function mergeStaged(stagePath, destinationPath, destinationRoot) {
  const entries = await fsp.readdir(stagePath, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(stagePath, entry.name);
    const target = path.join(destinationPath, entry.name);
    assertContained(destinationRoot, target);
    if (entry.isDirectory()) {
      await ensureSafeDirectory(destinationRoot, target);
      await mergeStaged(source, target, destinationRoot);
    } else {
      await ensureSafeDirectory(destinationRoot, path.dirname(target));
      await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    }
  }
}

async function extractZip(relPath, destRelDir) {
  const zipPath = safeResolve(relPath);
  const destDir = safeResolve(destRelDir);
  const zipStat = await fsp.stat(zipPath);
  if (!zipStat.isFile()) throw zipError('The archive path must be a file');
  if (zipStat.size > MAX_ZIP_TOTAL_BYTES) throw zipError('Archive exceeds the compressed-size limit', 413);
  const fileRoot = fs.realpathSync(require('../config').fileRoot);
  await ensureSafeDirectory(fileRoot, destDir);

  const zip = new AdmZip(zipPath);
  const validated = [];
  let totalBytes = 0;
  for (const entry of zip.getEntries()) {
    const rawName = String(entry.entryName || '').replace(/\\/g, '/');
    if (!rawName || rawName.includes(String.fromCharCode(0)) || rawName.startsWith('/') || /^[a-zA-Z]:/.test(rawName)) {
      throw zipError('Zip contains an absolute or invalid entry path');
    }
    const rawParts = rawName.split('/');
    if (rawParts.some(part => part === '..' || part.includes(':'))) {
      throw zipError('Zip entry escapes the extraction directory');
    }
    const parts = rawParts.filter(part => part && part !== '.');
    if (parts.length === 0) continue;
    const unixMode = ((entry.header && entry.header.attr) >>> 16) & 0o170000;
    if (unixMode === 0o120000) throw zipError('Symbolic links inside zip archives are not supported');
    const isDirectory = Boolean(entry.isDirectory || rawName.endsWith('/'));
    const declaredSize = isDirectory ? 0 : Number((entry.header && entry.header.size) || 0);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_ZIP_ENTRY_BYTES) {
      throw zipError('A zip entry exceeds the per-file extraction limit', 413);
    }
    totalBytes += declaredSize;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw zipError('Archive exceeds the total extraction limit', 413);
    validated.push({ entry, parts, isDirectory });
  }

  const stage = await fsp.mkdtemp(path.join(destDir, '.upm-extract-'));
  try {
    let actualTotal = 0;
    for (const item of validated) {
      const target = path.join(stage, ...item.parts);
      assertContained(stage, target);
      if (item.isDirectory) {
        await ensureSafeDirectory(stage, target);
        continue;
      }
      await ensureSafeDirectory(stage, path.dirname(target));
      const data = item.entry.getData();
      if (!Buffer.isBuffer(data)) throw zipError('Could not read a zip entry');
      if (data.length > MAX_ZIP_ENTRY_BYTES) throw zipError('A zip entry exceeds the per-file extraction limit', 413);
      actualTotal += data.length;
      if (actualTotal > MAX_ZIP_TOTAL_BYTES) throw zipError('Archive exceeds the total extraction limit', 413);
      await fsp.writeFile(target, data, { flag: 'wx', mode: 0o600 });
    }
    await inspectMerge(stage, destDir);
    await mergeStaged(stage, destDir, destDir);
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}
module.exports = {
  listDirectory, mkdir, createFile, rename, remove, copyEntries, moveEntries,
  duplicate, readTextFile, writeTextFile, absolutePath, search,
  zipDirectoryToStream, zipMultipleToStream, extractZip, statEntry,
};
