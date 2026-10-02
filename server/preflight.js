// Fast environment checks run automatically before the server starts.
// Goal: fail with one clear line telling the user exactly what to do,
// instead of a raw Node stack trace (MODULE_NOT_FOUND, EADDRINUSE, etc).
const net = require('net');

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    console.error(`[preflight] Node.js ${process.versions.node} detected — this app requires Node 18 or newer.`);
    console.error('[preflight] Install a current LTS release from https://nodejs.org and try again.');
    process.exit(1);
  }
}

function checkCoreDependencies() {
  const required = [
    'express', 'ws', 'systeminformation', 'jsonwebtoken', 'bcryptjs',
    'multer', 'archiver', 'adm-zip', 'helmet', 'express-rate-limit',
    'cookie-parser', 'cookie', 'dotenv', 'mime-types',
  ];
  const missing = required.filter(mod => { try { require.resolve(mod); return false; } catch { return true; } });
  if (missing.length) {
    console.error(`[preflight] Missing dependencies: ${missing.join(', ')}`);
    console.error('[preflight] Run "npm install" first — or just use start.sh (Linux/macOS) / start.bat (Windows), which does this for you.');
    process.exit(1);
  }
}

// node-pty is optional: everything except the Terminal tab works without it.
function checkTerminalSupport() {
  try {
    require.resolve('node-pty');
    return true;
  } catch {
    console.warn('[preflight] node-pty is not installed/built — the web Terminal tab will show an error until this is fixed.');
    console.warn('[preflight]   Windows: install the "Desktop development with C++" workload in Visual Studio Build Tools, then re-run npm install.');
    console.warn('[preflight]   Linux:   sudo apt install build-essential python3 (or your distro equivalent), then re-run npm install.');
    return false;
  }
}

function checkPortFree(port, host) {
  return new Promise(resolve => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, host === '0.0.0.0' ? undefined : host);
  });
}

module.exports = { checkNodeVersion, checkCoreDependencies, checkTerminalSupport, checkPortFree };
