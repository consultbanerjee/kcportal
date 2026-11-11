'use strict';
// v5.0.5: delete a case, restore, delete forever
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc5-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const C = require('../routes/control'); const SH = require('../routes/shield');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx, h: r.headers }; }; }
const signup = async (c, email, pw) => { const row = db.prepare("SELECT invite_token t FROM users WHERE email=?").get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };

(async () => {
  const ad = client(), st = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Stf', email: 'stf@example.com', role: 'staff' }); await signup(st, 'stf@example.com', 'StrongPass123');
  let r = await ad('POST', '/api/clients', { name: 'Del Client' }); const cid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Delete Me' }); const mid = r.j.id, fno = r.j.file_no;
  await ad('POST', `/api/matters/${mid}/hearings`, { hearing_date: '2031-01-01', next_date: '2031-02-02' });
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Keep Me' }); const keep = r.j.id;
  ok((await st('DELETE', '/api/matters/' + mid, { confirm: fno })).s === 403, 'staff cannot delete');
  ok((await ad('DELETE', '/api/matters/' + mid, { confirm: 'wrong' })).s === 400, 'needs file number');
  ok((await ad('DELETE', '/api/matters/' + mid, { confirm: fno })).s === 200, 'admin deletes');
  ok((await ad('GET', '/api/matters/' + mid)).s === 404, 'deleted case hidden');
  ok((await ad('GET', '/api/matters')).j.every((m) => m.id !== mid) && (await ad('GET', '/api/matters')).j.length === 1, 'gone from list');
  ok((await ad('GET', '/api/clients/' + cid)).j.matters.length === 1, 'gone from client page');
  ok((await ad('GET', '/api/matters-deleted')).j.length === 1 && (await st('GET', '/api/matters-deleted')).s === 403, 'admin sees deleted list only');
  ok((await ad('POST', `/api/matters/${mid}/restore`)).s === 200 && (await ad('GET', '/api/matters/' + mid)).s === 200, 'restore brings it back with data');
  ok((await ad('GET', '/api/matters/' + mid)).j.hearings.length === 1, 'hearing kept');
  ok((await ad('DELETE', `/api/matters/${mid}/purge`, { confirm: fno })).s === 403, 'firm admin cannot purge at all');
  await ad('DELETE', '/api/matters/' + mid, { confirm: fno });
  ok((await ad('DELETE', `/api/matters/${mid}/purge`, { confirm: fno })).s === 403 && db.prepare('SELECT 1 FROM matters WHERE id=?').get(mid), 'firm admin cannot delete for good; case stays in the Recycle Bin');
  const sa = client(); await signup(sa, 'consultbanerjee@gmail.com', 'StrongPass123');
  ok((await sa('GET', '/api/platform/f/1/matters-deleted')).j.length >= 1, 'Super Admin sees the firm Recycle Bin');
  ok((await sa('DELETE', `/api/platform/f/1/matters/${mid}/purge`, { confirm: fno })).s === 200, 'Super Admin deletes it for good');
  ok(!db.prepare('SELECT 1 FROM matters WHERE id=?').get(mid) && !db.prepare('SELECT 1 FROM hearings WHERE matter_id=?').get(mid), 'case and hearings gone');
  ok((await ad('GET', '/api/matters/' + keep)).s === 200, 'other case untouched');
  db.prepare("INSERT INTO invoices(tenant_id,client_id,matter_id,inv_no,inv_date,status,total_paise) VALUES (1,?,?,'X/1','2026-01-01','sent',1000)").run(cid, keep);
  r = await ad('DELETE', '/api/matters/' + keep, { confirm: (await ad('GET', '/api/matters/' + keep)).j.file_no }); ok(r.s === 409, 'case with issued bill cannot be deleted');
  console.log(`delete tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
