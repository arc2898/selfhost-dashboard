const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config');
const { safeResolveInRoot } = require('../middleware/security');
const parseByteRange = require('../utils/byteRange');

const router = express.Router();

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogg', '.mkv', '.mov']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);

function classify(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

async function scan(dir, baseDir, depth = 0, results = []) {
  if (depth > 8 || results.length > 2000) return results;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(full, baseDir, depth + 1, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const type = classify(ext);
      if (type) {
        const stat = await fsp.stat(full);
        results.push({
          type,
          name: entry.name,
          relativePath: path.relative(baseDir, full).replace(/\\/g, '/'),
          folder: path.relative(baseDir, dir).replace(/\\/g, '/') || '.',
          sizeBytes: stat.size,
          modifiedAt: stat.mtime,
        });
      }
    }
    if (results.length > 2000) break;
  }
  return results;
}

router.get('/library', async (req, res, next) => {
  try {
    let all = [];
    for (const dir of config.mediaDirs) {
      all = all.concat(await scan(dir, dir));
    }
    const byType = { image: [], video: [], audio: [] };
    for (const item of all) byType[item.type].push(item);
    const recentlyAdded = [...all].sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt)).slice(0, 40);
    res.json({ images: byType.image, videos: byType.video, audio: byType.audio, recentlyAdded });
  } catch (e) { next(e); }
});

// Serves the actual media bytes with range support for seeking in video/audio players.
// "dirIndex" selects which configured media directory to resolve against.
router.get('/stream', (req, res, next) => {
  try {
    const dirIndex = Number.parseInt(req.query.dir || '0', 10);
    const baseDir = config.mediaDirs[dirIndex];
    if (!Number.isSafeInteger(dirIndex) || !baseDir) {
      return res.status(400).json({ error: 'Unknown media directory' });
    }
    const target = safeResolveInRoot(baseDir, req.query.path || '');
    const stat = fs.statSync(target);
    if (!stat.isFile()) return res.status(400).json({ error: 'Only media files can be streamed.' });
    const mime = require('mime-types').lookup(target) || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    const range = parseByteRange(req.headers.range, stat.size);
    if (range === false) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    if (!range) {
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(target).pipe(res);
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    return fs.createReadStream(target, { start: range.start, end: range.end }).pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
