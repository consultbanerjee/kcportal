'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcg-')); process.env.PUBLIC_URL = 'https://portal.kclegal.us';
const app = require('../server'); const { db } = require('../db');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
(async () => {
  const admin = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  let r = await admin('POST', '/api/clients', { name: 'Sita Devi', reference: ' Dr.  Sen/Kolkata ' }); const cid = r.j.id;
  r = await admin('GET', '/api/clients/' + cid); ok(r.j.reference === 'Dr. Sen-Kolkata', 'reference saved, tidied and made folder-safe: ' + r.j.reference);
  r = await admin('GET', '/api/clients?q=Sen'); ok(r.j.length === 1, 'clients searchable by reference');
  await admin('PUT', '/api/clients/' + cid, { phone: '9830012345' }); r = await admin('GET', '/api/clients/' + cid); ok(r.j.reference === 'Dr. Sen-Kolkata', 'saving other fields keeps the reference');
  // register
  r = await admin('POST', '/api/register', { kind: 'in' }); ok(r.s === 200 && /^KC\/IN\/\d{4}\/0001$/.test(r.j.no), 'empty entry is allowed; only the number is compulsory: ' + (r.j && r.j.no));
  r = await admin('POST', '/api/register', { kind: 'in', client_id: cid, entry_date: '2024-03-05', party: 'HDFC Bank', subject: 'Notice' }); ok(r.j.no === 'KC/IN/2024/0001', 'back-dated entry takes its own year: ' + r.j.no);
  const rid = r.j.id;
  r = await admin('POST', '/api/register', { kind: 'out', client_id: cid, entry_date: '2026-11-01', subject: 'Reply', mode: 'Speed Post', tracking: 'EE123', reply_to: 'KC/IN/2024/0001' }); ok(/^KC\/OUT\/2026\/0001$/.test(r.j.no), 'outward numbered separately: ' + r.j.no);
  r = await admin('POST', '/api/register', { kind: 'out', no: 'MANUAL-7' }); ok(r.s === 200 && r.j.no === 'MANUAL-7', 'own number accepted');
  r = await admin('POST', '/api/register', { kind: 'out', no: 'MANUAL-7' }); ok(r.s === 409, 'duplicate number refused');
  r = await admin('POST', '/api/register', { kind: 'in', no: 'MANUAL-7' }); ok(r.s === 200, 'same number allowed in the other book');
  r = await admin('GET', '/api/register?client_id=' + cid); ok(r.j.length === 2 && r.j.every((x) => x.client_name === 'Sita Devi'), 'filtered by client');
  r = await admin('GET', '/api/register?kind=in&from=2024-01-01&to=2024-12-31'); ok(r.j.length === 1 && r.j[0].party === 'HDFC Bank', 'filtered by kind and dates');
  r = await admin('GET', '/api/register?q=EE123'); ok(r.j.length === 1, 'search by tracking number');
  r = await admin('PATCH', '/api/register/' + rid, { remarks: 'Replied', action: 'Reply' }); ok(r.s === 200, 'edited');
  r = await admin('PATCH', '/api/register/' + rid, { no: '' }); ok(r.s === 400, 'number cannot be blanked');
  r = await admin('PATCH', '/api/register/' + rid, { no: 'MANUAL-7' }); ok(r.s === 409, 'cannot rename onto an existing number');
  // restructure numbering
  r = await admin('PUT', '/api/register/format', { kind: 'in', fmt: '{P}/I/{YY}-{N:3}', next: 50 }); ok(r.s === 200 && /KC\/I\/\d\d-050/.test(r.j.example), 'numbering restructured: ' + (r.j && r.j.example));
  r = await admin('POST', '/api/register', { kind: 'in', entry_date: '2026-05-05' }); ok(r.j.no === 'KC/I/26-050', 'new pattern and counter used: ' + r.j.no);
  r = await admin('PUT', '/api/register/format', { kind: 'in', fmt: 'no-number' }); ok(r.s === 400, 'pattern must contain {N}');
  r = await admin('GET', '/api/register/format'); ok(r.j.in.next === 51 && r.j.out.fmt.includes('OUT'), 'format endpoint');
  // other client-page data
  r = await admin('POST', '/api/matters', { client_id: cid, title: 'Sita v State' }); const mid = r.j.id;
  await admin('POST', '/api/tasks', { title: 'File reply', matter_id: mid, assigned_to: db.prepare("SELECT id FROM users WHERE role='admin'").get().id });
  r = await admin('GET', '/api/tasks?view=all&client_id=' + cid); ok(r.j.length === 1, 'tasks of a client');
  await admin('POST', '/api/letters', { to_name: 'X', subject: 'S', body: 'B', client_id: cid }); r = await admin('GET', '/api/letters?client_id=' + cid); ok(r.j.length === 1, 'letters of a client');
  r = await admin('DELETE', '/api/register/' + rid); ok(r.s === 200, 'deleted');
  // old inward book moved into the register
  db.prepare("INSERT INTO dak(tenant_id,ref_no,received_on,from_name,subject) VALUES (1,'KC/IN/0009/2026','2026-01-02','Court','Order')").run();
  ok(true, 'dak table kept');
  const noAcc = client(); r = await noAcc('GET', '/api/register'); ok(r.s === 401 || r.s === 403, 'login needed');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
