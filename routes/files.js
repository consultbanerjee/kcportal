'use strict';
// File manager ("Explorer"): one folder tree per client plus one for the firm. Files live on the server and are mirrored to Google Drive
// (see drive.js). Deleting moves things to a Recycle Bin first; only an admin can delete permanently.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const L = require('../lib');
const Drive = require('./drive');
const { db, audit } = L;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });
const WRITE = ['admin', 'advocate', 'staff'], ADD = [...WRITE, 'accounts'], ALL = [...WRITE, 'accounts', 'client'];
const INLINE = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
const BAD = /[\\/:*?"<>|\u0000-\u001f]/;
// Every client gets the same four folders, in Drive and in the portal: Uploaded (what the client/office uploaded), Drafts, Judgements, Final (what was filed in court, scanned).
const CLIENT_DEFAULTS = ['Uploaded', 'Drafts', 'Judgements', 'Final', 'Shared', 'Recordings'];
const FIRM_DEFAULTS = ['Templates', 'Precedents', 'Office Records'];

const tidy = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();
const validName = (n) => n && n.length <= 150 && !BAD.test(n) && n !== '.' && n !== '..' && !/[. ]$/.test(n);

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const isCli = (req) => req.user.role === 'client';

  // ---------- helpers ----------
  const get = (t, id) => db.prepare('SELECT * FROM fs_nodes WHERE id=? AND tenant_id=?').get(id, t);
  const sameName = (t, clientId, parent, name, exceptId) => db.prepare(`SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND parent_id IS ? AND deleted_at IS NULL
    AND lower(name)=lower(?) AND id<>?`).get(t, clientId, parent, name, exceptId || 0);
  function unique(t, clientId, parent, name, suffix) {
    if (!sameName(t, clientId, parent, name)) return name;
    const ext = path.extname(name), base = ext ? name.slice(0, -ext.length) : name;
    for (let i = suffix ? 1 : 2; i < 500; i++) { const c = `${base}${suffix ? ' - ' + suffix + (i > 1 ? ' ' + i : '') : ' (' + i + ')'}${ext}`; if (!sameName(t, clientId, parent, c)) return c; }
    return `${base} ${Date.now()}${ext}`;
  }
  const dirty = (ids) => { if (ids.length) db.prepare(`UPDATE fs_nodes SET dirty=1, sync_tries=0, updated_at=CURRENT_TIMESTAMP WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids); };
  const subtree = (id) => db.prepare(`WITH RECURSIVE s(id) AS (SELECT id FROM fs_nodes WHERE id=? UNION ALL SELECT f.id FROM fs_nodes f JOIN s ON f.parent_id=s.id) SELECT id FROM s`).all(id).map((r) => r.id);
  const ancestors = (n) => { const out = []; let p = n.parent_id; while (p) { const r = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(p); if (!r) break; out.unshift(r); p = r.parent_id; } return out; };
  const visibleToClient = (n) => n.client_visible && ancestors(n).every((a) => a.client_visible);
  const inShared = (n) => !!n && (n.sys === 'shared' || ancestors(n).some((a) => a.sys === 'shared'));
  const shareBlocked = (t, cid) => !!(cid && (db.prepare('SELECT share_blocked b FROM clients WHERE id=? AND tenant_id=?').get(cid, t) || {}).b);
  // when the office has switched sharing off for a client, only what the client uploaded stays visible to them
  const clientMay = (t, n) => visibleToClient(n) && (!shareBlocked(t, n.client_id) || !!n.by_client || n.sys === 'client_inbox' || inInbox(n) && !!n.by_client);
  const inInbox = (n) => n.sys === 'client_inbox' || ancestors(n).some((a) => a.sys === 'client_inbox');

  // a shared file is only reachable if the folders above it are shared too (they then list only what is itself shared)
  const shareUp = (n) => ancestors(n).forEach((a) => db.prepare('UPDATE fs_nodes SET client_visible=1 WHERE id=?').run(a.id));
  function mkFolder(t, clientId, parent, name, uid, extra = {}) {
    const r = db.prepare('INSERT INTO fs_nodes(tenant_id,client_id,parent_id,kind,name,created_by,client_visible,sys) VALUES (?,?,?,?,?,?,?,?)')
      .run(t, clientId, parent, 'folder', name, uid || null, extra.visible ? 1 : 0, extra.sys || null);
    return r.lastInsertRowid;
  }
  function ensureInbox(t, clientId) {
    const r = db.prepare("SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id=? AND sys='client_inbox' AND deleted_at IS NULL").get(t, clientId);
    if (r) return r.id;
    const ex = db.prepare("SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id=? AND parent_id IS NULL AND kind='folder' AND deleted_at IS NULL AND lower(name)='uploaded'").get(t, clientId);
    if (ex) { db.prepare("UPDATE fs_nodes SET sys='client_inbox', client_visible=1 WHERE id=?").run(ex.id); return ex.id; }
    return mkFolder(t, clientId, null, 'Uploaded', null, { visible: true, sys: 'client_inbox' });
  }
  // First visit to an empty tree: lay out a sensible starter set of folders (once).
  function ensureShared(t, clientId, uid) {
    if (db.prepare("SELECT 1 FROM fs_nodes WHERE tenant_id=? AND client_id=? AND sys='shared' AND deleted_at IS NULL").get(t, clientId)) return;
    const ex = db.prepare("SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id=? AND parent_id IS NULL AND kind='folder' AND deleted_at IS NULL AND lower(name)='shared'").get(t, clientId);
    if (ex) db.prepare("UPDATE fs_nodes SET sys='shared', client_visible=1 WHERE id=?").run(ex.id); else mkFolder(t, clientId, null, 'Shared', uid, { sys: 'shared', visible: true });
  }
  // office-only folder for video-call recordings (made on demand, also for clients created before this existed)
  function recFolder(t, clientId) {
    seed(t, clientId, null);
    const r = db.prepare("SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id=? AND parent_id IS NULL AND kind='folder' AND deleted_at IS NULL AND lower(name)='recordings'").get(t, clientId);
    return r ? r.id : mkFolder(t, clientId, null, 'Recordings', null, { sys: 'cat' });
  }
  function seed(t, clientId, uid) {
    if (clientId) ensureShared(t, clientId, uid);
    const key = 'seeded:' + (clientId || 0);
    if (db.prepare('SELECT 1 FROM drive_folders WHERE tenant_id=? AND key=?').get(t, key)) return;
    // Marker is written once, so later deletions of default folders are respected.
    db.prepare('INSERT OR IGNORE INTO drive_folders (tenant_id,key,drive_id) VALUES (?,?,?)').run(t, key, '1');
    if (clientId) ensureInbox(t, clientId);
    (clientId ? CLIENT_DEFAULTS : FIRM_DEFAULTS).forEach((n) => { if (!db.prepare("SELECT 1 FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND parent_id IS NULL AND kind='folder' AND deleted_at IS NULL AND lower(name)=lower(?)").get(t, clientId, n)) mkFolder(t, clientId, null, n, uid, clientId ? (n === 'Shared' ? { sys: 'shared', visible: true } : { sys: 'cat' }) : {}); });
    if (clientId) db.prepare("UPDATE fs_nodes SET sys='cat' WHERE tenant_id=? AND client_id=? AND parent_id IS NULL AND sys IS NULL AND lower(name) IN ('drafts','judgements','final','recordings')").run(t, clientId);
    if (clientId) db.prepare("UPDATE fs_nodes SET sys='shared', client_visible=1 WHERE tenant_id=? AND client_id=? AND parent_id IS NULL AND sys IS NULL AND lower(name)='shared' AND deleted_at IS NULL").run(t, clientId);
  }
  function ensurePath(t, clientId, names, uid, visible) {
    let parent = null;
    for (const raw of names) {
      const name = tidy(raw).replace(BAD, '-').slice(0, 150);
      const ex = db.prepare('SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND parent_id IS ? AND deleted_at IS NULL AND kind=\'folder\' AND lower(name)=lower(?)').get(t, clientId, parent, name);
      parent = ex ? ex.id : mkFolder(t, clientId, parent, name, uid, { visible });
    }
    return parent;
  }
  async function putFile(t, o) {
    const name = unique(t, o.clientId, o.parent, tidy(o.name).replace(BAD, '-').slice(0, 150) || 'file');
    const md5 = crypto.createHash('md5').update(o.buffer).digest('hex');
    const direct = Drive.connected(t); // Google Drive is the only store: bytes go straight there, nothing is kept on this server
    const saved = direct ? { storage: 'gdrive', ref: null } : await L.storage.save(t, o.buffer, name); // (until Drive is connected, files wait on the server)
    const r = db.prepare(`INSERT INTO fs_nodes(tenant_id,client_id,parent_id,kind,name,mime,size,storage,storage_ref,md5,client_visible,created_by,by_client,matter_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t, o.clientId, o.parent, 'file', name, o.mime || null, o.buffer.length, saved.storage, saved.ref, md5, o.visible ? 1 : 0, o.uid || null, o.byClient ? 1 : 0, o.matterId || null);
    if (direct) {
      try { await Drive.pushBuffer(t, r.lastInsertRowid, o.buffer); }
      catch (e) { db.prepare('DELETE FROM fs_nodes WHERE id=?').run(r.lastInsertRowid); throw Object.assign(new Error('Could not save to Google Drive: ' + e.message), { status: 502 }); }
    }
    return { id: r.lastInsertRowid, name };
  }
  async function readBuffer(t, n) {
    const p = n.storage_ref && L.storage.path(t, n.storage_ref);
    if (p) return fs.readFileSync(p);
    if (n.drive_id && Drive.connected(t)) { const chunks = []; for await (const c of await Drive.download(t, n.drive_id, n.mime)) chunks.push(c); return Buffer.concat(chunks); }
    throw new Error('File "' + n.name + '" is not available right now.');
  }

  // Resolve who is looking at which tree.
  function scope(req, res, { write } = {}) {
    const t = T(req), role = req.user.role;
    if (role === 'telecaller' || !ALL.includes(role)) { res.status(403).json({ error: 'You do not have access to files.' }); return null; }
    let clientId;
    if (role === 'client') clientId = req.user.client_id;
    else {
      const raw = req.method === 'GET' ? req.query.client_id : req.body.client_id;
      clientId = raw === undefined || raw === '' || raw === '0' || raw === 'null' ? null : L.int(raw);
      if (clientId && !db.prepare('SELECT 1 FROM clients WHERE id=? AND tenant_id=?').get(clientId, t)) { res.status(404).json({ error: 'Client not found.' }); return null; }
    }
    if (write === 'edit' && !WRITE.includes(role)) { res.status(403).json({ error: 'Only advocates and staff can change files.' }); return null; }
    if (write === 'add' && !ADD.includes(role) && role !== 'client') { res.status(403).json({ error: 'You cannot add files.' }); return null; }
    return { t, clientId, role };
  }
  const card = (n, t) => ({ id: n.id, kind: n.kind, name: n.name, size: n.size, mime: n.mime, sys: n.sys, by_client: !!n.by_client, shared: !!n.client_visible,
    updated_at: n.updated_at, created_at: n.created_at, deleted_at: n.deleted_at,
    items: n.kind === 'folder' ? db.prepare('SELECT COUNT(*) c FROM fs_nodes WHERE parent_id=? AND deleted_at IS NULL').get(n.id).c : undefined,
    sync: !Drive.connected(t) ? 'local' : n.sync_error && n.sync_tries >= 5 ? 'error' : n.dirty ? 'pending' : 'synced' });

  // ---------- browse ----------
  app.get('/api/fs/list', L.requireLogin, async (req, res) => {
    const sc = scope(req, res); if (!sc) return;
    const { t, clientId } = sc, cli = sc.role === 'client';
    if (!cli) seed(t, clientId, req.user.id); else { ensureInbox(t, clientId); ensureShared(t, clientId, null); }
    const parentId = L.int(req.query.parent);
    try { await Drive.refreshFolder(t, clientId, parentId || null); } catch (e) { /* show what we have; Drive errors appear on the Storage page */ }
    let parent = null, crumbs = [];
    if (parentId) {
      parent = get(t, parentId);
      if (!parent || parent.kind !== 'folder' || parent.deleted_at || parent.client_id !== clientId) return res.status(404).json({ error: 'Folder not found.' });
      if (cli && !visibleToClient(parent)) return res.status(404).json({ error: 'Folder not found.' });
      crumbs = [...ancestors(parent), parent].map((a) => ({ id: a.id, name: a.name }));
    }
    let rows = db.prepare('SELECT * FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND parent_id IS ? AND deleted_at IS NULL ORDER BY kind, lower(name)').all(t, clientId, parentId || null);
    const blocked = cli && shareBlocked(t, clientId);
    if (cli) rows = rows.filter((n) => n.client_visible && (!blocked || n.by_client || n.sys === 'client_inbox'));
    const folderOnly = req.query.folders === '1';
    res.json({ share_blocked: !!blocked, client_id: clientId, parent: parentId || null, path: crumbs, can_edit: WRITE.includes(sc.role),
      can_add: cli ? !!(parent && inInbox(parent)) : ADD.includes(sc.role), can_purge: sc.role === 'admin',
      items: rows.filter((n) => !folderOnly || n.kind === 'folder').map((n) => card(n, t)) });
  });

  app.get('/api/fs/search', L.requireLogin, (req, res) => {
    const sc = scope(req, res); if (!sc) return;
    const term = '%' + L.str(req.query.q, 80).replace(/[%_]/g, '') + '%';
    if (term.length < 4) return res.json([]);
    let rows = db.prepare('SELECT * FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND deleted_at IS NULL AND name LIKE ? ORDER BY kind, lower(name) LIMIT 100').all(sc.t, sc.clientId, term);
    if (sc.role === 'client') rows = rows.filter((n) => clientMay(sc.t, n));
    res.json(rows.map((n) => ({ ...card(n, sc.t), parent: n.parent_id, where: ancestors(n).map((a) => a.name).join(' / ') || '(top)' })));
  });

  // ---------- create / upload ----------
  app.post('/api/fs/folder', L.requireLogin, (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    const name = tidy(req.body.name), parent = L.int(req.body.parent);
    if (!L.must(res, validName(name), 'Use a folder name without \\ / : * ? " < > | and not ending in a dot.')) return;
    if (parent) { const p = get(sc.t, parent); if (!p || p.kind !== 'folder' || p.deleted_at || p.client_id !== sc.clientId) return res.status(404).json({ error: 'Folder not found.' }); }
    if (sameName(sc.t, sc.clientId, parent || null, name)) return res.status(409).json({ error: 'A file or folder named "' + name + '" already exists here.' });
    const pn0 = parent ? get(sc.t, parent) : null, id = mkFolder(sc.t, sc.clientId, parent || null, name, req.user.id, { visible: inShared(pn0) });
    audit(sc.t, req.user.id, 'folder_created', 'fs', id, name, L.ip(req));
    res.json({ id });
  });

  app.post('/api/fs/upload', L.requireLogin, upload.array('files', 20), async (req, res) => {
    try {
      const sc = scope(req, res, { write: 'add' }); if (!sc) return;
      const parent = L.int(req.body.parent) || null, cli = sc.role === 'client';
      let pn = null;
      if (parent) { pn = get(sc.t, parent); if (!pn || pn.kind !== 'folder' || pn.deleted_at || pn.client_id !== sc.clientId) return res.status(404).json({ error: 'Folder not found.' }); }
      if (cli && !(pn && inInbox(pn))) return res.status(403).json({ error: 'Please upload into the "Uploaded" folder.' });
      if (!req.files || !req.files.length) return res.status(400).json({ error: 'Choose at least one file.' });
      const out = [], skipped = [];
      for (const f of req.files) {
        const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
        if (!L.ALLOWED_EXT.has(path.extname(name).toLowerCase())) { skipped.push(name + ' (type not allowed)'); continue; }
        const r = await putFile(sc.t, { clientId: sc.clientId, parent, name, buffer: f.buffer, mime: f.mimetype, uid: cli ? null : req.user.id, byClient: cli, visible: cli || inShared(pn) });
        out.push(r); audit(sc.t, req.user.id, 'file_uploaded', 'fs', r.id, r.name, L.ip(req));
      }
      res.json({ added: out, skipped });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Upload failed.' }); }
  });

  // ---------- rename / share ----------
  app.patch('/api/fs/:id', L.requireLogin, (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    const n = get(sc.t, req.params.id);
    if (!n || n.client_id !== sc.clientId || n.deleted_at) return res.status(404).json({ error: 'Not found.' });
    if (req.body.name !== undefined) {
      const name = tidy(req.body.name);
      if (n.sys) return res.status(400).json({ error: 'This folder is part of the system and cannot be renamed.' });
      if (!L.must(res, validName(name), 'Use a name without \\ / : * ? " < > | and not ending in a dot.')) return;
      if (name !== n.name) {
        if (sameName(sc.t, n.client_id, n.parent_id, name, n.id)) return res.status(409).json({ error: 'A file or folder named "' + name + '" already exists here.' });
        db.prepare('UPDATE fs_nodes SET name=? WHERE id=?').run(name, n.id); dirty([n.id]);
      }
    }
    if (req.body.shared !== undefined && sc.clientId) {
      const v = req.body.shared ? 1 : 0;
      if (n.sys) return res.status(400).json({ error: 'This folder is always shared with the client.' });
      db.prepare('UPDATE fs_nodes SET client_visible=? WHERE id=?').run(v, n.id);
      if (v) shareUp(n);
      if (n.kind === 'folder' && req.body.deep) db.prepare(`UPDATE fs_nodes SET client_visible=? WHERE id IN (${subtree(n.id).join(',')}) AND sys IS NULL`).run(v);
    }
    audit(sc.t, req.user.id, 'fs_updated', 'fs', n.id, n.name, L.ip(req));
    res.json({ ok: true });
  });

  // ---------- move / copy ----------
  function target(sc, body, res) {
    const toClient = sc.role === 'client' ? sc.clientId : (body.to_client === undefined ? sc.clientId : (L.int(body.to_client) || null));
    if (toClient && !db.prepare('SELECT 1 FROM clients WHERE id=? AND tenant_id=?').get(toClient, sc.t)) { res.status(404).json({ error: 'Client not found.' }); return null; }
    const parent = L.int(body.parent) || null;
    if (parent) { const p = get(sc.t, parent); if (!p || p.kind !== 'folder' || p.deleted_at || p.client_id !== toClient) { res.status(404).json({ error: 'Destination folder not found.' }); return null; } }
    return { toClient, parent };
  }
  const idsOf = (b) => [...new Set((Array.isArray(b.ids) ? b.ids : []).map((x) => L.int(x)).filter(Boolean))].slice(0, 200);

  app.post('/api/fs/move', L.requireLogin, (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    const dest = target(sc, req.body, res); if (!dest) return;
    const moved = [];
    for (const id of idsOf(req.body)) {
      const n = get(sc.t, id);
      if (!n || n.client_id !== sc.clientId || n.deleted_at) continue;
      if (n.sys) return res.status(400).json({ error: '"' + n.name + '" is a system folder and cannot be moved.' });
      const wasShared = inShared(n);
      const sub = n.kind === 'folder' ? subtree(n.id) : [n.id];
      if (dest.parent && sub.includes(dest.parent)) return res.status(400).json({ error: 'A folder cannot be moved into itself.' });
      if (n.parent_id === dest.parent && n.client_id === dest.toClient) continue;
      if (sameName(sc.t, dest.toClient, dest.parent, n.name)) return res.status(409).json({ error: '"' + n.name + '" already exists in the destination.' });
      db.prepare('UPDATE fs_nodes SET parent_id=?, client_id=? WHERE id=?').run(dest.parent, dest.toClient, n.id);
      if (n.client_id !== dest.toClient) { db.prepare(`UPDATE fs_nodes SET client_id=?, client_visible=0 WHERE id IN (${sub.join(',')})`).run(dest.toClient); }
      if (dest.toClient) { const dp = dest.parent ? get(sc.t, dest.parent) : null; if (inShared(dp)) { db.prepare(`UPDATE fs_nodes SET client_visible=1 WHERE id IN (${sub.join(',')})`).run(); shareUp(get(sc.t, n.id)); } else if (wasShared) db.prepare(`UPDATE fs_nodes SET client_visible=0 WHERE id IN (${sub.join(',')})`).run(); }
      dirty(sub); moved.push(n.id);
    }
    res.json({ moved });
  });

  app.post('/api/fs/copy', L.requireLogin, async (req, res) => {
    try {
      const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
      const dest = target(sc, req.body, res); if (!dest) return;
      let count = 0;
      const dShared = !!dest.toClient && inShared(dest.parent ? get(sc.t, dest.parent) : null);
      const copy = async (n, parent) => {
        if (++count > 500) throw Object.assign(new Error('Too many items to copy at once.'), { status: 400 });
        const name = unique(sc.t, dest.toClient, parent, n.name, 'Copy');
        if (n.kind === 'folder') {
          const id = mkFolder(sc.t, dest.toClient, parent, name, req.user.id, { visible: dShared });
          for (const c of db.prepare('SELECT * FROM fs_nodes WHERE parent_id=? AND deleted_at IS NULL').all(n.id)) await copy(c, id);
        } else await putFile(sc.t, { clientId: dest.toClient, parent, name, buffer: await readBuffer(sc.t, n), mime: n.mime, uid: req.user.id, visible: dShared });
      };
      for (const id of idsOf(req.body)) {
        const n = get(sc.t, id);
        if (!n || n.client_id !== sc.clientId || n.deleted_at || n.sys) continue;
        if (n.kind === 'folder' && dest.parent && subtree(n.id).includes(dest.parent)) return res.status(400).json({ error: 'A folder cannot be copied into itself.' });
        await copy(n, dest.parent);
      }
      res.json({ copied: count });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Copy failed.' }); if (!e.status) console.error(e); }
  });

  // ---------- recycle bin ----------
  app.post('/api/fs/trash', L.requireLogin, (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    let n = 0;
    for (const id of idsOf(req.body)) {
      const x = get(sc.t, id);
      if (!x || x.client_id !== sc.clientId || x.deleted_at) continue;
      if (x.sys) return res.status(400).json({ error: '"' + x.name + '" is a system folder and cannot be deleted.' });
      const sub = subtree(x.id);
      db.prepare(`UPDATE fs_nodes SET deleted_at=CURRENT_TIMESTAMP, deleted_by=?, del_root=? WHERE id IN (${sub.join(',')}) AND deleted_at IS NULL`).run(req.user.id, x.id);
      dirty(sub); n++; audit(sc.t, req.user.id, 'fs_deleted', 'fs', x.id, x.name, L.ip(req));
    }
    res.json({ deleted: n });
  });
  app.get('/api/fs/bin', L.requireLogin, (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    const rows = db.prepare('SELECT * FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND del_root=id ORDER BY deleted_at DESC LIMIT 300').all(sc.t, sc.clientId);
    res.json({ can_purge: sc.role === 'admin', items: rows.map((n) => card(n, sc.t)) });
  });
  app.post('/api/fs/restore', L.requireLogin, (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    let n = 0;
    for (const id of idsOf(req.body)) {
      const x = get(sc.t, id);
      if (!x || x.client_id !== sc.clientId || x.del_root !== x.id) continue;
      let parent = x.parent_id;
      if (parent) { const p = get(sc.t, parent); if (!p || p.deleted_at) parent = null; }
      const name = unique(sc.t, x.client_id, parent, x.name, 'restored');
      const sub = db.prepare('SELECT id FROM fs_nodes WHERE del_root=?').all(x.id).map((r) => r.id);
      db.prepare('UPDATE fs_nodes SET name=?, parent_id=? WHERE id=?').run(name, parent, x.id);
      db.prepare(`UPDATE fs_nodes SET deleted_at=NULL, deleted_by=NULL, del_root=NULL WHERE id IN (${sub.join(',')})`).run();
      dirty(sub); n++;
    }
    res.json({ restored: n });
  });
  function purge(t, ids) {
    for (const id of ids) {
      const rows = db.prepare('SELECT * FROM fs_nodes WHERE tenant_id=? AND del_root=?').all(t, id);
      for (const r of rows) {
        if (r.storage_ref) { const p = L.storage.path(t, r.storage_ref); if (p) { try { fs.unlinkSync(p); } catch (e) {} } }
        if (r.drive_id) db.prepare('INSERT INTO drive_tombstones(tenant_id,drive_id) VALUES (?,?)').run(t, r.drive_id);
      }
      db.prepare('DELETE FROM fs_nodes WHERE tenant_id=? AND del_root=?').run(t, id);
    }
  }
  app.post('/api/fs/purge', L.need('admin'), (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    const ids = idsOf(req.body).filter((id) => { const x = get(sc.t, id); return x && x.client_id === sc.clientId && x.del_root === x.id; });
    purge(sc.t, ids); ids.forEach((id) => audit(sc.t, req.user.id, 'fs_purged', 'fs', id, null, L.ip(req)));
    res.json({ purged: ids.length });
  });
  app.post('/api/fs/empty-bin', L.need('admin'), (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    const ids = db.prepare('SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND del_root=id').all(sc.t, sc.clientId).map((r) => r.id);
    purge(sc.t, ids); res.json({ purged: ids.length });
  });

  // "Sync now": push pending changes to Drive and pull whatever changed there (any office user may press it)
  app.post('/api/fs/sync', L.requireLogin, async (req, res) => {
    const sc = scope(req, res, { write: 'edit' }); if (!sc) return;
    if (!Drive.connected(sc.t)) return res.json({ connected: false });
    res.json({ connected: true, ...(await Drive.syncTenant(sc.t, 200)), ...Drive.pending(sc.t) });
  });

  // ---------- download / preview ----------
  app.get('/api/fs/:id/download', L.requireLogin, async (req, res) => {
    try {
      const t = T(req), n = get(t, req.params.id);
      if (!n || n.kind !== 'file' || (n.deleted_at && isCli(req))) return res.status(404).json({ error: 'Not found.' });
      if (req.user.role === 'telecaller') return res.status(403).json({ error: 'Not permitted.' });
      if (isCli(req) && (n.client_id !== req.user.client_id || !clientMay(t, n))) return res.status(404).json({ error: 'Not found.' });
      const nat = Drive.nativeExt(n.mime), dlName = nat && !n.name.toLowerCase().endsWith(nat) ? n.name + nat : n.name;
      const ext = path.extname(n.name).toLowerCase(), inline = req.query.inline === '1' && INLINE[ext];
      res.set({ 'Content-Type': inline || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Length': nat ? undefined : (n.size || undefined),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(dlName)}`, 'Cache-Control': 'private, no-store' });
      const p = n.storage_ref && L.storage.path(t, n.storage_ref);
      audit(t, req.user.id, 'file_downloaded', 'fs', n.id, null, L.ip(req));
      if (p) return fs.createReadStream(p).pipe(res);
      if (n.drive_id && Drive.connected(t)) return (await Drive.download(t, n.drive_id, n.mime)).pipe(res);
      res.status(404).json({ error: 'File is not available right now.' });
    } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Could not open the file.' }); }
  });

  // ---------- used by the older Matter > Documents screen ----------
  const matterFolder = (t, m, uid, visible) => { seed(t, m.client_id, uid); return ensurePath(t, m.client_id, ['Uploaded', m.file_no.replace(/\//g, '-')], uid, visible); };
  app.locals.fsHelpers = { recFolder, inShared, seed, unique, tidy, putFile, matterFolder, ensurePath, ensureInbox, shareUp, readBuffer };

  // one-time: bring files uploaded before this version into the new folder tree
  (function migrate() {
    const rows = db.prepare('SELECT d.*, m.file_no, m.client_id AS mclient FROM documents d LEFT JOIN matters m ON m.id=d.matter_id WHERE d.fs_id IS NULL').all();
    for (const d of rows) {
      try {
        const clientId = d.mclient || d.client_id || null;
        seed(d.tenant_id, clientId, null);
        const parent = d.file_no ? ensurePath(d.tenant_id, clientId, ['Uploaded', d.file_no.replace(/\//g, '-')], null, false) : ensurePath(d.tenant_id, clientId, ['Uploaded', 'Imported files'], null, false);
        const name = unique(d.tenant_id, clientId, parent, d.name);
        const r = db.prepare(`INSERT INTO fs_nodes(tenant_id,client_id,parent_id,kind,name,mime,size,storage,storage_ref,client_visible,created_by,created_at,matter_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.tenant_id, clientId, parent, 'file', name, d.mime, d.size || 0, d.storage || 'local', d.storage_ref, d.client_visible ? 1 : 0, d.uploaded_by, d.created_at, d.matter_id || null);
        if (d.client_visible) { const nn = get(d.tenant_id, r.lastInsertRowid); shareUp(nn); }
        db.prepare('UPDATE documents SET fs_id=? WHERE id=?').run(r.lastInsertRowid, d.id);
      } catch (e) { console.error('document migration:', e.message); }
    }
  })();
};
