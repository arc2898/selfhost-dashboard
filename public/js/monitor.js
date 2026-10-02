const Monitor = {
  procSort: 'cpu',
  procOrder: 'desc',
  procFilter: '',
  procTimer: null,

  render() {
    return `
      <h2 class="section-title" style="margin-top:0">System Monitor</h2>
      <div class="grid" id="monCpuMem"></div>

      <h2 class="section-title">Storage</h2>
      <div id="monDisks"></div>

      <h2 class="section-title">Network Interfaces</h2>
      <div id="monNet"></div>

      <h2 class="section-title">Processes</h2>
      <div class="toolbar">
        <input type="text" id="procSearch" placeholder="Filter processes…">
        <span class="stat-sub" id="procCount"></span>
      </div>
      <div style="overflow:auto">
        <table class="data-table" id="procTable">
          <thead><tr>
            <th data-key="pid">PID</th><th data-key="name">Name</th><th data-key="user">User</th>
            <th data-key="cpu">CPU %</th><th data-key="memPercent">RAM %</th><th data-key="memBytes">Memory</th>
            <th data-key="state">Status</th><th></th>
          </tr></thead>
          <tbody id="procBody"></tbody>
        </table>
      </div>
    `;
  },

  onEnter() {
    App.statsListeners.push(data => this.updateOverview(data));
    if (App.latestStats) this.updateOverview(App.latestStats);
    api('/system/overview')
      .then(data => { App.latestStats = data; this.updateOverview(data); })
      .catch(e => console.error('[monitor] initial overview fetch failed', e));
    api('/system/network').then(list => this.renderNetwork(list)).catch(e => console.error('[monitor] network fetch failed', e));

    document.getElementById('procSearch').addEventListener('input', e => {
      this.procFilter = e.target.value.toLowerCase();
      this.refreshProcesses();
    });
    document.querySelectorAll('#procTable th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (this.procSort === key) this.procOrder = this.procOrder === 'asc' ? 'desc' : 'asc';
        else { this.procSort = key; this.procOrder = 'desc'; }
        this.refreshProcesses();
      });
    });

    this.refreshProcesses();
    this.procTimer = setInterval(() => this.refreshProcesses(), 4000);
    // Clean up when navigating away
    const observer = new MutationObserver(() => {
      if (!document.getElementById('procTable')) { clearInterval(this.procTimer); observer.disconnect(); }
    });
    observer.observe(document.getElementById('content'), { childList: true, subtree: true });
  },

  updateOverview(d) {
    const cont = document.getElementById('monCpuMem');
    if (!cont) return;
    const perCore = d.cpu.perCore.map((v, i) => `
      <div style="margin-bottom:6px">
        <div class="stat-sub">Core ${i}: ${v}%</div>
        <div class="progress-track"><div class="progress-fill ${v > 85 ? 'warn' : ''}" style="width:${v}%"></div></div>
      </div>`).join('');

    cont.innerHTML = `
      <div class="card">
        <h3>CPU</h3>
        <div class="stat-value">${d.cpu.usagePercent}%</div>
        <div class="stat-sub">${d.cpu.brand} · ${d.cpu.physicalCores} cores / ${d.cpu.cores} threads @ ${d.cpu.speedGHz} GHz</div>
        <div class="stat-sub">Load avg: ${d.cpu.loadAvg.map(n => n.toFixed(2)).join(', ')}</div>
        ${d.cpu.temperatureC ? `<div class="stat-sub">Temp: ${d.cpu.temperatureC}°C</div>` : ''}
      </div>
      <div class="card">
        <h3>Per-Core Usage</h3>
        <div style="max-height:150px;overflow:auto">${perCore}</div>
      </div>
      <div class="card">
        <h3>Memory</h3>
        <div class="stat-value">${formatBytes(d.memory.usedBytes)} / ${formatBytes(d.memory.totalBytes)}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${d.memory.usagePercent}%"></div></div>
        <div class="stat-sub">Free: ${formatBytes(d.memory.freeBytes)} · Cached: ${formatBytes(d.memory.cachedBytes)}</div>
        <div class="stat-sub">Swap: ${formatBytes(d.memory.swapUsedBytes)} / ${formatBytes(d.memory.swapTotalBytes)}</div>
      </div>
    `;

    const diskCont = document.getElementById('monDisks');
    if (diskCont) {
      diskCont.innerHTML = `<div class="grid">${d.disk.mounts.map(m => `
        <div class="card">
          <h3>${escapeHtml(m.mount)}</h3>
          <div class="stat-value">${m.usagePercent}%</div>
          <div class="progress-track"><div class="progress-fill ${m.usagePercent > 85 ? 'warn' : ''}" style="width:${m.usagePercent}%"></div></div>
          <div class="stat-sub">${formatBytes(m.usedBytes)} used of ${formatBytes(m.totalBytes)} (${m.fs})</div>
        </div>`).join('')}</div>`;
    }
  },

  renderNetwork(list) {
    const cont = document.getElementById('monNet');
    if (!cont) return;
    if (!list.length) { cont.innerHTML = `<p class="stat-sub">No external interfaces detected.</p>`; return; }
    cont.innerHTML = `<div class="grid">${list.map(n => `
      <div class="card">
        <h3>${escapeHtml(n.iface)}</h3>
        <div class="stat-sub">IPv4: ${n.ip4 || '–'}</div>
        <div class="stat-sub">MAC: ${n.mac || '–'}</div>
        <div class="stat-sub">↓ ${formatBytes(n.downloadBytesPerSec)}/s &nbsp; ↑ ${formatBytes(n.uploadBytesPerSec)}/s</div>
        <div class="stat-sub">Total: ↓ ${formatBytes(n.totalDownloadedBytes)} · ↑ ${formatBytes(n.totalUploadedBytes)}</div>
      </div>`).join('')}</div>`;
  },

  async refreshProcesses() {
    if (!document.getElementById('procBody')) return;
    try {
      const data = await api('/system/processes');
      let list = data.list;
      if (this.procFilter) list = list.filter(p => p.name.toLowerCase().includes(this.procFilter) || String(p.pid).includes(this.procFilter));
      list.sort((a, b) => {
        const av = a[this.procSort], bv = b[this.procSort];
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        return this.procOrder === 'asc' ? cmp : -cmp;
      });
      document.getElementById('procCount').textContent = `${list.length} of ${data.total} processes`;
      document.getElementById('procBody').innerHTML = list.slice(0, 200).map(p => `
        <tr>
          <td>${p.pid}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.user || '–')}</td>
          <td>${p.cpu}%</td><td>${p.memPercent}%</td><td>${formatBytes(p.memBytes)}</td>
          <td>${escapeHtml(p.state || '–')}</td>
          <td><button class="btn danger" data-pid="${p.pid}">End</button></td>
        </tr>`).join('');
      document.querySelectorAll('#procBody button[data-pid]').forEach(btn => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.pid;
          confirmDialog(`End process ${pid}? Unsaved data in that process may be lost.`, async () => {
            try { await api(`/system/processes/${pid}/kill`, { method: 'POST' }); toast('Process terminated', 'success'); this.refreshProcesses(); }
            catch (e) { toast(e.message, 'error'); }
          });
        });
      });
    } catch { /* transient failure, will retry on next tick */ }
  },
};
