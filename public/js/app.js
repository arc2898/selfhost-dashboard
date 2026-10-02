// ---------- Shared utilities used by all view modules ----------
const App = {
  user: null,
  latestStats: null,
  statsListeners: [],
  currentView: 'dashboard',
};

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '–';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let isRedirectingToLogin = false;

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin', // send the session cookie explicitly; don't rely on the browser default
    headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 401) {
    // Several views poll in the background (process list, stats reconnect).
    // Without this guard, more than one of them hitting a 401 at once would
    // each try to navigate away, which is harmless but noisy - one redirect is enough.
    if (!isRedirectingToLogin) {
      isRedirectingToLogin = true;
      window.location.href = '/login.html';
    }
    throw new Error('Not authenticated');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-json (e.g. file download) */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function openModal({ title, bodyHtml, footerButtons = [], wide = false, extraClass = '' }) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal ${wide ? 'wide' : ''} ${extraClass}">
        <div class="modal-header"><span>${title}</span><button class="icon-btn" id="modalClose">✕</button></div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer" id="modalFooter"></div>
      </div>
    </div>`;
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  const footer = document.getElementById('modalFooter');
  for (const btn of footerButtons) {
    const b = document.createElement('button');
    b.className = `btn ${btn.primary ? 'primary' : ''} ${btn.danger ? 'danger' : ''}`;
    b.textContent = btn.label;
    b.onclick = btn.onClick;
    footer.appendChild(b);
  }
}

function confirmDialog(message, onConfirm) {
  openModal({
    title: 'Please confirm',
    bodyHtml: `<p>${escapeHtml(message)}</p>`,
    footerButtons: [
      { label: 'Cancel', onClick: closeModal },
      { label: 'Confirm', primary: true, onClick: () => { closeModal(); onConfirm(); } },
    ],
  });
}

// ---------- Navigation ----------
const VIEWS = {
  dashboard: { render: () => Dashboard.render(), onEnter: () => Dashboard.onEnter() },
  monitor: { render: () => Monitor.render(), onEnter: () => Monitor.onEnter() },
  files: { render: () => Files.render(), onEnter: () => Files.onEnter() },
  media: { render: () => Media.render(), onEnter: () => Media.onEnter() },
  terminal: { render: () => Terminal.render(), onEnter: () => Terminal.onEnter() },
  settings: { render: () => renderSettings() },
};

function switchView(name) {
  App.currentView = name;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  const content = document.getElementById('content');
  content.innerHTML = VIEWS[name].render();
  if (VIEWS[name].onEnter) VIEWS[name].onEnter();
  if (window.innerWidth <= 860) document.getElementById('sidebar').classList.remove('open');
}

function renderSettings() {
  const dirs = App.latestStats ? '' : '';
  return `
    <h2 class="section-title" style="margin-top:0">Settings</h2>
    <div class="grid">
      <div class="card">
        <h3>Account</h3>
        <p class="stat-sub">Signed in as <strong>${escapeHtml(App.user?.username || '')}</strong> (${App.user?.isAdmin ? 'admin' : 'user'})</p>
      </div>
      <div class="card">
        <h3>File Manager Root</h3>
        <p class="stat-sub">Configured server-side via <code>FILE_ROOT</code> in <code>.env</code>. Access outside this directory is blocked for all users.</p>
      </div>
      <div class="card">
        <h3>Media Directories</h3>
        <p class="stat-sub">Configured via <code>MEDIA_DIRS</code> in <code>.env</code>. Restart the server after changing it.</p>
      </div>
      <div class="card">
        <h3>Security</h3>
        <p class="stat-sub">Sessions expire automatically. Login attempts are rate-limited. All file, process, and terminal actions are written to the audit log (<code>data/audit.log</code>).</p>
      </div>
      <div class="card">
        <h3>About</h3>
        <p class="stat-sub">Self-Hosted Dashboard v1.0.0</p>
      </div>
    </div>`;
}

// ---------- Live stats WebSocket ----------
function connectStatsSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const openedAt = Date.now();
  const ws = new WebSocket(`${proto}//${location.host}/ws/system`);
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');

  ws.onopen = () => { dot.className = 'status-dot online'; label.textContent = 'Connected'; };
  ws.onclose = () => {
    dot.className = 'status-dot offline';
    label.textContent = 'Reconnecting…';
    // The server rejects the WS upgrade outright (closes within ~1s) when the
    // session cookie is missing or expired. Previously this just retried
    // forever every 3s with no visible sign of why stats had stopped
    // updating. Confirm auth via a normal request - api() will redirect to
    // login if that's really the cause, otherwise this is a genuine
    // transient network blip and we keep retrying as before.
    if (Date.now() - openedAt < 1000) {
      api('/auth/me').catch(() => {});
    }
    setTimeout(connectStatsSocket, 3000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'stats') {
      App.latestStats = msg.data;
      document.getElementById('serverPill').textContent = `${msg.data.hostname} · ${msg.data.cpu.usagePercent}% CPU`;
      for (const fn of App.statsListeners) fn(msg.data);
    }
  };
}

// ---------- Boot ----------
async function boot() {
  try {
    const me = await api('/auth/me');
    App.user = me;
  } catch {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('app').hidden = false;
  document.getElementById('userName').textContent = App.user.username;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  const userBtn = document.getElementById('userMenuBtn');
  const dropdown = document.getElementById('userDropdown');
  userBtn.addEventListener('click', () => { dropdown.hidden = !dropdown.hidden; });
  document.addEventListener('click', e => {
    if (!userBtn.contains(e.target) && !dropdown.contains(e.target)) dropdown.hidden = true;
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  const theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeToggle').textContent = theme === 'dark' ? '☾' : '☀';
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    document.getElementById('themeToggle').textContent = next === 'dark' ? '☾' : '☀';
  });

  document.getElementById('globalSearch').addEventListener('keydown', async e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      switchView('files');
      setTimeout(() => Files.search(e.target.value.trim()), 50);
    }
  });

  connectStatsSocket();
  switchView('dashboard');
}

document.addEventListener('DOMContentLoaded', boot);
