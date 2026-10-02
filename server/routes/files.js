const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const fileService = require('../services/fileService');
const { audit } = require('../services/authService');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, fileService.absolutePath(req.query.path || '.'));
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20GB ceiling; adjust to taste
});

router.get('/list', async (req, res, next) => {
  try {
    const { path: p = '.', hidden, sortBy, order } = req.query;
    res.json(await fileService.listDirectory(p, { includeHidden: hidden === 'true', sortBy, order }));
  } catch (e) { next(e); }
});

router.get('/search', async (req, res, next) => {
  try {
    const { path: p = '.', q = '' } = req.query;
    if (!q.trim()) return res.json({ results: [] });
    res.json({ results: await fileService.search(p, q) });
  } catch (e) { next(e); }
});

router.post('/mkdir', async (req, res, next) => {
  try {
    await fileService.mkdir(path.join(req.body.path || '.', req.body.name));
    audit('mkdir', { user: req.user.username, path: req.body.path, name: req.body.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/create-file', async (req, res, next) => {
  try {
    await fileService.createFile(path.join(req.body.path || '.', req.body.name));
    audit('create_file', { user: req.user.username, path: req.body.path, name: req.body.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/rename', async (req, res, next) => {
  try {
    await fileService.rename(req.body.path, req.body.newName);
    audit('rename', { user: req.user.username, path: req.body.path, newName: req.body.newName });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/delete', async (req, res, next) => {
  try {
    await fileService.remove(req.body.paths || []);
    audit('delete', { user: req.user.username, paths: req.body.paths });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/copy', async (req, res, next) => {
  try {
    await fileService.copyEntries(req.body.paths || [], req.body.destination);
    audit('copy', { user: req.user.username, paths: req.body.paths, destination: req.body.destination });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/move', async (req, res, next) => {
  try {
    await fileService.moveEntries(req.body.paths || [], req.body.destination);
    audit('move', { user: req.user.username, paths: req.body.paths, destination: req.body.destination });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/duplicate', async (req, res, next) => {
  try { res.json({ newPath: await fileService.duplicate(req.body.path) }); } catch (e) { next(e); }
});

router.get('/content', async (req, res, next) => {
  try { res.json({ content: await fileService.readTextFile(req.query.path) }); } catch (e) { next(e); }
});

router.put('/content', async (req, res, next) => {
  try {
    await fileService.writeTextFile(req.body.path, req.body.content ?? '');
    audit('file_save', { user: req.user.username, path: req.body.path });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/download', (req, res, next) => {
  try {
    const full = fileService.absolutePath(req.query.path);
    res.download(full);
  } catch (e) { next(e); }
});

router.get('/download-zip', (req, res, next) => {
  try {
    const paths = (req.query.paths || '').split(',').filter(Boolean);
    res.attachment(`${req.query.name || 'archive'}.zip`);
    if (paths.length === 1) fileService.zipDirectoryToStream(paths[0], res);
    else fileService.zipMultipleToStream(paths, res, req.query.name);
  } catch (e) { next(e); }
});

router.post('/extract', async (req, res, next) => {
  try {
    await fileService.extractZip(req.body.path, req.body.destination || path.dirname(req.body.path));
    audit('extract', { user: req.user.username, path: req.body.path });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/upload', (req, res, next) => {
  upload.array('files')(req, res, err => {
    if (err) return next(err);
    audit('upload', { user: req.user.username, path: req.query.path, count: req.files?.length || 0 });
    res.json({ ok: true, uploaded: req.files.map(f => f.originalname) });
  });
});

// Streams file content with HTTP range support (used by media preview inside the file manager)
router.get('/raw', (req, res, next) => {
  try {
    const full = fileService.absolutePath(req.query.path);
    const stat = fs.statSync(full);
    res.setHeader('Content-Type', require('mime-types').lookup(full) || 'application/octet-stream');
    const range = req.headers.range;
    if (!range) {
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(full).pipe(res);
    }
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(full, { start, end }).pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
