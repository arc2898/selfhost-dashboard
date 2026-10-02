const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config');

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
    if (entry.name.startsWith('.')) continue;
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
    const dirIndex = parseInt(req.query.dir || '0', 10);
    const baseDir = config.mediaDirs[dirIndex];
    if (!baseDir) return res.status(400).json({ error: 'Unknown media directory' });
    const target = path.resolve(baseDir, req.query.path || '');
    const base = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
    if (target !== baseDir && !target.startsWith(base)) {
      return res.status(403).json({ error: 'Access to that location is not permitted.' });
    }
    const stat = fs.statSync(target);
    const mime = require('mime-types').lookup(target) || 'application/octet-stream';
    const range = req.headers.range;
    if (!range) {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(target).pipe(res);
    }
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    fs.createReadStream(target, { start, end }).pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
