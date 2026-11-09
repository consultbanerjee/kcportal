'use strict';
// Google Drive storage for the file manager.
// Files are saved on the server first (fast, reliable), then a background worker mirrors the folder tree and files into the firm's own
// Google Drive (OAuth). Two-way: edits made in Google Drive (or Drive for desktop on Windows) are pulled back into the portal. Once Drive confirms the upload (matching MD5) the local
// copy can be removed to save disk. Everything goes through one injectable transport so tests never touch the network.
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const L = require('../lib');
const AI = require('../aicore');
const { db } = L;

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = ['drive', 'userinfo.email', 'calendar.events', 'meetings.space.created', 'meetings.space.readonly', 'contacts'].map((x) => 'https://www.googleapis.com/auth/' + x).join(' ');
const scopes = (t) => S(t, 'drive_scopes');
const canContacts = (t) => connected(t) && /auth\/contacts(\s|$)/.test(scopes(t));
const canMeet = (t) => connected(t) && /calendar\.events/.test(scopes(t));
const ROOT_NAME = 'KcLegalPortal';

let transport = async (method, url, { headers, body } = {}) => {
  const r = await fetch(url, { method, headers, body });
  return { status: r.status, headers: r.headers, body: r };
};
const setTransport = (t) => { transport = t; };

const S = (t, k) => AI.getS(t, k) || '';
const cfg = (t) => ({
  client_id: S(t, 'drive_client_id'), client_secret: AI.dec(S(t, 'drive_client_secret')), refresh: AI.dec(S(t, 'drive_refresh')),
  email: S(t, 'drive_email'), keep_local: S(t, 'drive_keep_local') === '1',
});
const configured = (t) => { const c = cfg(t); return !!(c.client_id && c.client_secret); };
const connected = (t) => !!cfg(t).refresh;

const tokens = new Map();
async function accessToken(t) {
  const hit = tokens.get(t);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const c = cfg(t);
  if (!c.refresh) throw new Error('Google Drive is not connected.');
  const r = await transport('POST', TOKEN, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh, grant_type: 'refresh_token' }).toString() });
  const j = await r.body.json().catch(() => ({}));
  if (r.status !== 200 || !j.access_token) throw new Error('Google refused the sign-in' + (j.error ? ' (' + j.error + ')' : '') + '. Reconnect Google Drive.');
  tokens.set(t, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

async function call(t, method, url, { json, headers = {}, body, raw } = {}) {
  const h = { Authorization: 'Bearer ' + await accessToken(t), ...headers };
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const r = await transport(method, url, { headers: h, body });
  if (raw && r.status < 300) return r;
  const j = await r.body.json().catch(() => ({}));
  if (r.status >= 300) throw new Error((j.error && (j.error.message || j.error)) || 'Google Drive error ' + r.status);
  return j;
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function createFolder(t, name, parent) {
  const j = await call(t, 'POST', API + '/files?fields=id', { json: { name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) } });
  return j.id;
}
async function findChild(t, parent, name) {
  const j = await call(t, 'GET', `${API}/files?` + new URLSearchParams({ q: `'${q(parent)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${q(name)}'`, fields: 'files(id)', pageSize: '1' }).toString());
  return j.files && j.files[0] ? j.files[0].id : null;
}
// A named system folder (root, firm, per-client) is found (so folders made by hand are reused) or created once, and remembered.
async function sysFolder(t, key, name, parent) {
  const row = db.prepare('SELECT drive_id FROM drive_folders WHERE tenant_id=? AND key=?').get(t, key);
  if (row) return row.drive_id;
  const id = (await findChild(t, parent || 'root', name)) || (await createFolder(t, name, parent));
  db.prepare('INSERT OR REPLACE INTO drive_folders(tenant_id,key,drive_id) VALUES (?,?,?)').run(t, key, id);
  return id;
}
// Name of a client's folder: the client's name; two clients with the same name get "(id)" added to the later one.
function clientFolderName(t, clientId) {
  const c = db.prepare('SELECT name FROM clients WHERE id=? AND tenant_id=?').get(clientId, t);
  const base = (c ? c.name : 'Client').replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').trim() || 'Client';
  const dup = db.prepare('SELECT 1 FROM clients WHERE tenant_id=? AND id<>? AND id<? AND lower(trim(name))=lower(?)').get(t, clientId, clientId, base);
  return dup ? `${base} (${clientId})` : base;
}
async function scopeRoot(t, clientId) {
  const root = await sysFolder(t, 'root', ROOT_NAME);
  if (!clientId) return sysFolder(t, 'firm', 'Firm Files', root);
  const had = db.prepare('SELECT 1 FROM drive_folders WHERE tenant_id=? AND key=?').get(t, 'client:' + clientId);
  const id = await sysFolder(t, 'client:' + clientId, clientFolderName(t, clientId), root);
  if (!had) db.prepare('INSERT OR REPLACE INTO drive_folders(tenant_id,key,drive_id) VALUES (?,?,?)').run(t, 'cname:' + clientId, clientFolderName(t, clientId));
  return id;
}
// A client renamed in the portal is renamed in Drive too.
async function syncClientNames(t) {
  for (const r of db.prepare("SELECT key,drive_id FROM drive_folders WHERE tenant_id=? AND key LIKE 'client:%'").all(t)) {
    const cid = +r.key.split(':')[1], want = clientFolderName(t, cid);
    const cur = db.prepare('SELECT drive_id FROM drive_folders WHERE tenant_id=? AND key=?').get(t, 'cname:' + cid);
    if (cur && cur.drive_id === want) continue;
    try { await patch(t, r.drive_id, { name: want }); db.prepare('INSERT OR REPLACE INTO drive_folders(tenant_id,key,drive_id) VALUES (?,?,?)').run(t, 'cname:' + cid, want); } catch (e) { /* retried next round */ }
  }
}

async function uploadFile(t, name, mime, parent, buffer) {
  const b = 'kc' + crypto.randomBytes(8).toString('hex');
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`), buffer, Buffer.from(`\r\n--${b}--`)]);
  return call(t, 'POST', UP + '/files?uploadType=multipart&fields=id,md5Checksum', { headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
}
const NATIVE = { 'application/vnd.google-apps.document': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  'application/vnd.google-apps.presentation': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  'application/vnd.google-apps.drawing': ['application/pdf', '.pdf'] };
const isNative = (m) => !!m && m.startsWith('application/vnd.google-apps.') && m !== 'application/vnd.google-apps.folder';
const nativeExt = (m) => (isNative(m) ? (NATIVE[m] || ['application/pdf', '.pdf'])[1] : '');
async function download(t, driveId, mime) {
  const url = isNative(mime) ? `${API}/files/${encodeURIComponent(driveId)}/export?mimeType=${encodeURIComponent((NATIVE[mime] || ['application/pdf'])[0])}` : `${API}/files/${encodeURIComponent(driveId)}?alt=media`;
  const r = await call(t, 'GET', url, { raw: true });
  return Readable.from([Buffer.from(await r.body.arrayBuffer())]);
}
async function patch(t, id, json, query = '') { return call(t, 'PATCH', `${API}/files/${encodeURIComponent(id)}?fields=id${query}`, { json }); }

// ---------- reconcile one node with Drive ----------
async function reconcile(t, n, depth = 0) {
  if (depth > 40) throw new Error('Folder nesting is too deep.');
  const nodeDeleted = !!n.deleted_at;
  if (nodeDeleted && !n.drive_id) return done(n);
  if (nodeDeleted) {
    if (!n.drive_trashed) await patch(t, n.drive_id, { trashed: true });
    return db.prepare('UPDATE fs_nodes SET drive_trashed=1, dirty=0, sync_error=NULL, sync_tries=0 WHERE id=?').run(n.id);
  }
  let parent;
  if (n.parent_id) {
    const p = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(n.parent_id);
    if (!p.drive_id || p.drive_trashed) { await reconcile(t, p, depth + 1); }
    parent = db.prepare('SELECT drive_id FROM fs_nodes WHERE id=?').get(n.parent_id).drive_id;
  } else parent = await scopeRoot(t, n.client_id);
  if (n.drive_id && n.drive_trashed) { await patch(t, n.drive_id, { trashed: false }); n.drive_trashed = 0; }
  if (!n.drive_id) {
    if (n.kind === 'folder') { let id = await findChild(t, parent, n.name); if (id && byDrive(t, id)) id = null; id = id || await createFolder(t, n.name, parent); db.prepare('UPDATE fs_nodes SET drive_id=?, drive_name=?, drive_parent=? WHERE id=?').run(id, n.name, parent, n.id); }
    else {
      if (!n.storage_ref) return; // being saved straight to Drive by pushBuffer
      const p = L.storage.path(t, n.storage_ref);
      if (!p) throw new Error('Local copy of "' + n.name + '" is missing.');
      const buf = fs.readFileSync(p);
      const j = await uploadFile(t, n.name, n.mime, parent, buf);
      db.prepare('UPDATE fs_nodes SET drive_id=?, drive_name=?, drive_parent=? WHERE id=?').run(j.id, n.name, parent, n.id);
      // only drop the local copy once Drive confirms the same bytes
      const same = !j.md5Checksum || !n.md5 || j.md5Checksum === n.md5;
      if (same) { try { fs.unlinkSync(p); } catch (e) {} db.prepare("UPDATE fs_nodes SET storage='gdrive' WHERE id=?").run(n.id); }
      if (!same) throw new Error('Drive checksum mismatch for "' + n.name + '".');
    }
  } else if (n.drive_name !== n.name || n.drive_parent !== parent) {
    const moved = n.drive_parent && n.drive_parent !== parent;
    await call(t, 'PATCH', `${API}/files/${encodeURIComponent(n.drive_id)}?fields=id${moved ? `&addParents=${encodeURIComponent(parent)}&removeParents=${encodeURIComponent(n.drive_parent)}` : ''}`, { json: { name: n.name } });
    db.prepare('UPDATE fs_nodes SET drive_name=?, drive_parent=? WHERE id=?').run(n.name, parent, n.id);
  }
  return done(n);
}
const done = (n) => db.prepare('UPDATE fs_nodes SET dirty=0, sync_error=NULL, sync_tries=0, drive_trashed=CASE WHEN deleted_at IS NULL THEN 0 ELSE drive_trashed END WHERE id=?').run(n.id);


// ---------- Drive -> portal ----------
const FIELDS = 'id,name,mimeType,parents,trashed,md5Checksum,size';
const BADN = /[\\/:*?"<>|\u0000-\u001f]/;
const folderKeys = (t) => {
  const m = { root: null, firm: null, clients: new Map() };
  for (const r of db.prepare("SELECT key,drive_id FROM drive_folders WHERE tenant_id=? AND (key IN ('root','firm') OR key LIKE 'client:%')").all(t)) {
    if (r.key === 'root') m.root = r.drive_id; else if (r.key === 'firm') m.firm = r.drive_id; else m.clients.set(r.drive_id, +r.key.split(':')[1]);
  }
  return m;
};
const sharedUp = (id) => { for (let g = 0; id && g < 40; g++) { const r = db.prepare('SELECT parent_id,sys FROM fs_nodes WHERE id=?').get(id); if (!r) return false; if (r.sys === 'shared') return true; id = r.parent_id; } return false; };
const byDrive = (t, id) => db.prepare('SELECT * FROM fs_nodes WHERE tenant_id=? AND drive_id=?').get(t, id);
const subtreeOf = (id) => db.prepare('WITH RECURSIVE s(id) AS (SELECT id FROM fs_nodes WHERE id=? UNION ALL SELECT f.id FROM fs_nodes f JOIN s ON f.parent_id=s.id) SELECT id FROM s').all(id).map((r) => r.id);
const uniq = (t, clientId, parent, name, exceptId) => {
  const taken = (n) => db.prepare('SELECT 1 FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND parent_id IS ? AND deleted_at IS NULL AND lower(name)=lower(?) AND id<>?').get(t, clientId, parent, n, exceptId || 0);
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 500; i++) if (!taken(`${base} (${i})${ext}`)) return `${base} (${i})${ext}`;
  return `${base} ${Date.now()}${ext}`;
};
// Where does a Drive folder id sit in the portal? -> { client_id, parent } or null (outside the portal's tree)
async function locate(t, driveParent, keys, depth = 0) {
  if (!driveParent || driveParent === keys.root || depth > 12) return null;
  if (driveParent === keys.firm) return { client_id: null, parent: null };
  if (keys.clients.has(driveParent)) return { client_id: keys.clients.get(driveParent), parent: null };
  const n = byDrive(t, driveParent);
  if (n && n.kind === 'folder' && !n.deleted_at) return { client_id: n.client_id, parent: n.id };
  if (n) return null;
  // a folder we have not met yet (made by hand in Drive): bring it in first
  let f; try { f = await call(t, 'GET', `${API}/files/${encodeURIComponent(driveParent)}?fields=${FIELDS}`); } catch (e) { return null; }
  if (f.trashed || f.mimeType !== 'application/vnd.google-apps.folder') return null;
  await ingest(t, f, keys, depth + 1);
  const n2 = byDrive(t, driveParent);
  return n2 && !n2.deleted_at ? { client_id: n2.client_id, parent: n2.id } : (driveParent === keys.firm ? { client_id: null, parent: null } : keys.clients.has(driveParent) ? { client_id: keys.clients.get(driveParent), parent: null } : null);
}
function trashLocal(n) {
  const sub = subtreeOf(n.id);
  db.prepare(`UPDATE fs_nodes SET deleted_at=CURRENT_TIMESTAMP, deleted_by=NULL, del_root=?, drive_trashed=1, dirty=0 WHERE id IN (${sub.join(',')}) AND deleted_at IS NULL`).run(n.id);
}
async function ingest(t, f, keys, depth = 0) {
  const node = byDrive(t, f.id);
  if (f.removed || f.trashed) { if (node && !node.deleted_at) trashLocal(node); return; }
  const isDir = f.mimeType === 'application/vnd.google-apps.folder', parentDrive = (f.parents || [])[0];
  if (!keys.root) return;
  // direct children of KcLegalPortal: "Firm Files" and one folder per client (matched by name)
  if (parentDrive === keys.root) {
    if (!isDir || f.id === keys.firm || keys.clients.has(f.id)) return;
    if (f.name.toLowerCase() === 'firm files' && !keys.firm) { db.prepare('INSERT OR REPLACE INTO drive_folders(tenant_id,key,drive_id) VALUES (?,?,?)').run(t, 'firm', f.id); keys.firm = f.id; return; }
    const cl = db.prepare('SELECT id FROM clients WHERE tenant_id=? AND lower(trim(name))=lower(?)').all(t, f.name.trim().toLowerCase()).find((c) => ![...keys.clients.values()].includes(c.id));
    if (cl) { db.prepare('INSERT OR REPLACE INTO drive_folders(tenant_id,key,drive_id) VALUES (?,?,?)').run(t, 'client:' + cl.id, f.id); db.prepare('INSERT OR REPLACE INTO drive_folders(tenant_id,key,drive_id) VALUES (?,?,?)').run(t, 'cname:' + cl.id, f.name.trim()); keys.clients.set(f.id, cl.id); }
    return;
  }
  const loc = await locate(t, parentDrive, keys, depth);
  if (!loc) { if (node && !node.deleted_at) trashLocal(node); return; }
  if (node) {
    if (node.dirty) return; // the portal has a change waiting to be sent; it wins this round
    if (node.deleted_at) { // restored from Drive's bin
      if (node.del_root === node.id) {
        const sub = db.prepare('SELECT id FROM fs_nodes WHERE del_root=?').all(node.id).map((r) => r.id);
        db.prepare(`UPDATE fs_nodes SET deleted_at=NULL, deleted_by=NULL, del_root=NULL, drive_trashed=0 WHERE id IN (${sub.join(',')})`).run();
      } else return;
    }
    let { name, parent_id, client_id } = node, moved = false;
    if (f.name !== node.drive_name) { name = uniq(t, loc.client_id, loc.parent, f.name.replace(BADN, '-').slice(0, 150) || 'item', node.id); }
    if (loc.parent !== node.parent_id || loc.client_id !== node.client_id) {
      if (loc.parent && subtreeOf(node.id).includes(loc.parent)) return;
      moved = true; name = uniq(t, loc.client_id, loc.parent, name, node.id); parent_id = loc.parent;
      if (loc.client_id !== node.client_id) { const sub = subtreeOf(node.id); db.prepare(`UPDATE fs_nodes SET client_id=?, client_visible=0 WHERE id IN (${sub.join(',')})`).run(loc.client_id); client_id = loc.client_id; }
      if (loc.client_id && sharedUp(loc.parent)) { const sub = subtreeOf(node.id); db.prepare(`UPDATE fs_nodes SET client_visible=1 WHERE id IN (${sub.join(',')})`).run(); }
    }
    if (name !== node.name || moved) db.prepare('UPDATE fs_nodes SET name=?, parent_id=?, client_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, parent_id, client_id, node.id);
    db.prepare('UPDATE fs_nodes SET drive_name=?, drive_parent=?, dirty=CASE WHEN name<>? THEN 1 ELSE dirty END WHERE id=?').run(f.name, parentDrive, f.name, node.id);
    if (!isDir && f.md5Checksum && f.md5Checksum !== node.md5) { // content edited in Drive: the local copy (if any) is stale
      if (node.storage_ref) { const p = L.storage.path(t, node.storage_ref); if (p) { try { fs.unlinkSync(p); } catch (e) {} } }
      db.prepare("UPDATE fs_nodes SET md5=?, size=?, mime=?, storage='gdrive', storage_ref=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(f.md5Checksum, +f.size || 0, f.mimeType || node.mime, node.id);
    }
    return;
  }
  // new in Drive (added by hand, or by Drive for desktop)
  const name = uniq(t, loc.client_id, loc.parent, f.name.replace(BADN, '-').trim().slice(0, 150) || 'item');
  db.prepare(`INSERT INTO fs_nodes(tenant_id,client_id,parent_id,kind,name,mime,size,storage,md5,client_visible,drive_id,drive_name,drive_parent,dirty)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t, loc.client_id, loc.parent, isDir ? 'folder' : 'file', name, isDir ? null : f.mimeType || null, isDir ? 0 : +f.size || 0, 'gdrive', f.md5Checksum || null, loc.client_id && sharedUp(loc.parent) ? 1 : 0, f.id, f.name, parentDrive, name !== f.name ? 1 : 0);
}
// Whole-tree scan from KcLegalPortal (first connection, or if Drive's change feed was reset)
async function scan(t, keys) {
  const todo = [keys.root], seen = new Set();
  while (todo.length) {
    const dir = todo.shift(); if (seen.has(dir)) continue; seen.add(dir);
    let page = '';
    do {
      const j = await call(t, 'GET', `${API}/files?` + new URLSearchParams({ q: `'${q(dir)}' in parents and trashed=false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: '200', ...(page ? { pageToken: page } : {}) }).toString());
      for (const f of j.files || []) { await ingest(t, f, keys); if (f.mimeType === 'application/vnd.google-apps.folder' && (byDrive(t, f.id) || keys.clients.has(f.id) || f.id === keys.firm)) todo.push(f.id); }
      page = j.nextPageToken || '';
    } while (page);
  }
}
async function pull(t) {
  await sysFolder(t, 'root', ROOT_NAME);
  const keys = folderKeys(t); let token = AI.getS(t, 'drive_page_token'), n = 0;
  if (!token) {
    const st = await call(t, 'GET', `${API}/changes/startPageToken`);
    await scan(t, keys); AI.setS(t, 'drive_page_token', st.startPageToken); return 0;
  }
  try {
    for (let guard = 0; guard < 20; guard++) {
      const j = await call(t, 'GET', `${API}/changes?` + new URLSearchParams({ pageToken: token, pageSize: '200', includeRemoved: 'true', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))` }).toString());
      const ch = (j.changes || []).map((c) => (c.removed || !c.file ? { id: c.fileId, removed: true } : c.file));
      // folders first so a new folder exists before the things inside it
      ch.sort((a, b) => (b.mimeType === 'application/vnd.google-apps.folder') - (a.mimeType === 'application/vnd.google-apps.folder'));
      for (const f of ch) { await ingest(t, f, keys); n++; }
      if (j.nextPageToken) token = j.nextPageToken; else { AI.setS(t, 'drive_page_token', j.newStartPageToken || token); break; }
    }
  } catch (e) {
    if (/Invalid|expired|410/i.test(e.message)) AI.setS(t, 'drive_page_token', ''); else throw e;
  }
  return n;
}


// ---------- Drive is the store: live view of one folder, and direct-to-Drive saving ----------
const lastLook = new Map();
async function refreshFolder(t, clientId, parentId) {
  if (!connected(t)) return;
  const key = t + ':' + clientId + ':' + parentId, now = Date.now();
  if (now - (lastLook.get(key) || 0) < 4000) return; lastLook.set(key, now);
  const keys = folderKeys(t); if (!keys.root) return;
  let dId;
  if (parentId) { const n = db.prepare('SELECT drive_id,deleted_at FROM fs_nodes WHERE id=? AND tenant_id=?').get(parentId, t); dId = n && !n.deleted_at ? n.drive_id : null; }
  else if (!clientId) dId = keys.firm; else dId = [...keys.clients].find(([, c]) => c === clientId);  // [driveId, clientId]
  if (Array.isArray(dId)) dId = dId[0];
  if (!dId) return;
  const seen = new Set(); let page = '';
  do {
    const j = await call(t, 'GET', `${API}/files?` + new URLSearchParams({ q: `'${q(dId)}' in parents and trashed=false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: '200', ...(page ? { pageToken: page } : {}) }).toString());
    for (const f of j.files || []) { seen.add(f.id); await ingest(t, f, keys); }
    page = j.nextPageToken || '';
  } while (page);
  for (const n of db.prepare('SELECT * FROM fs_nodes WHERE tenant_id=? AND client_id IS ? AND parent_id IS ? AND drive_id IS NOT NULL AND deleted_at IS NULL AND dirty=0').all(t, clientId || null, parentId || null)) {
    if (seen.has(n.drive_id)) continue;
    try { const f = await call(t, 'GET', `${API}/files/${encodeURIComponent(n.drive_id)}?fields=${FIELDS}`); await ingest(t, f, keys); }
    catch (e) { if (/not found/i.test(e.message)) trashLocal(n); }
  }
}
// Save bytes straight into Drive (nothing is kept on the server). Throws if Drive cannot take it.
async function pushBuffer(t, nodeId, buffer) {
  const n = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(nodeId);
  let parent;
  if (n.parent_id) { const p = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(n.parent_id); if (!p.drive_id) await reconcile(t, p); parent = db.prepare('SELECT drive_id FROM fs_nodes WHERE id=?').get(n.parent_id).drive_id; }
  else parent = await scopeRoot(t, n.client_id);
  const j = await uploadFile(t, n.name, n.mime, parent, buffer);
  if (j.md5Checksum && n.md5 && j.md5Checksum !== n.md5) throw new Error('Google Drive did not store the file correctly. Please try again.');
  db.prepare("UPDATE fs_nodes SET drive_id=?, drive_name=?, drive_parent=?, storage='gdrive', storage_ref=NULL, dirty=0, sync_error=NULL WHERE id=?").run(j.id, n.name, parent, nodeId);
}

// Large file (e.g. a meeting recording) straight from disk into Drive, in 8 MB pieces (resumable upload).
async function pushFile(t, nodeId, filePath, mime) {
  const n = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(nodeId);
  let parent;
  if (n.parent_id) { const p = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(n.parent_id); if (!p.drive_id) await reconcile(t, p); parent = db.prepare('SELECT drive_id FROM fs_nodes WHERE id=?').get(n.parent_id).drive_id; }
  else parent = await scopeRoot(t, n.client_id);
  const size = fs.statSync(filePath).size, auth = { Authorization: 'Bearer ' + await accessToken(t) };
  const init = await transport('POST', UP + '/files?uploadType=resumable&fields=id,md5Checksum', { headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime || 'application/octet-stream', 'X-Upload-Content-Length': String(size) }, body: JSON.stringify({ name: n.name, parents: [parent] }) });
  const loc = init.headers && init.headers.get && init.headers.get('location');
  if (init.status >= 300 || !loc) throw new Error('Google Drive refused the upload.');
  const fd = fs.openSync(filePath, 'r'), CH = 8 * 1024 * 1024; let off = 0, last = null;
  try {
    while (off < size || size === 0) {
      const len = Math.min(CH, size - off), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, off);
      const r = await transport('PUT', loc, { headers: { ...auth, 'Content-Range': size === 0 ? 'bytes */0' : `bytes ${off}-${off + len - 1}/${size}`, 'Content-Length': String(len) }, body: buf });
      if (r.status === 308) { off += len; continue; }
      if (r.status >= 300) throw new Error('Google Drive upload failed (' + r.status + ').');
      last = await r.body.json().catch(() => ({})); off += len; break;
    }
  } finally { fs.closeSync(fd); }
  if (!last || !last.id) throw new Error('Google Drive did not confirm the upload.');
  db.prepare("UPDATE fs_nodes SET drive_id=?, drive_name=?, drive_parent=?, storage='gdrive', storage_ref=NULL, dirty=0, sync_error=NULL, size=? WHERE id=?").run(last.id, n.name, parent, size, nodeId);
  return last.id;
}

let layoutHook = null;
let running = new Set();
async function syncTenant(t, limit = 40) {
  if (!connected(t) || running.has(t)) return { done: 0, failed: 0 };
  running.add(t);
  let ok = 0, bad = 0;
  try {
    if (layoutHook) layoutHook(t);
    for (const tomb of db.prepare('SELECT * FROM drive_tombstones WHERE tenant_id=? LIMIT 50').all(t)) {
      try { await patch(t, tomb.drive_id, { trashed: true }); } catch (e) { if (!/not found/i.test(e.message)) { bad++; continue; } }
      db.prepare('DELETE FROM drive_tombstones WHERE id=?').run(tomb.id); ok++;
    }
    const rows = db.prepare(`SELECT * FROM fs_nodes WHERE tenant_id=? AND dirty=1 AND sync_tries<5 ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END, id LIMIT ?`).all(t, limit);
    for (const n of rows) {
      try { await reconcile(t, db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(n.id)); ok++; }
      catch (e) { bad++; db.prepare('UPDATE fs_nodes SET sync_error=?, sync_tries=sync_tries+1 WHERE id=?').run(String(e.message).slice(0, 300), n.id); }
    }
    try { await syncClientNames(t); ok += await pull(t); AI.setS(t, 'drive_pull_error', ''); } catch (e) { bad++; AI.setS(t, 'drive_pull_error', String(e.message).slice(0, 200)); console.error('drive pull:', e.message); }
  } catch (e) { bad++; console.error('drive sync:', e.message); }
  finally { running.delete(t); }
  return { done: ok, failed: bad };
}
function pending(t) {
  return { waiting: db.prepare('SELECT COUNT(*) c FROM fs_nodes WHERE tenant_id=? AND dirty=1 AND sync_tries<5').get(t).c,
    failed: db.prepare('SELECT COUNT(*) c FROM fs_nodes WHERE tenant_id=? AND dirty=1 AND sync_tries>=5').get(t).c,
    pull_error: AI.getS(t, 'drive_pull_error') || null,
    last_error: (db.prepare("SELECT sync_error e FROM fs_nodes WHERE tenant_id=? AND sync_error IS NOT NULL ORDER BY id DESC LIMIT 1").get(t) || {}).e || null };
}
let timer = null;
function startWorker() {
  if (timer) return;
  timer = setInterval(async () => {
    for (const f of db.prepare("SELECT id FROM tenants WHERE kind='firm' AND active=1").all()) { try { await syncTenant(f.id); } catch (e) {} }
  }, 20000);
  timer.unref();
}

// ---------- settings + OAuth routes ----------
module.exports = (app) => {
  // Lay out the standard folders for the firm and every client, so the Drive tree exists before anyone opens a client.
  const layout = (t) => { const h = app.locals.fsHelpers; if (!h) return; h.seed(t, null, null); for (const c of db.prepare('SELECT id FROM clients WHERE tenant_id=?').all(t)) h.seed(t, c.id, null); };
  layoutHook = layout;
  const T = (req) => req.user.tenant_id, admin = L.need('admin');
  const origin = (req) => process.env.PUBLIC_URL || `https://${req.headers.host}`;
  const redirect = (req) => origin(req) + '/api/storage/callback';
  const status = (req) => { const t = T(req), c = cfg(t); return { configured: configured(t), connected: connected(t), email: c.email, keep_local: c.keep_local,
    client_id: c.client_id, has_secret: !!c.client_secret, redirect_uri: redirect(req), meet_ready: canMeet(t), contacts_ready: canContacts(t), ...pending(t) }; };

  app.get('/api/storage', admin, (req, res) => res.json(status(req)));
  app.put('/api/storage', admin, (req, res) => {
    const t = T(req), id = L.str(req.body.client_id, 200), sec = L.str(req.body.client_secret, 200);
    if (id) AI.setS(t, 'drive_client_id', id);
    if (sec) AI.setS(t, 'drive_client_secret', AI.enc(sec));
    if (req.body.keep_local !== undefined) AI.setS(t, 'drive_keep_local', req.body.keep_local ? '1' : '0');
    res.json(status(req));
  });
  // Browser navigation: send the admin to Google's consent page. 'state' ties the callback back to this firm.
  app.get('/api/storage/connect', admin, (req, res) => {
    const t = T(req);
    if (!configured(t)) return res.status(400).send('Save the Client ID and Client secret first.');
    const state = L.rand(16);
    AI.setS(t, 'drive_state', state + ':' + Date.now());
    res.redirect(AUTH + '?' + new URLSearchParams({ client_id: cfg(t).client_id, redirect_uri: redirect(req), response_type: 'code', scope: SCOPE,
      access_type: 'offline', prompt: 'consent', state: t + '.' + state }).toString());
  });
  app.get('/api/storage/callback', async (req, res) => {
    const back = (m) => res.redirect('/#/storage?' + m);
    try {
      const [tid, st] = String(req.query.state || '').split('.');
      const t = parseInt(tid, 10), saved = (S(t, 'drive_state') || '').split(':');
      if (!t || !st || saved[0] !== st || Date.now() - Number(saved[1]) > 15 * 60000) return back('err=' + encodeURIComponent('Connection link expired. Try again.'));
      AI.setS(t, 'drive_state', '');
      if (req.query.error) return back('err=' + encodeURIComponent('Google said: ' + req.query.error));
      const c = cfg(t);
      const r = await transport('POST', TOKEN, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code), client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect(req), grant_type: 'authorization_code' }).toString() });
      const j = await r.body.json().catch(() => ({}));
      if (!j.refresh_token) return back('err=' + encodeURIComponent('Google did not return a permanent key' + (j.error ? ' (' + j.error + ')' : '') + '. Remove the app from your Google account permissions and connect again.'));
      AI.setS(t, 'drive_refresh', AI.enc(j.refresh_token)); AI.setS(t, 'drive_scopes', String(j.scope || ''));
      tokens.set(t, { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
      try { const u = await call(t, 'GET', 'https://www.googleapis.com/oauth2/v2/userinfo'); AI.setS(t, 'drive_email', u.email || ''); } catch (e) {}
      AI.setS(t, 'drive_page_token', ''); layout(t);
      db.prepare('UPDATE fs_nodes SET dirty=1, sync_tries=0 WHERE tenant_id=? AND drive_id IS NULL').run(t);
      syncTenant(t).catch(() => {});
      back('ok=1');
    } catch (e) { console.error(e); back('err=' + encodeURIComponent('Could not finish connecting.')); }
  });
  app.post('/api/storage/sync', admin, async (req, res) => {
    const t = T(req);
    if (!connected(t)) return res.status(400).json({ error: 'Google Drive is not connected.' });
    layout(t); db.prepare('UPDATE fs_nodes SET sync_tries=0 WHERE tenant_id=? AND dirty=1').run(t);
    res.json({ ...(await syncTenant(t, 200)), ...pending(t) });
  });
  app.post('/api/storage/disconnect', admin, (req, res) => {
    const t = T(req); AI.setS(t, 'drive_refresh', ''); AI.setS(t, 'drive_email', ''); tokens.delete(t);
    res.json(status(req));
  });
};
Object.assign(module.exports, { canContacts, ensureDriveFolder: async (t, nodeId) => { const n = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(nodeId); if (!n.drive_id) await reconcile(t, n); return db.prepare('SELECT drive_id FROM fs_nodes WHERE id=?').get(nodeId).drive_id; }, pushFile, call, canMeet, accessToken, clearLook: () => lastLook.clear(), refreshFolder, pushBuffer, nativeExt, isNative, setTransport, connected, configured, syncTenant, download, startWorker, pending, cfg });
