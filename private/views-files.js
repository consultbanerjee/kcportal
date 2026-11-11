'use strict';
/* ===== File Explorer (Windows-style) — used on every client page, the Firm Files page and the client's own "My files" page ===== */
const FX_COLORS = { pdf: '#c0392b', doc: '#2b5fb3', docx: '#2b5fb3', rtf: '#2b5fb3', odt: '#2b5fb3', xls: '#1f7a4d', xlsx: '#1f7a4d', csv: '#1f7a4d', ods: '#1f7a4d', ppt: '#c2571a', pptx: '#c2571a',
  jpg: '#7b4fa3', jpeg: '#7b4fa3', png: '#7b4fa3', gif: '#7b4fa3', webp: '#7b4fa3', tif: '#7b4fa3', tiff: '#7b4fa3', heic: '#7b4fa3', zip: '#6b7280', txt: '#6b7280', eml: '#0e7c86', msg: '#0e7c86',
  mp3: '#b8893b', m4a: '#b8893b', wav: '#b8893b', mp4: '#b8893b' };
const FX_FOLDER = '<svg viewBox="0 0 24 24" class="fxi"><path fill="#d9a441" d="M2 5.5A1.5 1.5 0 0 1 3.5 4h5l2 2H20.5A1.5 1.5 0 0 1 22 7.5v11A1.5 1.5 0 0 1 20.5 20h-17A1.5 1.5 0 0 1 2 18.5z"/><path fill="#ecc06a" d="M2 9h20v9.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5z"/></svg>';
const fxExt = (n) => (n.name.match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase();
const fxIcon = (n) => n.kind === 'folder' ? FX_FOLDER : `<span class="fxb" style="background:${FX_COLORS[fxExt(n)] || '#8a8f98'}">${esc((fxExt(n) || 'file').slice(0, 4).toUpperCase())}</span>`;
const fxSize = (b) => (b == null ? '' : b < 1024 ? b + ' B' : b < 1048576 ? Math.ceil(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
const fxType = (n) => n.kind === 'folder' ? 'File folder' : (fxExt(n) ? fxExt(n).toUpperCase() + ' file' : 'File');
const fxWhen = (s) => s ? new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z')).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const FX_SYNC = { synced: ['#1f7a4d', 'Saved in secure cloud storage'], pending: ['#b8893b', 'Waiting to be saved to secure cloud storage'], error: ['#b3261e', 'Could not save to secure cloud storage — see Storage settings'], local: null };

function explorer(host, o) {
  // o: { client: id|null, scopeName, cli: bool }
  const q0 = o.client ? `client_id=${o.client}` : '';
  const S = { parent: null, path: [], items: [], sel: new Set(), last: null, clip: null, sort: ['name', 1], view: 'details', bin: false, search: '', can_edit: false, can_add: false, can_purge: false, tree: new Map(), open: new Set() };
  const api = (p, extra = '') => `${p}?${[q0, extra].filter(Boolean).join('&')}`;
  const body = (b) => ({ ...(o.client ? { client_id: o.client } : {}), ...b });
  host.innerHTML = `<div class="fx"><div class="fx-bar noprint" id="fxbar"></div>
    <div class="fx-addr noprint"><button class="fxbtn" id="fxup" title="Up one level">↑</button><button class="fxbtn" id="fxref" title="Refresh">⟳</button><div class="fx-crumbs" id="fxcr"></div><input id="fxq" type="search" placeholder="Search files…" aria-label="Search files"></div>
    <div class="fx-body"><aside class="fx-nav" id="fxnav"></aside><section class="fx-main" id="fxmain" tabindex="0"></section></div><div class="fx-status" id="fxst"></div>
    <input type="file" id="fxfile" multiple hidden><input type="file" id="fxdir" webkitdirectory hidden></div><div class="fx-menu" id="fxmenu" hidden></div>`;
  Object.defineProperty(S, 'clip', { get: () => window.__fxclip || null, set: (v) => { window.__fxclip = v; } });
  const $$x = (s) => $(s, host);
  const byId = (id) => S.items.find((x) => x.id === id);
  const selItems = () => S.items.filter((x) => S.sel.has(x.id));
  const taken = (name) => S.items.some((x) => x.name.toLowerCase() === name.toLowerCase());

  /* ---------- data ---------- */
  async function load(keepSel) {
    try {
      if (S.search) { S.items = await GET(api('/api/fs/search', 'q=' + encodeURIComponent(S.search))); S.path = []; }
      else if (S.bin) { const r = await GET(api('/api/fs/bin')); S.items = r.items; S.can_purge = r.can_purge; S.path = []; }
      else { const r = await GET(api('/api/fs/list', S.parent ? 'parent=' + S.parent : '')); S.items = r.items; S.blocked = !!r.share_blocked; S.path = r.path; S.can_edit = r.can_edit; S.can_add = r.can_add; S.can_purge = r.can_purge; }
    } catch (e) { toast(e.message, true); if (S.parent) { S.parent = null; return load(); } }
    if (!keepSel) S.sel.clear();
    S.tree.clear(); draw();
  }
  const cd = (id) => { S.parent = id || null; S.bin = false; S.search = ''; $$x('#fxq').value = ''; S.last = null; load(); };

  /* ---------- drawing ---------- */
  function drawBar() {
    const e = S.can_edit && !S.bin && !S.search, b = [];
    const btn = (id, label, tip, on = true, cls = '') => `<button class="fxbtn ${cls}" id="${id}" title="${tip}" ${on ? '' : 'disabled'}>${label}</button>`;
    const n = S.sel.size, one = n === 1, anyFile = selItems().some((x) => x.kind === 'file');
    if (S.bin) return `${btn('fxback', '← Back to files', 'Leave the recycle bin')}<span class="fxsep"></span>${btn('fxrestore', 'Restore', 'Put back where it was', n > 0)}${S.can_purge ? btn('fxpurge', 'Delete permanently', 'Remove for good', n > 0, 'danger') + btn('fxempty', 'Empty recycle bin', 'Remove everything here for good', S.items.length > 0, 'danger') : ''}`;
    if (e) b.push(btn('fxnew', '＋ New folder', 'Create a folder here (Ctrl+Shift+N)'));
    if (S.can_add && !S.search) b.push(btn('fxup2', '⤒ Upload', 'Upload files'), btn('fxupd', '⤒ Upload folder', 'Upload a whole folder'));
    if (e) b.push('<span class="fxsep"></span>', btn('fxcut', 'Cut', 'Ctrl+X', n > 0), btn('fxcopy', 'Copy', 'Ctrl+C', n > 0), btn('fxmv', 'Move to…', 'Move to another folder, client or Firm Files', n > 0), btn('fxcp', 'Copy to…', 'Copy to another folder, client or Firm Files', n > 0), btn('fxpaste', 'Paste' + (S.clip ? ` (${S.clip.ids.length})` : ''), 'Ctrl+V', !!S.clip), '<span class="fxsep"></span>', btn('fxren', '✎ Rename', 'Rename file or folder (F2)', one && !selItems()[0].sys), btn('fxdel', 'Delete', 'Move to recycle bin (Del)', n > 0, 'danger'));
    b.push('<span class="fxsep"></span>', btn('fxdl', '⬇ Download', 'Download the selected file', one && anyFile));
    if (e && o.client) b.push(btn('fxshare', 'Share with client', 'Let the client see the selected items', n > 0));
    if (S.can_edit) b.push('<span class="fxsep"></span>', btn('fxsync', '⟳ Sync', 'Send changes to secure cloud storage and fetch anything changed there'), btn('fxbin', '🗑 Recycle bin', 'See deleted items'));
    b.push('<span class="fxsep"></span>', btn('fxview', S.view === 'details' ? '▦ Icons' : '☰ Details', 'Change the view'));
    return b.join('');
  }
  function drawList() {
    const [k, dir] = S.sort, items = [...S.items].sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : (k === 'size' ? (a.size || 0) - (b.size || 0) : k === 'date' ? String(a.updated_at).localeCompare(b.updated_at) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })) * dir));
    if (!items.length) return `<div class="fx-empty">${S.bin ? 'The recycle bin is empty.' : S.search ? 'Nothing matches your search.' : (S.blocked ? 'Document sharing is switched off for now. Please contact the office if you need a document.<br>' : 'This folder is empty.') + (S.can_add ? '<br>Drag files here, or use Upload.' : '')}</div>`;
    const row = (n) => {
      const sy = FX_SYNC[n.sync], cls = `${S.sel.has(n.id) ? 'sel' : ''} ${S.clip && S.clip.mode === 'cut' && S.clip.ids.includes(n.id) ? 'cutd' : ''}`;
      const sub = S.search ? `<div class="mute fxsub">${esc(n.where || '')}</div>` : '';
      if (S.view === 'icons') return `<div class="fxtile ${cls}" data-id="${n.id}" draggable="${S.can_edit && !S.bin}">${fxIcon(n)}<div class="fxnm">${esc(n.name)}</div>${S.can_edit && !S.bin && !n.sys ? `<button class="fxrb" data-ren="${n.id}" title="Rename">✎</button>` : ''}${n.shared && o.client ? '<div class="fxsh">shared</div>' : ''}</div>`;
      return `<tr class="${cls}" data-id="${n.id}" draggable="${S.can_edit && !S.bin}"><td class="fxname">${fxIcon(n)}<span class="fxnm">${esc(n.name)}</span>${n.shared && o.client && !o.cli ? ' <span class="pill ok">shared</span>' : ''}${n.by_client && !o.cli ? ' <span class="pill warn">from client</span>' : ''}${sub}</td>
        <td>${S.bin ? fxWhen(n.deleted_at) : fxWhen(n.updated_at)}</td><td>${fxType(n)}</td><td class="n">${n.kind === 'folder' ? (n.items != null ? n.items + ' item' + (n.items === 1 ? '' : 's') : '') : fxSize(n.size)}</td>
        <td class="fxdot">${S.can_edit && !S.bin && !n.sys ? `<button class="fxrb" data-ren="${n.id}" title="Rename (F2)">✎</button> ` : ''}${sy ? `<span title="${sy[1]}" style="color:${sy[0]}">●</span>` : ''}</td></tr>`;
    };
    if (S.view === 'icons') return `<div class="fxtiles">${items.map(row).join('')}</div>`;
    const arrow = (c) => (S.sort[0] === c ? (S.sort[1] > 0 ? ' ▲' : ' ▼') : '');
    return `<table class="fxt"><thead><tr><th data-sort="name">Name${arrow('name')}</th><th data-sort="date">${S.bin ? 'Deleted' : 'Date modified'}${arrow('date')}</th><th>Type</th><th class="n" data-sort="size">Size${arrow('size')}</th><th></th></tr></thead><tbody>${items.map(row).join('')}</tbody></table>`;
  }
  function drawTree() {
    const node = (id, name, depth) => {
      const kids = S.tree.get(id), isOpen = S.open.has(id);
      const cur = !S.bin && !S.search && (S.parent || 0) === id;
      return `<div class="fxtn ${cur ? 'cur' : ''}" data-tn="${id}" style="padding-left:${.4 + depth * .9}rem"><span class="fxtw" data-tw="${id}">${id === 0 || (kids && !kids.length) ? '' : isOpen ? '▾' : '▸'}</span>${FX_FOLDER}<span>${esc(name)}</span></div>${isOpen && kids ? kids.map((k) => node(k.id, k.name, depth + 1)).join('') : ''}`;
    };
    $$x('#fxnav').innerHTML = node(0, o.scopeName, 0);
  }
  async function openTree(id) {
    if (S.tree.has(id)) return;
    try { const r = await GET(api('/api/fs/list', `folders=1${id ? '&parent=' + id : ''}`)); S.tree.set(id, r.items.map((x) => ({ id: x.id, name: x.name }))); } catch (e) { S.tree.set(id, []); }
    drawTree(); wire();
  }
  function drawCrumbs() {
    const crumbs = S.bin ? [['Recycle bin', 'bin']] : S.search ? [['Search results', 'x']] : [[o.scopeName, 0], ...S.path.map((p) => [p.name, p.id])];
    $$x('#fxcr').innerHTML = crumbs.map(([n, id], i) => `<span class="fxc ${i === crumbs.length - 1 ? 'last' : ''}" data-cd="${id}">${esc(n)}</span>`).join('<span class="fxcs">›</span>');
  }
  function draw() {
    $$x('#fxbar').innerHTML = drawBar();
    $$x('#fxmain').innerHTML = drawList(); drawCrumbs(); drawTree();
    if (!S.search && !S.bin) { S.open.add(0); openTree(0); S.path.forEach((p) => { S.open.add(p.id); }); S.path.forEach((p) => openTree(p.id)); }
    status(); wire();
  }
  function status() {
    const sel = selItems(), size = sel.filter((x) => x.kind === 'file').reduce((s, x) => s + (x.size || 0), 0);
    $$x('#fxst').innerHTML = `${S.items.length} item${S.items.length === 1 ? '' : 's'}${sel.length ? ` · ${sel.length} selected${size ? ' · ' + fxSize(size) : ''}` : ''}`;
  }

  /* ---------- actions ---------- */
  const refresh = (keep) => load(keep);
  // quietly pick up changes made in storage / by colleagues (stops by itself when this screen is left)
  const auto = setInterval(() => { if (!host.isConnected) return clearInterval(auto); if (document.hidden || S.bin || S.search || document.querySelector('.overlay, .fxren')) return; const k = JSON.stringify(S.items.map((x) => [x.id, x.name, x.size])); GET(api('/api/fs/list', S.parent ? 'parent=' + S.parent : '')).then((r) => { if (JSON.stringify(r.items.map((x) => [x.id, x.name, x.size])) !== k) load(true); }).catch(() => {}); }, 20000);
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const newName = (base) => { if (!taken(base)) return base; for (let i = 2; ; i++) if (!taken(`${base} (${i})`)) return `${base} (${i})`; };
  const aNewFolder = guard(async () => { const r = await POST('/api/fs/folder', body({ parent: S.parent, name: newName('New folder') })); await load(); S.sel = new Set([r.id]); draw(); renameInline(r.id); });
  function renameInline(id) {
    const n = byId(id); if (!n || n.sys) return;
    const td = $(`[data-id="${id}"] .fxnm`, host); if (!td) return;
    const inp = document.createElement('input'); inp.className = 'fxren'; inp.value = n.name; td.replaceWith(inp); inp.focus();
    const dot = n.kind === 'file' ? n.name.lastIndexOf('.') : -1; inp.setSelectionRange(0, dot > 0 ? dot : n.name.length);
    let done = false;
    const fin = guard(async (ok) => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== n.name) { try { await PATCH('/api/fs/' + id, body({ name: v })); } catch (e) { toast(e.message, true); } } refresh(true); });
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
    inp.onblur = () => fin(true); inp.onclick = (e) => e.stopPropagation(); inp.ondblclick = (e) => e.stopPropagation();
  }
  const aDelete = guard(async () => { const s = selItems(); if (!s.length) return; if (!sure(s.length === 1 ? `Move "${s[0].name}" to the recycle bin?` : `Move these ${s.length} items to the recycle bin?`)) return; await POST('/api/fs/trash', body({ ids: s.map((x) => x.id) })); toast('Moved to the recycle bin.'); refresh(); });
  const aClip = (mode) => { const s = selItems().filter((x) => !x.sys); if (!s.length) return; S.clip = { mode, ids: s.map((x) => x.id), client: o.client }; toast(`${s.length} item${s.length === 1 ? '' : 's'} ${mode === 'cut' ? 'cut' : 'copied'}. Open the destination folder and choose Paste.`); draw(); };
  const aPaste = guard(async () => {
    const c = S.clip; if (!c) return;
    const b = { ids: c.ids, parent: S.parent, client_id: c.client || undefined, to_client: o.client || 0 };
    await POST(c.mode === 'cut' ? '/api/fs/move' : '/api/fs/copy', b); if (c.mode === 'cut') S.clip = null; toast(c.mode === 'cut' ? 'Moved.' : 'Copied.'); refresh();
  });

  const aMoveTo = (mode) => guard(async () => {
    const s = selItems().filter((x) => !x.sys); if (!s.length) return;
    const clients = await GET('/api/clients'), D = { client: o.client || 0, parent: null, path: [], dirs: [] };
    const m = show((mode === 'move' ? 'Move ' : 'Copy ') + (s.length === 1 ? '"' + s[0].name + '"' : s.length + ' items') + ' to…',
      `<p class="mute" style="margin:.2rem 0 .6rem">Pick where it should go — the firm's own files, or any client's folder. Items moved to a client stay hidden from the client until you share them.</p>
       <select id="fxdc" style="width:100%"><option value="0">Firm Files (office use only)</option>${clients.map((c) => `<option value="${c.id}">Client: ${esc(c.name)}</option>`).join('')}</select>
       <div class="fx-crumbs" id="fxdp" style="margin:.6rem 0"></div><div class="fx-pick" id="fxpl"></div>
       <div class="row end" style="margin-top:.8rem"><button class="btn ghost" id="fxdn">New folder here</button><button class="btn" id="fxdok">${mode === 'move' ? 'Move here' : 'Copy here'}</button></div>`, true);
    const E = (i) => $(i, m.el), sel = E('#fxdc'); sel.value = String(D.client);
    const q = () => `client_id=${D.client || ''}&parent=${D.parent || ''}`.replace('client_id=&', '');
    async function dl() {
      const r = await GET('/api/fs/list?' + q()); D.path = r.path; D.dirs = r.items.filter((x) => x.kind === 'folder');
      E('#fxdp').innerHTML = `<a data-p="">${esc(D.client ? (clients.find((c) => c.id === D.client) || {}).name : 'Firm Files')}</a>` + D.path.map((p) => ` › <a data-p="${p.id}">${esc(p.name)}</a>`).join('');
      E('#fxpl').innerHTML = D.dirs.length ? D.dirs.map((d) => `<div class="fx-pickrow" data-d="${d.id}">${FX_FOLDER} ${esc(d.name)}</div>`).join('') : '<div class="mute" style="padding:.6rem">No sub-folders here.</div>';
      $$('[data-d]', m.el).forEach((e) => (e.ondblclick = e.onclick = () => { D.parent = +e.dataset.d; dl(); }));
      $$('[data-p]', m.el).forEach((e) => (e.onclick = () => { D.parent = +e.dataset.p || null; dl(); }));
    }
    sel.onchange = () => { D.client = +sel.value; D.parent = null; dl(); };
    E('#fxdn').onclick = async () => { const nm = prompt('New folder name'); if (!nm) return; try { await POST('/api/fs/folder', { ...(D.client ? { client_id: D.client } : {}), parent: D.parent, name: nm }); dl(); } catch (e) { toast(e.message, true); } };
    E('#fxdok').onclick = async () => {
      try { await POST(mode === 'move' ? '/api/fs/move' : '/api/fs/copy', { ...(o.client ? { client_id: o.client } : {}), ids: s.map((x) => x.id), parent: D.parent, to_client: D.client });
        m.close(); toast(mode === 'move' ? 'Moved.' : 'Copied.'); refresh(); } catch (e) { toast(e.message, true); }
    };
    dl();
  })();
  const aDownload = () => { const f = selItems().filter((x) => x.kind === 'file'); f.slice(0, 5).forEach((x, i) => setTimeout(() => { const a = document.createElement('a'); a.href = `/api/fs/${x.id}/download`; a.download = x.name; document.body.appendChild(a); a.click(); a.remove(); }, i * 300)); };
  const aOpen = (n) => { if (!n) return; if (n.kind === 'folder') return cd(n.id); const inl = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt'].includes(fxExt(n)); window.open(`/api/fs/${n.id}/download${inl ? '?inline=1' : ''}`, '_blank'); };
  const aShare = guard(async () => {
    const s = selItems(); if (!s.length) return;
    const on = !s.every((x) => x.shared);
    if (!sure(on ? `Let the client see ${s.length === 1 ? '"' + s[0].name + '"' : s.length + ' items'}?` : 'Hide these from the client?')) return;
    for (const x of s) await PATCH('/api/fs/' + x.id, body({ shared: on, deep: x.kind === 'folder' })); toast(on ? 'Shared with the client.' : 'Hidden from the client.'); refresh(true);
  });
  const props = (n) => show('Properties', `<table class="fxp"><tr><td>Name</td><td>${esc(n.name)}</td></tr><tr><td>Type</td><td>${fxType(n)}</td></tr><tr><td>Location</td><td>${esc([o.scopeName, ...S.path.map((p) => p.name)].join(' / '))}</td></tr>
    ${n.kind === 'file' ? `<tr><td>Size</td><td>${fxSize(n.size)}</td></tr>` : `<tr><td>Contains</td><td>${n.items} item(s)</td></tr>`}<tr><td>Created</td><td>${fxWhen(n.created_at)}</td></tr><tr><td>Modified</td><td>${fxWhen(n.updated_at)}</td></tr>
    ${o.client && !o.cli ? `<tr><td>Client can see</td><td>${n.shared ? 'Yes' : 'No'}</td></tr>` : ''}${FX_SYNC[n.sync] ? `<tr><td>secure cloud storage</td><td>${FX_SYNC[n.sync][1]}</td></tr>` : ''}</table>`);

  /* uploads (files, dropped files, whole folders) */
  async function ensureDirs(rels) {
    const map = new Map([['', S.parent]]);
    for (const rel of [...new Set(rels)].sort()) {
      if (!rel) continue; let acc = '', par = S.parent;
      for (const seg of rel.split('/')) {
        acc = acc ? acc + '/' + seg : seg;
        if (map.has(acc)) { par = map.get(acc); continue; }
        const list = await GET(api('/api/fs/list', par ? 'parent=' + par : '')), ex = list.items.find((x) => x.kind === 'folder' && x.name.toLowerCase() === seg.toLowerCase());
        par = ex ? ex.id : (await POST('/api/fs/folder', body({ parent: par, name: seg }))).id; map.set(acc, par);
      }
    }
    return map;
  }
  const doUpload = guard(async (files) => {
    files = [...files].filter((f) => f.size >= 0); if (!files.length) return;
    if (!S.can_add) return toast('You cannot add files here.', true);
    const big = files.filter((f) => f.size > 25 * 1048576); if (big.length) toast(`${big.length} file(s) over 25 MB were skipped.`, true);
    files = files.filter((f) => f.size <= 25 * 1048576);
    const rels = files.map((f) => { const p = (f.webkitRelativePath || '').split('/'); p.pop(); return p.join('/'); });
    const dirs = S.can_edit ? await ensureDirs(rels) : new Map([['', S.parent]]);
    const groups = new Map(); files.forEach((f, i) => { const k = dirs.get(rels[i]) ?? S.parent; (groups.get(k) || groups.set(k, []).get(k)).push(f); });
    let done = 0, skipped = [];
    for (const [parent, list] of groups) {
      for (let i = 0; i < list.length;) {
        let size = 0; const batch = []; while (i < list.length && batch.length < 10 && size + list[i].size < 60 * 1048576) { size += list[i].size; batch.push(list[i++]); } if (!batch.length) batch.push(list[i++]);
        const fd = new FormData(); if (o.client) fd.append('client_id', o.client); if (parent) fd.append('parent', parent); batch.forEach((f) => fd.append('files', f, f.name));
        toast(`Uploading ${done + 1}–${done + batch.length} of ${files.length}…`);
        const r = await POST('/api/fs/upload', fd); done += r.added.length; skipped.push(...r.skipped);
      }
    }
    toast(`${done} file${done === 1 ? '' : 's'} uploaded.${skipped.length ? ' Skipped: ' + skipped.join(', ') : ''}`, skipped.length > 0); refresh();
  });

  /* ---------- events ---------- */
  function select(id, e) {
    if (e && e.shiftKey && S.last) { const ids = S.items.map((x) => x.id), a = ids.indexOf(S.last), b = ids.indexOf(id); S.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); }
    else if (e && (e.ctrlKey || e.metaKey)) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.last = id; }
    else { S.sel = new Set([id]); S.last = id; }
    $$('[data-id]', host).forEach((r) => r.classList.toggle('sel', S.sel.has(+r.dataset.id))); $$x('#fxbar').innerHTML = drawBar(); status(); wireBar();
  }
  function menu(e, n) {
    e.preventDefault(); const m = $$x('#fxmenu') || $('#fxmenu');
    if (n && !S.sel.has(n.id)) select(n.id);
    const it = [], sel = selItems(), ed = S.can_edit && !S.bin;
    if (S.bin) { if (n) it.push(['Restore', 'restore']); if (n && S.can_purge) it.push(['Delete permanently', 'purge']); }
    else if (n) { it.push(['Open', 'open']); if (n.kind === 'file') it.push(['Download', 'dl']); if (ed) { it.push(['—'], ['Cut', 'cut'], ['Copy', 'copy'], ['Move to…', 'mvto'], ['Copy to…', 'cpto']); if (!n.sys) it.push(['Rename', 'ren']); if (o.client) it.push([sel.every((x) => x.shared) ? 'Hide from client' : 'Share with client', 'share']); it.push(['—'], ['Delete', 'del']); } it.push(['—'], ['Properties', 'props']); }
    else { if (ed) { it.push(['New folder', 'new']); if (S.clip) it.push(['Paste', 'paste']); } if (S.can_add && !S.search) it.push(['Upload files…', 'upl']); it.push(['Refresh', 'ref']); }
    m.innerHTML = it.map(([l, a]) => (l === '—' ? '<hr>' : `<div data-a="${a}">${l}</div>`)).join(''); m.hidden = false;
    m.style.left = Math.min(e.clientX, innerWidth - 200) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - m.childElementCount * 32) + 'px';
    m.onclick = (ev) => { const a = ev.target.dataset.a; m.hidden = true; if (!a) return; ({ open: () => aOpen(n), dl: aDownload, cut: () => aClip('cut'), copy: () => aClip('copy'), mvto: () => aMoveTo('move'), cpto: () => aMoveTo('copy'), ren: () => renameInline(n.id), share: aShare, del: aDelete, props: () => props(n), new: aNewFolder, paste: aPaste, upl: () => $$x('#fxfile').click(), ref: () => refresh(true), restore: aRestore, purge: aPurge })[a](); };
  }
  const aRestore = guard(async () => { await POST('/api/fs/restore', body({ ids: [...S.sel] })); toast('Restored.'); refresh(); });
  const aPurge = guard(async () => { const s = selItems(); if (!s.length || !sure(`Permanently delete ${s.length} item(s)? This cannot be undone.`)) return; await POST('/api/fs/purge', body({ ids: s.map((x) => x.id) })); refresh(); });
  function wireBar() {
    const on = (id, fn) => { const b = $$x('#' + id); if (b) b.onclick = fn; };
    on('fxnew', aNewFolder); on('fxup2', () => $$x('#fxfile').click()); on('fxupd', () => $$x('#fxdir').click()); on('fxcut', () => aClip('cut')); on('fxcopy', () => aClip('copy')); on('fxpaste', aPaste); on('fxsync', guard(async () => { const r = await POST('/api/fs/sync', body({})); toast(r.connected ? 'Synced with secure cloud storage.' : 'secure cloud storage is not connected yet.'); refresh(true); })); on('fxmv', () => aMoveTo('move')); on('fxcp', () => aMoveTo('copy'));
    on('fxren', () => renameInline([...S.sel][0])); on('fxdel', aDelete); on('fxdl', aDownload); on('fxshare', aShare);
    on('fxbin', () => { S.bin = true; S.sel.clear(); load(); }); on('fxback', () => { S.bin = false; load(); }); on('fxrestore', aRestore); on('fxpurge', aPurge);
    on('fxempty', guard(async () => { if (!sure('Permanently delete everything in the recycle bin? This cannot be undone.')) return; await POST('/api/fs/empty-bin', body({})); refresh(); }));
    on('fxview', () => { S.view = S.view === 'details' ? 'icons' : 'details'; draw(); });
  }
  function wire() {
    wireBar(); const main = $$x('#fxmain');
    $$('[data-sort]', main).forEach((th) => (th.onclick = () => { S.sort = [th.dataset.sort, S.sort[0] === th.dataset.sort ? -S.sort[1] : 1]; draw(); }));
    $$('[data-id]', main).forEach((r) => {
      const id = +r.dataset.id;
      r.onclick = (e) => { e.stopPropagation(); if (e.target.dataset.ren) { select(id); return renameInline(id); } select(id, e); };
      r.ondblclick = (e) => { e.stopPropagation(); if (!S.bin) aOpen(byId(id)); };
      r.oncontextmenu = (e) => { e.stopPropagation(); menu(e, byId(id)); };
      r.ondragstart = (e) => { if (!S.sel.has(id)) select(id); e.dataTransfer.setData('text/x-kc', JSON.stringify([...S.sel])); e.dataTransfer.effectAllowed = 'copyMove'; };
      if (byId(id).kind === 'folder') {
        r.ondragover = (e) => { if (S.can_edit && !S.bin) { e.preventDefault(); e.stopPropagation(); r.classList.add('drop'); } };
        r.ondragleave = () => r.classList.remove('drop');
        r.ondrop = guard(async (e) => { e.preventDefault(); e.stopPropagation(); r.classList.remove('drop'); const raw = e.dataTransfer.getData('text/x-kc'); if (!raw) return dropFiles(e, id); const ids = JSON.parse(raw).filter((x) => x !== id);
          await POST(e.ctrlKey ? '/api/fs/copy' : '/api/fs/move', body({ ids, parent: id, to_client: o.client || 0 })); toast(e.ctrlKey ? 'Copied.' : 'Moved.'); refresh(); });
      }
    });
    main.onclick = () => { S.sel.clear(); S.last = null; draw(); };
    main.oncontextmenu = (e) => menu(e, null);
    main.ondragover = (e) => { if (S.can_add && !S.bin) { e.preventDefault(); main.classList.add('dropz'); } };
    main.ondragleave = () => main.classList.remove('dropz');
    main.ondrop = (e) => { e.preventDefault(); main.classList.remove('dropz'); dropFiles(e, S.parent); };
    $$('[data-cd]', host).forEach((c) => (c.onclick = () => { const v = c.dataset.cd; if (v === 'bin' || v === 'x') return; cd(+v); }));
    $$('[data-tn]', host).forEach((t) => {
      const id = +t.dataset.tn;
      t.onclick = (e) => { if (e.target.dataset.tw !== undefined) { S.open.has(id) ? S.open.delete(id) : S.open.add(id); if (S.open.has(id)) openTree(id); else drawTree(); wireTree(); return; } cd(id); };
      t.ondragover = (e) => { if (S.can_edit) { e.preventDefault(); t.classList.add('drop'); } }; t.ondragleave = () => t.classList.remove('drop');
      t.ondrop = guard(async (e) => { e.preventDefault(); t.classList.remove('drop'); const raw = e.dataTransfer.getData('text/x-kc'); if (!raw) return; await POST('/api/fs/move', body({ ids: JSON.parse(raw), parent: id || null, to_client: o.client || 0 })); refresh(); });
    });
  }
  const wireTree = () => wire();
  async function dropFiles(e, parent) {
    const files = [...(e.dataTransfer.files || [])].filter((f) => f.type || f.size); if (!files.length) return;
    const keep = S.parent; S.parent = parent || null; try { await doUpload(files); } finally { S.parent = keep; }
  }
  $$x('#fxfile').onchange = (e) => { doUpload(e.target.files); e.target.value = ''; };
  $$x('#fxdir').onchange = (e) => { doUpload(e.target.files); e.target.value = ''; };
  $$x('#fxup').onclick = () => { if (S.bin || S.search) return cd(S.parent); const up = S.path.length > 1 ? S.path[S.path.length - 2].id : null; if (S.path.length) cd(up); };
  $$x('#fxref').onclick = () => refresh(true);
  let st; $$x('#fxq').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { S.search = e.target.value.trim(); S.bin = false; if (S.search.length >= 3 || !S.search) load(); }, 300); };
  const key = (e) => {
    if (!host.isConnected) return document.removeEventListener('keydown', key);
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector('.overlay')) return;
    const c = e.ctrlKey || e.metaKey;
    if (c && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.items.map((x) => x.id)); draw(); }
    else if (c && e.key.toLowerCase() === 'c' && S.can_edit) aClip('copy'); else if (c && e.key.toLowerCase() === 'x' && S.can_edit) aClip('cut'); else if (c && e.key.toLowerCase() === 'v' && S.can_edit) aPaste();
    else if (c && e.shiftKey && e.key.toLowerCase() === 'n' && S.can_edit) { e.preventDefault(); aNewFolder(); }
    else if (e.key === 'Delete' && S.can_edit && !S.bin) aDelete();
    else if (e.key === 'F2' && S.sel.size === 1 && S.can_edit) { e.preventDefault(); renameInline([...S.sel][0]); }
    else if (e.key === 'Enter' && S.sel.size === 1) aOpen(selItems()[0]);
    else if (e.key === 'Backspace') { e.preventDefault(); $$x('#fxup').click(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.items.length) {
      e.preventDefault(); const ids = [...$$('[data-id]', host)].map((r) => +r.dataset.id), i = ids.indexOf(S.last), n = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1); select(ids[n], e);
    } else if (e.key === 'Escape') { $$x('#fxmenu').hidden = true; }
  };
  document.addEventListener('keydown', key);
  document.addEventListener('click', () => { const m = $('#fxmenu'); if (m) m.hidden = true; });
  load();
}

/* ===== pages ===== */
route(/^\/files$/, async () => {
  view(`<div class="row sp"><h1>Firm files</h1></div><p class="mute">The firm's own library — templates, precedents and office records. Each client's papers are kept on that client's page, under <b>Files</b>.</p><div id="fx"></div>`);
  explorer($('#fx'), { client: null, scopeName: 'Firm files', cli: false });
}, { office: true, roles: ['admin', 'advocate', 'staff', 'accounts'] });

route(/^\/myfiles$/, async () => {
  view(`<h1>My files</h1><p class="mute">Documents your advocate has shared with you appear here. To send us papers, open <b>Uploaded</b> and upload. For safety, files you upload cannot be changed or removed — please contact the office if you need that.</p><div id="fx"></div>`);
  explorer($('#fx'), { client: ME.client_id, scopeName: 'My files', cli: true });
}, { client: true });

