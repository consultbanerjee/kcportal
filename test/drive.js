'use strict';
// Two-way Google Drive sync, tested against an in-memory fake of the Drive API (no network).
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcd-'));
const app = require('../server');
const { db } = require('../db');
const AI = require('../aicore');
const Drive = require('../routes/drive');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

// ---- fake Drive ----
const F = new Map(), LOG = []; let seq = 0;
const FOLDER = 'application/vnd.google-apps.folder';
const mk = (name, parents, mime, content) => { const id = 'd' + (++seq); const f = { id, name, mimeType: mime || 'application/octet-stream', parents: parents || ['root'], trashed: false };
  if (content) { f.content = content; f.md5Checksum = md5(content); f.size = String(content.length); } F.set(id, f); LOG.push(id); return f; };
const meta = (f) => { const { content, ...m } = f; return m; };
const kids = (id) => [...F.values()].filter((f) => (f.parents || []).includes(id));
const find = (parent, name) => kids(parent).find((f) => f.name === name && !f.trashed);
const rsp = (status, j) => ({ status, headers: new Map(), body: { json: async () => j, arrayBuffer: async () => (Buffer.isBuffer(j) ? j : Buffer.from(JSON.stringify(j))) } });
Drive.setTransport(async (method, url, { body } = {}) => {
  const u = new URL(url), p = u.pathname, Q = u.searchParams;
  if (u.host === 'oauth2.googleapis.com') return rsp(200, { access_token: 'at', expires_in: 3600 });
  if (p === '/drive/v3/changes/startPageToken') return rsp(200, { startPageToken: String(LOG.length) });
  if (p === '/drive/v3/changes') { const from = +Q.get('pageToken'); const ids = [...new Set(LOG.slice(from))];
    return rsp(200, { newStartPageToken: String(LOG.length), changes: ids.map((id) => ({ fileId: id, file: meta(F.get(id)) })) }); }
  if (p === '/upload/drive/v3/files') { const s = body.toString('latin1'), b = s.split('\r\n')[0], parts = s.split(b);
    const m = JSON.parse(parts[1].split('\r\n\r\n')[1].trim()), raw = body.slice(body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), body.indexOf(Buffer.from(b + '\r\nContent-Type', 'latin1'), 10)) + 4);
    const start = body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), body.indexOf('\r\n\r\n') + 4) + 4, content = body.slice(start, body.length - (b.length + 4));
    const f = mk(m.name, m.parents, null, content); return rsp(200, { id: f.id, md5Checksum: f.md5Checksum }); }
  const m = p.match(/^\/drive\/v3\/files\/?([^/]*)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET' && !id) { const q = Q.get('q'), par = q.match(/'([^']+)' in parents/)[1], nm = q.match(/name='((?:[^'\\]|\\.)*)'/), fo = /mimeType='/.test(q);
      return rsp(200, { files: kids(par).filter((f) => !f.trashed && (!nm || f.name === nm[1].replace(/\\'/g, "'")) && (!fo || f.mimeType === FOLDER)).map(meta) }); }
    if (method === 'POST') { const j = JSON.parse(body), f = mk(j.name, j.parents, j.mimeType); return rsp(200, { id: f.id }); }
    const f = F.get(id); if (!f) return rsp(404, { error: { message: 'not found' } });
    if (method === 'GET') return Q.get('alt') === 'media' ? rsp(200, f.content) : rsp(200, meta(f));
    if (method === 'PATCH') { const j = JSON.parse(body); Object.assign(f, j); if (Q.get('addParents')) f.parents = f.parents.filter((x) => x !== Q.get('removeParents')).concat(Q.get('addParents')); LOG.push(id); return rsp(200, { id }); }
  }
  return rsp(404, { error: { message: 'unhandled ' + method + ' ' + url } });
});

const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body;
  if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }

(async () => {
  const admin = client();
  const tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' });
  let r = await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' }); ok(r.s === 200, 'login');
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  AI.setS(t, 'drive_client_id', 'cid'); AI.setS(t, 'drive_client_secret', AI.enc('sec')); AI.setS(t, 'drive_refresh', AI.enc('rt'));
  r = await admin('POST', '/api/clients', { name: 'Ramesh Kumar', phone: '9830000001' }); ok(r.s === 200, 'client'); const cid = r.j.id;
  const sync = () => Drive.syncTenant(t, 500);
  const list = async (parent) => (await admin('GET', `/api/fs/list?client_id=${cid}${parent ? '&parent=' + parent : ''}`)).j;
  const named = (arr, n) => arr.find((x) => x.name === n);

  // 1. layout
  let L0 = await list(); ok(['Uploaded', 'Drafts', 'Judgements', 'Final'].every((n) => named(L0.items, n)), 'portal has the four category folders');
  let res = await sync(); ok(res.failed === 0, 'first sync clean ' + JSON.stringify(res));
  const root = find('root', 'KcLegalPortal'); ok(!!root, 'KcLegalPortal created in Drive');
  const cf = root && find(root.id, 'Ramesh Kumar'); ok(!!cf, 'client folder named after the client');
  ok(cf && ['Uploaded', 'Drafts', 'Judgements', 'Final'].every((n) => find(cf.id, n)), 'four sub-folders in Drive');
  ok(root && find(root.id, 'Firm Files'), 'Firm Files folder in Drive');
  const up = named(L0.items, 'Uploaded').id, upD = find(cf.id, 'Uploaded');

  // 2. portal upload -> Drive
  const fd = new FormData(); fd.append('client_id', cid); fd.append('parent', up); fd.append('files', new Blob(['hello plaint']), 'plaint.pdf');
  r = await admin('POST', '/api/fs/upload', fd); ok(r.s === 200, 'upload'); const fid = r.j.added[0].id;
  await sync(); const dp = find(upD.id, 'plaint.pdf'); ok(dp && dp.md5Checksum === md5(Buffer.from('hello plaint')), 'file reached Drive with matching md5');
  ok(db.prepare('SELECT storage FROM fs_nodes WHERE id=?').get(fid).storage === 'gdrive', 'local copy dropped after Drive confirmed');
  // portal rename -> Drive
  await admin('PATCH', '/api/fs/' + fid, { client_id: cid, name: 'plaint-v2.pdf' }); await sync(); ok(F.get(dp.id).name === 'plaint-v2.pdf', 'portal rename reaches Drive');

  // nothing kept on the server once Drive is connected: upload is saved straight into Drive
  const fd2 = new FormData(); fd2.append('client_id', cid); fd2.append('parent', up); fd2.append('files', new Blob(['direct bytes']), 'direct.pdf');
  r = await admin('POST', '/api/fs/upload', fd2); ok(r.s === 200, 'direct upload'); const did = r.j.added[0].id; const drow = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(did);
  ok(drow.storage === 'gdrive' && !drow.storage_ref && drow.drive_id && drow.dirty === 0 && F.get(drow.drive_id).content.toString() === 'direct bytes', 'upload goes straight to Drive, no local copy');
  // live view: a file dropped into Drive shows the moment the folder is opened (no waiting for the poll)
  mk('instant.pdf', [upD.id], 'application/pdf', Buffer.from('i')); Drive.clearLook(); ok(named((await list(up)).items, 'instant.pdf'), 'folder opens with the live Drive contents');
  const gone = F.get(drow.drive_id); gone.trashed = true; Drive.clearLook(); ok(!named((await list(up)).items, 'direct.pdf'), 'item deleted in Drive disappears when folder is opened'); gone.trashed = false; LOG.push(gone.id); await sync();
  // 3. Drive -> portal: rename
  F.get(dp.id).name = 'Plaint FINAL.pdf'; LOG.push(dp.id); await sync();
  ok(named((await list(up)).items, 'Plaint FINAL.pdf'), 'rename in Drive shows in portal');
  // new file added by hand in Judgements
  const jd = find(cf.id, 'Judgements'); const hand = mk('order 12.10.2026.pdf', [jd.id], 'application/pdf', Buffer.from('ORDER'));
  await sync(); const jp = named(L0.items, 'Judgements').id; const jl = (await list(jp)).items; ok(named(jl, 'order 12.10.2026.pdf'), 'file added in Drive appears in portal');
  const hn = named(jl, 'order 12.10.2026.pdf');
  // download goes through Drive
  const dl = await fetch(base + `/api/fs/${hn.id}/download`, { headers: { cookie: (await (async () => { const rr = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kcportal' }, body: JSON.stringify({ email: 'kclegal.in@gmail.com', password: 'StrongPass123' }) }); return rr.headers.get('set-cookie').split(';')[0]; })()) } });
  ok(dl.status === 200 && (await dl.text()) === 'ORDER', 'portal downloads a Drive-only file');
  // new folder + file inside, file logged before folder is irrelevant
  const nf = mk('Annexures', [cf.id], FOLDER); mk('A-1.pdf', [nf.id], 'application/pdf', Buffer.from('A1')); await sync();
  const top = (await list()).items, an = named(top, 'Annexures'); ok(an && an.kind === 'folder', 'new Drive folder appears under the client');
  ok(an && named((await list(an.id)).items, 'A-1.pdf'), 'file inside new Drive folder appears');
  // move in Drive: Judgements -> Final
  const fin = find(cf.id, 'Final'); F.get(hand.id).parents = [fin.id]; LOG.push(hand.id); await sync();
  const finId = named(top, 'Final').id; ok(named((await list(finId)).items, 'order 12.10.2026.pdf') && !named((await list(jp)).items, 'order 12.10.2026.pdf'), 'move in Drive reflected');
  // edit content in Drive
  const f2 = F.get(hand.id); f2.content = Buffer.from('ORDER-CORRECTED'); f2.md5Checksum = md5(f2.content); f2.size = '15'; LOG.push(hand.id); await sync();
  const nn = db.prepare('SELECT md5,size FROM fs_nodes WHERE drive_id=?').get(hand.id); ok(nn.md5 === f2.md5Checksum && nn.size === 15, 'content edit in Drive noticed');
  // delete in Drive -> bin
  F.get(hand.id).trashed = true; LOG.push(hand.id); await sync();
  r = await admin('GET', `/api/fs/bin?client_id=${cid}`); ok(r.j.items.some((x) => x.name === 'order 12.10.2026.pdf'), 'Drive delete lands in the portal recycle bin');
  const bid = r.j.items.find((x) => x.name === 'order 12.10.2026.pdf').id;
  r = await admin('POST', '/api/fs/restore', { client_id: cid, ids: [bid] }); await sync(); ok(F.get(hand.id).trashed === false, 'portal restore un-trashes in Drive');
  // delete in portal -> Drive trash
  await admin('POST', '/api/fs/trash', { client_id: cid, ids: [fid] }); await sync(); ok(F.get(dp.id).trashed === true, 'portal delete trashes in Drive');
  // client rename -> Drive folder rename
  await admin('PUT', '/api/clients/' + cid, { name: 'Ramesh Kumar Sharma' }); await sync(); ok(F.get(cf.id).name === 'Ramesh Kumar Sharma', 'client rename renames Drive folder');
  // echo: another sync changes nothing and does not fail
  res = await sync(); ok(res.failed === 0, 'quiet sync');
  // Google Doc made by hand downloads as .docx
  const gd = mk('Notes', [jd.id], 'application/vnd.google-apps.document'); await sync();
  ok(Drive.nativeExt('application/vnd.google-apps.document') === '.docx' && named((await list(jp)).items, 'Notes'), 'Google Doc listed');
  // ---- v2.3: Reference folders (KcLegalPortal / Reference / Client) ----
  await admin('PUT', '/api/clients/' + cid, { reference: 'Dr. Sen' }); await sync();
  const refF = find(root.id, 'Dr. Sen'); ok(!!refF, 'Reference folder created under KcLegalPortal');
  ok(F.get(cf.id).parents.includes(refF.id) && !F.get(cf.id).parents.includes(root.id), 'existing client folder moved into its Reference folder');
  ok(find(cf.id, 'Uploaded'), 'client sub-folders travel with the client folder');
  r = await admin('POST', '/api/clients', { name: 'Anita Roy', reference: 'Dr. Sen' }); const cid2 = r.j.id; await admin('GET', `/api/fs/list?client_id=${cid2}`); await sync();
  const cf2 = find(refF.id, 'Anita Roy'); ok(!!cf2, 'new client with a Reference is created directly inside that Reference folder');
  await admin('PUT', '/api/clients/' + cid2, { reference: 'Mr. Bose' }); await sync();
  const refB = find(root.id, 'Mr. Bose'); ok(refB && F.get(cf2.id).parents.includes(refB.id), 'moving a client to another Reference moves its folder at once');
  await admin('PUT', '/api/clients/' + cid2, { reference: '' }); await sync(); ok(F.get(cf2.id).parents.includes(root.id), 'clearing the Reference returns the folder to KcLegalPortal');
  F.get(cf2.id).parents = [refF.id]; LOG.push(cf2.id); await sync();
  ok(db.prepare('SELECT reference r FROM clients WHERE id=?').get(cid2).r === 'Dr. Sen', 'dragging a client folder between Reference folders in Drive updates the client Reference');
  r = await admin('GET', '/api/references'); ok(r.j.some((x) => x.name === 'Dr. Sen' && x.clients === 2), 'reference list with counts');
  // immediate push after a document change (debounced kick)
  const before = LOG.length; await admin('PUT', '/api/clients/' + cid, { reference: 'Mr. Bose' }); await new Promise((z) => setTimeout(z, 2600));
  ok(F.get(cf.id).parents.includes(refB.id), 'a change made in the portal reaches Drive by itself within seconds (no manual sync)');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
