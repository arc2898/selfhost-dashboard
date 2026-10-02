const os = require('os');
let pty;
try {
  pty = require('node-pty');
} catch {
  pty = null; // node-pty failed to build/install on this platform - handled gracefully below
}

const sessions = new Map(); // sessionId -> pty process

function isAvailable() {
  return !!pty;
}

function createSession(sessionId, { cwd, cols = 80, rows = 24 } = {}) {
  if (!pty) throw new Error('node-pty is not available on this platform. See README for setup notes.');
  const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols, rows,
    cwd: cwd || os.homedir(),
    env: process.env,
  });
  sessions.set(sessionId, proc);
  return proc;
}

function write(sessionId, data) {
  const proc = sessions.get(sessionId);
  if (proc) proc.write(data);
}

function resize(sessionId, cols, rows) {
  const proc = sessions.get(sessionId);
  if (proc) proc.resize(cols, rows);
}

function destroy(sessionId) {
  const proc = sessions.get(sessionId);
  if (proc) {
    try { proc.kill(); } catch { /* already dead */ }
    sessions.delete(sessionId);
  }
}

module.exports = { isAvailable, createSession, write, resize, destroy };
