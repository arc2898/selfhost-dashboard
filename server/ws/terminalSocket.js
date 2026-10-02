const crypto = require('crypto');
const terminal = require('../services/terminalService');
const { audit } = require('../services/authService');

function attach(wss) {
  wss.on('connection', (ws, request, user) => {
    if (!terminal.isAvailable()) {
      ws.send(JSON.stringify({ type: 'error', message: 'Terminal is unavailable: node-pty failed to load on this server.' }));
      ws.close();
      return;
    }

    const sessionId = crypto.randomUUID();
    let proc;
    try {
      proc = terminal.createSession(sessionId, { cols: 80, rows: 24 });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
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

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'input') terminal.write(sessionId, msg.data);
      else if (msg.type === 'resize') terminal.resize(sessionId, msg.cols, msg.rows);
    });

    ws.on('close', () => {
      terminal.destroy(sessionId);
      audit('terminal_close', { user: user.username, sessionId });
    });
  });
}

module.exports = { attach };
