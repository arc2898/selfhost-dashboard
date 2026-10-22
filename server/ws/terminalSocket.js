const crypto = require('crypto');
const terminal = require('../services/terminalService');
const { audit } = require('../services/authService');

const MAX_TERMINAL_SESSIONS_PER_USER = 3;
const MAX_INPUT_CHARS = 16 * 1024;
const MAX_MESSAGES_PER_WINDOW = 200;
const MESSAGE_WINDOW_MS = 10 * 1000;
const activeByUser = new Map();

function attach(wss) {
  wss.on('connection', (ws, request, user) => {
    const userKey = String(user.sub || user.username || 'unknown');
    const active = activeByUser.get(userKey) || 0;
    if (active >= MAX_TERMINAL_SESSIONS_PER_USER) {
      ws.send(JSON.stringify({ type: 'error', message: 'Too many active terminal sessions.' }));
      ws.close(1008, 'Terminal session limit reached');
      return;
    }
    activeByUser.set(userKey, active + 1);
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      const remaining = (activeByUser.get(userKey) || 1) - 1;
      if (remaining <= 0) activeByUser.delete(userKey);
      else activeByUser.set(userKey, remaining);
    };

    if (!terminal.isAvailable()) {
      releaseSlot();
      ws.send(JSON.stringify({ type: 'error', message: 'Terminal is unavailable: node-pty failed to load on this server.' }));
      ws.close();
      return;
    }

    const sessionId = crypto.randomUUID();
    let proc;
    try {
      proc = terminal.createSession(sessionId, { cols: 80, rows: 24 });
    } catch (e) {
      releaseSlot();
      ws.send(JSON.stringify({ type: 'error', message: 'Could not start a terminal session.' }));
      ws.close();
      return;
    }

    audit('terminal_open', { user: user.username, sessionId });

    proc.onData(data => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
    });

    proc.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        ws.close();
      }
    });

    let windowStarted = Date.now();
    let messagesInWindow = 0;
    ws.on('message', raw => {
      const now = Date.now();
      if (now - windowStarted >= MESSAGE_WINDOW_MS) {
        windowStarted = now;
        messagesInWindow = 0;
      }
      messagesInWindow++;
      if (messagesInWindow > MAX_MESSAGES_PER_WINDOW || raw.length > 32 * 1024) {
        ws.close(1008, 'Terminal message limit exceeded');
        return;
      }

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'input') {
        if (typeof msg.data !== 'string' || msg.data.length > MAX_INPUT_CHARS) {
          ws.close(1008, 'Invalid terminal input');
          return;
        }
        terminal.write(sessionId, msg.data);
      } else if (msg.type === 'resize') {
        if (!Number.isInteger(msg.cols) || !Number.isInteger(msg.rows) ||
            msg.cols < 2 || msg.cols > 300 || msg.rows < 1 || msg.rows > 150) return;
        terminal.resize(sessionId, msg.cols, msg.rows);
      }
    });

    ws.on('close', () => {
      terminal.destroy(sessionId);
      releaseSlot();
      audit('terminal_close', { user: user.username, sessionId });
    });
  });
}

module.exports = { attach };
