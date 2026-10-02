const Dashboard = {
  charts: {},
  history: { cpu: [], mem: [], net: [] },

  render() {
    return `
      <h2 class="section-title" style="margin-top:0">Overview</h2>
      <div class="grid" id="dashCards">
        ${this.skeletonCards()}
      </div>

      <div class="quick-cards">
        <div class="quick-card" data-goto="files"><span class="ic">▤</span><strong>File Manager</strong><span class="stat-sub">Browse & manage files</span></div>
        <div class="quick-card" data-goto="media"><span class="ic">▶</span><strong>Media</strong><span class="stat-sub">Photos, video & music</span></div>
        <div class="quick-card" data-goto="terminal"><span class="ic">▌</span><strong>Terminal</strong><span class="stat-sub">Remote shell access</span></div>
        <div class="quick-card" data-goto="monitor"><span class="ic">◔</span><strong>System Monitor</strong><span class="stat-sub">Deep performance detail</span></div>
      </div>

      <h2 class="section-title">Live Charts</h2>
      <div class="grid">
        <div class="chart-card"><h3>CPU Usage</h3><canvas id="chartCpu"></canvas></div>
        <div class="chart-card"><h3>Memory Usage</h3><canvas id="chartMem"></canvas></div>
        <div class="chart-card"><h3>Network Traffic</h3><canvas id="chartNet"></canvas></div>
        <div class="chart-card"><h3>Disk Usage</h3><canvas id="chartDisk"></canvas></div>
      </div>
    `;
  },

  skeletonCards() {
    return Array.from({ length: 8 }).map(() => `<div class="card"><div class="skeleton" style="height:60px"></div></div>`).join('');
  },

  onEnter() {
    document.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => switchView(el.dataset.goto));
    });
    this.initCharts();
    App.statsListeners.push(data => this.update(data));
    // Paint instantly from a cached WS tick if we have one (e.g. switching
    // back to this tab), but never depend on the WebSocket alone for the
    // very first load - if it's slow to connect (or a proxy/browser blocks
    // it briefly) the cards would otherwise sit on skeletons indefinitely.
    if (App.latestStats) this.update(App.latestStats);
    api('/system/overview')
      .then(data => { App.latestStats = data; this.update(data); })
      .catch(e => console.error('[dashboard] initial overview fetch failed', e));
    api('/system/identity').then(id => { this.identity = id; if (App.latestStats) this.update(App.latestStats); }).catch(() => {});
  },

  initCharts() {
    const ctxOpts = {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } } },
    };
    const mk = (id, label, color, max) => new Chart(document.getElementById(id), {
      type: 'line',
      data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '33', fill: true, tension: 0.35, pointRadius: 0 }] },
      options: { ...ctxOpts, scales: { ...ctxOpts.scales, y: { ...ctxOpts.scales.y, max } } },
    });
    this.charts.cpu = mk('chartCpu', 'CPU %', '#6ee7ff', 100);
    this.charts.mem = mk('chartMem', 'Memory %', '#7c8cff', 100);
    this.charts.net = mk('chartNet', 'Net MB/s', '#35d399');
    this.charts.disk = new Chart(document.getElementById('chartDisk'), {
      type: 'doughnut',
      data: { labels: ['Used', 'Free'], datasets: [{ data: [0, 1], backgroundColor: ['#f5b942', 'rgba(255,255,255,0.08)'] }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#8b98a5' } } } },
    });
  },

  pushPoint(arr, val, max = 30) {
    arr.push(val);
    if (arr.length > max) arr.shift();
  },

  update(d) {
    const cont = document.getElementById('dashCards');
    if (!cont) return; // view no longer mounted

    const localIp = this.identity?.localIp || '–';
    const tsIp = this.identity?.tailscaleIp || 'not detected';

    cont.innerHTML = `
      ${this.card('Hostname', d.hostname)}
      ${this.card('Local IP', localIp)}
      ${this.card('Tailscale IP', tsIp)}
      ${this.card('Uptime', formatUptime(d.uptimeSeconds))}
      ${this.gaugeCard('CPU Usage', d.cpu.usagePercent)}
      ${this.gaugeCard('RAM Usage', d.memory.usagePercent, `${formatBytes(d.memory.usedBytes)} / ${formatBytes(d.memory.totalBytes)}`)}
      ${this.gaugeCard('Disk Usage', d.disk.usagePercent, `${formatBytes(d.disk.usedBytes)} / ${formatBytes(d.disk.totalBytes)}`)}
      ${this.card('Network', `↓ ${formatBytes(d.network.downloadBytesPerSec)}/s`, `↑ ${formatBytes(d.network.uploadBytesPerSec)}/s`)}
      ${this.card('CPU Temp', d.cpu.temperatureC ? `${d.cpu.temperatureC}°C` : 'N/A')}
      ${this.card('OS', `${d.distro || d.platform}`, d.arch)}
      ${this.card('Current Time', new Date(d.now).toLocaleTimeString())}
    `;

    const label = new Date().toLocaleTimeString();
    if (this.charts.cpu) {
      this.pushChart(this.charts.cpu, label, d.cpu.usagePercent);
      this.pushChart(this.charts.mem, label, d.memory.usagePercent);
      this.pushChart(this.charts.net, label, Math.round(((d.network.downloadBytesPerSec + d.network.uploadBytesPerSec) / 1024 / 1024) * 100) / 100);
      this.charts.disk.data.datasets[0].data = [d.disk.usedBytes, Math.max(d.disk.totalBytes - d.disk.usedBytes, 0)];
      this.charts.disk.update('none');
    }
  },

  pushChart(chart, label, value) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > 30) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
    chart.update('none');
  },

  card(title, value, sub) {
    return `<div class="card"><h3>${title}</h3><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  },

  gaugeCard(title, percent, sub) {
    const cls = percent > 85 ? 'warn' : '';
    return `<div class="card"><h3>${title}</h3><div class="stat-value">${percent}%</div>
      <div class="progress-track"><div class="progress-fill ${cls}" style="width:${Math.min(percent,100)}%"></div></div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  },
};
