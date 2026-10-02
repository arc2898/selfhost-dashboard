const Media = {
  tab: 'recentlyAdded',
  library: null,
  queue: [],
  queueIndex: 0,

  render() {
    return `
      <h2 class="section-title" style="margin-top:0">Media</h2>
      <div class="media-tabs">
        <button data-tab="recentlyAdded" class="active">Recently Added</button>
        <button data-tab="images">Images</button>
        <button data-tab="videos">Videos</button>
        <button data-tab="audio">Audio</button>
      </div>
      <div id="mediaGrid" class="media-grid"></div>
      <div id="audioBar"></div>
    `;
  },

  onEnter() {
    document.querySelectorAll('.media-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.media-tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tab = btn.dataset.tab;
        this.renderGrid();
      });
    });
    this.load();
  },

  async load() {
    try {
      this.library = await api('/media/library');
      this.renderGrid();
    } catch (e) { toast(e.message, 'error'); }
  },

  renderGrid() {
    const grid = document.getElementById('mediaGrid');
    if (!grid || !this.library) return;
    const items = this.library[this.tab] || [];
    if (!items.length) { grid.innerHTML = `<p class="stat-sub">No media found in this category yet.</p>`; return; }

    grid.innerHTML = items.map((item, i) => `
      <div class="media-tile" data-index="${i}" data-type="${item.type}">
        <div class="thumb">
          ${item.type === 'image' ? `<img loading="lazy" src="/api/media/stream?dir=0&path=${encodeURIComponent(item.relativePath)}">` :
            item.type === 'video' ? '🎞️' : '🎵'}
        </div>
        <div class="label">${escapeHtml(item.name)}</div>
      </div>`).join('');

    this.queue = items;
    grid.querySelectorAll('.media-tile').forEach(tile => {
      tile.addEventListener('click', () => this.openAtIndex(parseInt(tile.dataset.index, 10)));
    });
  },

  openAtIndex(index) {
    this.queueIndex = index;
    const item = this.queue[index];
    if (!item) return;
    const url = `/api/media/stream?dir=0&path=${encodeURIComponent(item.relativePath)}`;
    if (item.type === 'image') this.openImageViewer(url, item.name, true);
    else if (item.type === 'video') this.openVideoViewer(url, item.name);
    else this.playAudio(item, url);
  },

  openImageViewer(url, name, allowNav = false) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="viewer-backdrop" id="viewerBackdrop">
        <img src="${url}" id="viewerImg" style="transform: rotate(0deg) scale(1)">
        <div class="viewer-controls">
          ${allowNav ? `<button class="btn" id="vPrev">◀ Prev</button>` : ''}
          <button class="btn" id="vRotate">⟳ Rotate</button>
          <button class="btn" id="vZoomIn">＋</button>
          <button class="btn" id="vZoomOut">－</button>
          ${allowNav ? `<button class="btn" id="vNext">Next ▶</button>` : ''}
          <button class="btn" id="vClose">✕ Close</button>
        </div>
      </div>`;
    let rotation = 0, zoom = 1;
    const img = document.getElementById('viewerImg');
    document.getElementById('vRotate').onclick = () => { rotation += 90; img.style.transform = `rotate(${rotation}deg) scale(${zoom})`; };
    document.getElementById('vZoomIn').onclick = () => { zoom = Math.min(zoom + 0.25, 3); img.style.transform = `rotate(${rotation}deg) scale(${zoom})`; };
    document.getElementById('vZoomOut').onclick = () => { zoom = Math.max(zoom - 0.25, 0.5); img.style.transform = `rotate(${rotation}deg) scale(${zoom})`; };
    document.getElementById('vClose').onclick = () => root.innerHTML = '';
    document.getElementById('viewerBackdrop').addEventListener('click', e => { if (e.target.id === 'viewerBackdrop') root.innerHTML = ''; });
    if (allowNav) {
      document.getElementById('vPrev').onclick = () => this.openAtIndex((this.queueIndex - 1 + this.queue.length) % this.queue.length);
      document.getElementById('vNext').onclick = () => this.openAtIndex((this.queueIndex + 1) % this.queue.length);
    }
  },

  openVideoViewer(url, name) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="viewer-backdrop" id="viewerBackdrop">
        <video src="${url}" controls autoplay disablePictureInPicture="false"></video>
        <div class="viewer-controls"><button class="btn" id="vClose">✕ Close</button></div>
      </div>`;
    document.getElementById('vClose').onclick = () => root.innerHTML = '';
    document.getElementById('viewerBackdrop').addEventListener('click', e => { if (e.target.id === 'viewerBackdrop') root.innerHTML = ''; });
  },

  playAudio(item, url) {
    const bar = document.getElementById('audioBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="audio-player-bar">
        <span>🎵</span>
        <div style="flex:1">
          <div style="font-size:13px">${escapeHtml(item.name)}</div>
          <audio id="audioEl" src="${url}" controls autoplay style="width:100%"></audio>
        </div>
        <button class="btn" id="aPrev">⏮</button>
        <button class="btn" id="aNext">⏭</button>
        <button class="btn" id="aShuffle">🔀</button>
        <button class="btn" id="aRepeat">🔁</button>
      </div>`;
    const audio = document.getElementById('audioEl');
    document.getElementById('aNext').onclick = () => this.openAtIndex((this.queueIndex + 1) % this.queue.length);
    document.getElementById('aPrev').onclick = () => this.openAtIndex((this.queueIndex - 1 + this.queue.length) % this.queue.length);
    document.getElementById('aShuffle').onclick = () => this.openAtIndex(Math.floor(Math.random() * this.queue.length));
    let repeat = false;
    document.getElementById('aRepeat').onclick = () => { repeat = !repeat; audio.loop = repeat; toast(repeat ? 'Repeat on' : 'Repeat off'); };
    audio.addEventListener('ended', () => { if (!repeat) this.openAtIndex((this.queueIndex + 1) % this.queue.length); });
  },
};
