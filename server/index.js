const preflight = require('./preflight');
preflight.checkNodeVersion();
preflight.checkCoreDependencies();

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const config = require('./config');
preflight.checkTerminalSupport();
const { requireAuth, requireAdmin, verifyWsRequest } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { hasAnyUser } = require('./services/authService');

const authRoutes = require('./routes/auth');
const systemRoutes = require('./routes/system');
const fileRoutes = require('./routes/files');
const mediaRoutes = require('./routes/media');

const systemSocket = require('./ws/systemSocket');
const terminalSocket = require('./ws/terminalSocket');

const app = express();

// --- Security middleware -----------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false, // relaxed for the bundled CDN assets (xterm.js, Chart.js); tighten if self-hosting those files
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

// --- First-run guard ------------------------------------------------------
app.use('/api', (req, res, next) => {
  if (!hasAnyUser() && req.path !== '/auth/status') {
    return res.status(503).json({ error: 'Setup has not been completed. Run "npm run setup" on the server first.' });
  }
  next();
});

// --- Public routes ----------------------------------------------------
app.use('/api/auth', authRoutes);

// --- Authenticated routes ----------------------------------------------
app.use('/api/system', requireAuth, systemRoutes);
app.use('/api/files', requireAuth, fileRoutes);
app.use('/api/media', requireAuth, mediaRoutes);

// Admin-only: kill switch example, extend as needed
app.get('/api/admin/ping', requireAuth, requireAdmin, (req, res) => res.json({ ok: true }));

// --- Static frontend ------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

// --- HTTP + WebSocket servers -------------------------------------------
const server = http.createServer(app);

const statsWss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

systemSocket.attach(statsWss);
terminalSocket.attach(terminalWss);

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  const user = verifyWsRequest(request);

  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (pathname === '/ws/system') {
    statsWss.handleUpgrade(request, socket, head, ws => statsWss.emit('connection', ws, request, user));
  } else if (pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(request, socket, head, ws => terminalWss.emit('connection', ws, request, user));
  } else {
    socket.destroy();
  }
});

(async () => {
  const portFree = await preflight.checkPortFree(config.port, config.host);
  if (!portFree) {
    console.error(`[preflight] Port ${config.port} is already in use.`);
    console.error(`[preflight] Either stop whatever else is using it, or set a different PORT in .env.`);
    process.exit(1);
  }

  server.on('error', err => {
    // Safety net for the rare race where something grabs the port between
    // the check above and the actual listen() call below.
    if (err.code === 'EADDRINUSE') {
      console.error(`[error] Port ${config.port} became unavailable. Set a different PORT in .env and try again.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(config.port, config.host, () => {
    const localUrl = `http://localhost:${config.port}`;
    console.log('');
    console.log(`  Server dashboard is running`);
    console.log(`  Local:  ${localUrl}`);
    console.log(`  Bound:  ${config.host}:${config.port} (0.0.0.0 = reachable over Tailscale/LAN too)`);
    console.log(`  Files:  ${config.fileRoot}`);
    console.log('');
    if (!hasAnyUser()) {
      console.log('  No admin user found yet — run "npm run setup" in another terminal, then refresh the page.');
      console.log('');
    }
  });
})();
