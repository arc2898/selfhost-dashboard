const express = require('express');
const os = require('os');
const monitor = require('../services/systemMonitor');
const { audit } = require('../services/authService');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/overview', async (req, res, next) => {
  try { res.json(await monitor.getOverview()); } catch (e) { next(e); }
});

router.get('/network', async (req, res, next) => {
  try { res.json(await monitor.getNetworkInterfaces()); } catch (e) { next(e); }
});

router.get('/processes', async (req, res, next) => {
  try { res.json(await monitor.getProcesses()); } catch (e) { next(e); }
});

router.post('/processes/:pid/kill', requireAdmin, async (req, res, next) => {
  try {
    const pid = Number(req.params.pid);
    const signal = req.body?.signal || 'SIGTERM';
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
      return res.status(400).json({ error: 'Invalid process ID.' });
    }
    if (!['SIGTERM', 'SIGKILL', 'SIGINT'].includes(signal)) {
      return res.status(400).json({ error: 'Unsupported process signal.' });
    }
    await monitor.killProcess(pid, signal);
    audit('process_kill', { user: req.user.username, pid });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/identity', (req, res) => {
  // Non-sensitive identity info shown on the dashboard header
  const nets = os.networkInterfaces();
  let localIp = null;
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) { localIp = n.address; break; }
    }
    if (localIp) break;
  }
  // Tailscale interfaces are typically named "tailscale0" (Linux) or show a 100.x.x.x address
  let tailscaleIp = null;
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(n.address)) {
        tailscaleIp = n.address;
      }
    }
  }
  res.json({ hostname: os.hostname(), localIp, tailscaleIp });
});

module.exports = router;
