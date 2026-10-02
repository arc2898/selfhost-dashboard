const Files = {
  path: '.',
  entries: [],
  selected: new Set(),
  view: 'grid',
  sortBy: 'name',
  order: 'asc',
  showHidden: false,

  render() {
    return `
      <div class="toolbar">
        <button class="btn primary" id="fmUpload">⬆ Upload</button>
        <button class="btn" id="fmNewFolder">＋ Folder</button>
        <button class="btn" id="fmNewFile">＋ File</button>
        <button class="btn" id="fmDownloadZip">⬇ Zip Selected</button>
        <button class="btn danger" id="fmDelete">🗑 Delete</button>
        <span style="flex:1"></span>
        <label class="stat-sub"><input type="checkbox" id="fmHidden"> Show hidden</label>
        <select id="fmSort" class="btn">
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
          <option value="type">Type</option>
        </select>
        <button class="btn" id="fmView">${this.view === 'grid' ? '☰ List' : '▦ Grid'}</button>
        <input type="file" id="fmFileInput" multiple hidden>
      </div>
      <div class="breadcrumbs" id="fmBreadcrumbs"></div>
      <div id="fmStorage" class="stat-sub" style="margin-bottom:10px"></div>
      <div id="fmContainer"></div>
    `;
  },

  onEnter() {
    document.getElementById('fmUpload').onclick = () => document.getElementById('fmFileInput').click();
    document.getElementById('fmFileInput').onchange = e => this.upload(e.target.files);
    document.getElementById('fmNewFolder').onclick = () => this.promptCreate('folder');
    document.getElementById('fmNewFile').onclick = () => this.promptCreate('file');
    document.getElementById('fmDownloadZip').onclick = () => this.downloadSelectedZip();
    document.getElementById('fmDelete').onclick = () => this.deleteSelected();
    document.getElementById('fmHidden').onchange = e => { this.showHidden = e.target.checked; this.load(); };
    document.getElementById('fmSort').onchange = e => { this.sortBy = e.target.value; this.load(); };
    document.getElementById('fmView').onclick = () => { this.view = this.view === 'grid' ? 'list' : 'grid'; this.render2(); };

    const container = document.getElementById('fmContainer');
    container.addEventListener('dragover', e => e.preventDefault());
    container.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) this.upload(e.dataTransfer.files); });

    this.load();
  },

  async load() {
    try {
      const data = await api(`/files/list?path=${encodeURIComponent(this.path)}&hidden=${this.showHidden}&sortBy=${this.sortBy}&order=${this.order}`);
      this.entries = data.entries;
      this.selected.clear();
      this.renderBreadcrumbs();
      if (data.storage) {
        document.getElementById('fmStorage').textContent =
          `${formatBytes(data.storage.usedBytes)} used of ${formatBytes(data.storage.totalBytes)} on this volume`;
      }
      this.render2();
    } catch (e) { toast(e.message, 'error'); }
  },

  renderBreadcrumbs() {
    const parts = this.path === '.' ? [] : this.path.split('/');
    let acc = '.';
    const crumbs = [`<span data-path=".">🏠 root</span>`];
    for (const p of parts) {
      acc = acc === '.' ? p : `${acc}/${p}`;
      crumbs.push(`<span data-path="${escapeHtml(acc)}">${escapeHtml(p)}</span>`);
    }
    const el = document.getElementById('fmBreadcrumbs');
    el.innerHTML = crumbs.join('<span>/</span>');
    el.querySelectorAll('span[data-path]').forEach(s => s.onclick = () => { this.path = s.dataset.path; this.load(); });
  },

  iconFor(entry) {
    if (entry.isDirectory) return '📁';
    const ext = entry.extension;
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return '🖼️';
    if (['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) return '🎞️';
    if (['.mp3', '.wav', '.flac', '.m4a'].includes(ext)) return '🎵';
    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return '🗜️';
    if (entry.isText) return '📄';
    return '📦';
  },

  render2() {
    const container = document.getElementById('fmContainer');
    if (!this.entries.length) { container.innerHTML = `<p class="stat-sub">This folder is empty.</p>`; return; }

    if (this.view === 'grid') {
      container.innerHTML = `<div class="file-grid">${this.entries.map(e => `
        <div class="file-tile" data-name="${escapeHtml(e.name)}" data-dir="${e.isDirectory}">
          <div class="ic">${this.iconFor(e)}</div>
          <div class="fname">${escapeHtml(e.name)}</div>
        </div>`).join('')}</div>`;
    } else {
      container.innerHTML = `<table class="data-table"><thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th><th>Permissions</th></tr></thead>
        <tbody>${this.entries.map(e => `
          <tr class="file-list-row" data-name="${escapeHtml(e.name)}" data-dir="${e.isDirectory}">
            <td>${this.iconFor(e)}</td><td>${escapeHtml(e.name)}</td>
            <td>${e.isDirectory ? '–' : formatBytes(e.sizeBytes)}</td>
            <td>${timeAgo(e.modifiedAt)}</td><td>${e.permissions}</td>
          </tr>`).join('')}</tbody></table>`;
    }

    container.querySelectorAll('[data-name]').forEach(el => {
      el.addEventListener('click', ev => this.onEntryClick(ev, el));
      el.addEventListener('dblclick', () => this.openEntry(el));
      el.addEventListener('contextmenu', ev => { ev.preventDefault(); this.selected = new Set([el.dataset.name]); this.render2(); this.showContextMenu(ev, el); });
    });
  },

  onEntryClick(ev, el) {
    const name = el.dataset.name;
    if (ev.ctrlKey || ev.metaKey) {
      this.selected.has(name) ? this.selected.delete(name) : this.selected.add(name);
    } else {
      this.selected = new Set([name]);
    }
    this.render2();
    // re-apply selection classes after re-render
    document.querySelectorAll('[data-name]').forEach(e2 => {
      if (this.selected.has(e2.dataset.name)) e2.classList.add(this.view === 'grid' ? 'selected' : 'selected');
    });
  },

  openEntry(el) {
    const name = el.dataset.name;
    const isDir = el.dataset.dir === 'true';
    const rel = this.path === '.' ? name : `${this.path}/${name}`;
    if (isDir) { this.path = rel; this.load(); return; }
    const entry = this.entries.find(e => e.name === name);
    if (entry.isText) return this.openEditor(rel);
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(entry.extension)) return Media.openImageViewer(`/api/files/raw?path=${encodeURIComponent(rel)}`, name);
    if (['.mp4', '.webm', '.mkv', '.mov'].includes(entry.extension)) return Media.openVideoViewer(`/api/files/raw?path=${encodeURIComponent(rel)}`, name);
    window.open(`/api/files/download?path=${encodeURIComponent(rel)}`, '_blank');
  },

  showContextMenu(ev, el) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    const name = el.dataset.name;
    const rel = this.path === '.' ? name : `${this.path}/${name}`;
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;
    menu.innerHTML = `
      <button data-a="open">Open</button>
      <button data-a="download">Download</button>
      <button data-a="rename">Rename</button>
      <button data-a="duplicate">Duplicate</button>
      <button data-a="zip">Download as ZIP</button>
      <button data-a="delete">Delete</button>
    `;
    document.body.appendChild(menu);
    const remove = () => menu.remove();
    setTimeout(() => document.addEventListener('click', remove, { once: true }), 0);
    menu.querySelector('[data-a="open"]').onclick = () => this.openEntry(el);
    menu.querySelector('[data-a="download"]').onclick = () => window.open(`/api/files/download?path=${encodeURIComponent(rel)}`, '_blank');
    menu.querySelector('[data-a="rename"]').onclick = () => this.promptRename(rel, name);
    menu.querySelector('[data-a="duplicate"]').onclick = async () => { await api('/files/duplicate', { method: 'POST', body: JSON.stringify({ path: rel }) }); toast('Duplicated', 'success'); this.load(); };
    menu.querySelector('[data-a="zip"]').onclick = () => window.open(`/api/files/download-zip?paths=${encodeURIComponent(rel)}&name=${encodeURIComponent(name)}`, '_blank');
    menu.querySelector('[data-a="delete"]').onclick = () => confirmDialog(`Delete "${name}"?`, async () => {
      await api('/files/delete', { method: 'POST', body: JSON.stringify({ paths: [rel] }) });
      toast('Deleted', 'success'); this.load();
    });
  },

  promptCreate(kind) {
    openModal({
      title: kind === 'folder' ? 'New Folder' : 'New File',
      bodyHtml: `<input type="text" id="createName" placeholder="${kind === 'folder' ? 'folder-name' : 'file.txt'}">`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        { label: 'Create', primary: true, onClick: async () => {
          const name = document.getElementById('createName').value.trim();
          if (!name) return;
          try {
            await api(kind === 'folder' ? '/files/mkdir' : '/files/create-file', { method: 'POST', body: JSON.stringify({ path: this.path, name }) });
            closeModal(); toast('Created', 'success'); this.load();
          } catch (e) { toast(e.message, 'error'); }
        }},
      ],
    });
  },

  promptRename(rel, currentName) {
    openModal({
      title: 'Rename',
      bodyHtml: `<input type="text" id="renameName" value="${escapeHtml(currentName)}">`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        { label: 'Rename', primary: true, onClick: async () => {
          const newName = document.getElementById('renameName').value.trim();
          if (!newName) return;
          try {
            await api('/files/rename', { method: 'POST', body: JSON.stringify({ path: rel, newName }) });
            closeModal(); toast('Renamed', 'success'); this.load();
          } catch (e) { toast(e.message, 'error'); }
        }},
      ],
    });
  },

  deleteSelected() {
    if (!this.selected.size) return toast('Nothing selected', 'error');
    const paths = [...this.selected].map(n => this.path === '.' ? n : `${this.path}/${n}`);
    confirmDialog(`Delete ${paths.length} item(s)? This cannot be undone.`, async () => {
      try { await api('/files/delete', { method: 'POST', body: JSON.stringify({ paths }) }); toast('Deleted', 'success'); this.load(); }
      catch (e) { toast(e.message, 'error'); }
    });
  },

  downloadSelectedZip() {
    if (!this.selected.size) return toast('Nothing selected', 'error');
    const paths = [...this.selected].map(n => this.path === '.' ? n : `${this.path}/${n}`);
    window.open(`/api/files/download-zip?paths=${encodeURIComponent(paths.join(','))}&name=archive`, '_blank');
  },

  async upload(fileList) {
    const form = new FormData();
    for (const f of fileList) form.append('files', f);
    toast(`Uploading ${fileList.length} file(s)…`);
    try {
      await api(`/files/upload?path=${encodeURIComponent(this.path)}`, { method: 'POST', body: form });
      toast('Upload complete', 'success');
      this.load();
    } catch (e) { toast(e.message, 'error'); }
  },

  async openEditor(rel) {
    try {
      const { content } = await api(`/files/content?path=${encodeURIComponent(rel)}`);
      openModal({
        title: `Edit: ${rel.split('/').pop()}`,
        wide: true,
        extraClass: 'editor-modal',
        bodyHtml: `<textarea id="codeEditor" spellcheck="false">${escapeHtml(content)}</textarea>`,
        footerButtons: [
          { label: 'Cancel', onClick: closeModal },
          { label: 'Save', primary: true, onClick: async () => {
            try {
              await api('/files/content', { method: 'PUT', body: JSON.stringify({ path: rel, content: document.getElementById('codeEditor').value }) });
              toast('Saved', 'success'); closeModal();
            } catch (e) { toast(e.message, 'error'); }
          }},
        ],
      });
    } catch (e) { toast(e.message, 'error'); }
  },

  search(query) {
    api(`/files/search?path=${encodeURIComponent(this.path)}&q=${encodeURIComponent(query)}`).then(res => {
      const container = document.getElementById('fmContainer');
      if (!container) return;
      if (!res.results.length) { container.innerHTML = `<p class="stat-sub">No matches for "${escapeHtml(query)}".</p>`; return; }
      container.innerHTML = `<ul>${res.results.map(r => `<li class="stat-sub">${escapeHtml(r)}</li>`).join('')}</ul>`;
    });
  },
};
