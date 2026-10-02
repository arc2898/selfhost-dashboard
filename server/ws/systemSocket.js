const monitor = require('../services/systemMonitor');

// Broadcasts system stats to every connected client on a shared timer,
// instead of each client polling the REST API on its own.
function attach(wss) {
  const clients = new Set();

  wss.on('connection', ws => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  async function tick() {
    if (clients.size === 0) return;
    try {
      const overview = await monitor.getOverview();
      const payload = JSON.stringify({ type: 'stats', data: overview });
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    } catch (e) {
      console.error('[system-ws] tick failed:', e.message);
    }
  }

  const interval = setInterval(tick, 2000);
  tick();

  return () => clearInterval(interval);
}

module.exports = { attach };
