const Terminal = {
  tabs: [], // { id, term, fitAddon, ws, el }
  activeId: null,
  nextTabNum: 1,

  render() {
    return `
      <h2 class="section-title" style="margin-top:0">Terminal</h2>
      <div class="toolbar">
        <button class="btn primary" id="termNewTab">＋ New Tab</button>
      </div>
      <div class="terminal-tabs" id="termTabs"></div>
      <div class="terminal-container" id="termContainer"></div>
    `;
  },

  onEnter() {
    document.getElementById('termNewTab').onclick = () => this.openTab();
    this.openTab();
    window.addEventListener('resize', () => this.fitActive());
  },

  openTab() {
    const id = 'tab' + (this.nextTabNum++);
    const container = document.getElementById('termContainer');
    container.querySelectorAll('.xterm-pane').forEach(el => el.style.display = 'none');

    const pane = document.createElement('div');
    pane.className = 'xterm-pane';
    pane.style.height = '100%';
    pane.id = `pane-${id}`;
    container.appendChild(pane);

    const term = new window.Terminal({
      cursorBlink: true,
      fontFamily: "'SF Mono', Consolas, monospace",
      fontSize: 13,
      theme: { background: '#0d1117', foreground: '#d4d4d4' },
    });
    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(pane);
    fitAddon.fit();

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal`);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'output') term.write(msg.data);
      else if (msg.type === 'error') term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      else if (msg.type === 'exit') term.write(`\r\n\x1b[90m[process exited]\x1b[0m\r\n`);
    };
    ws.onclose = () => term.write(`\r\n\x1b[90m[disconnected]\x1b[0m\r\n`);
    term.onData(data => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'input', data })); });

    const tab = { id, term, fitAddon, ws, pane };
    this.tabs.push(tab);
    this.activeId = id;
    this.renderTabs();
    setTimeout(() => { fitAddon.fit(); term.focus(); }, 50);
  },

  closeTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    tab.ws.close();
    tab.term.dispose();
    tab.pane.remove();
    this.tabs = this.tabs.filter(t => t.id !== id);
    if (this.activeId === id && this.tabs.length) this.activateTab(this.tabs[this.tabs.length - 1].id);
    this.renderTabs();
  },

  activateTab(id) {
    this.activeId = id;
    this.tabs.forEach(t => t.pane.style.display = t.id === id ? 'block' : 'none');
    this.renderTabs();
    this.fitActive();
  },

  fitActive() {
    const tab = this.tabs.find(t => t.id === this.activeId);
    if (!tab) return;
    tab.fitAddon.fit();
    if (tab.ws.readyState === tab.ws.OPEN) tab.ws.send(JSON.stringify({ type: 'resize', cols: tab.term.cols, rows: tab.term.rows }));
  },

  renderTabs() {
    const cont = document.getElementById('termTabs');
    if (!cont) return;
    cont.innerHTML = this.tabs.map((t, i) => `
      <button class="${t.id === this.activeId ? 'active' : ''}" data-id="${t.id}">Session ${i + 1} ✕</button>
    `).join('');
    cont.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', e => {
        // Clicking the trailing "✕" region closes; rough hit-test on click position within button
        const rect = btn.getBoundingClientRect();
        if (e.clientX > rect.right - 22) this.closeTab(btn.dataset.id);
        else this.activateTab(btn.dataset.id);
      });
    });
  },
};
