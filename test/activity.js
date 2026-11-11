'use strict';
// v5.0.5: activity log for the firm and the Super Admin
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc5-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const C = require('../routes/control'); const SH = require('../routes/shield');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx, h: r.headers }; }; }
const signup = async (c, email, pw) => { const row = db.prepare("SELECT invite_token t FROM users WHERE email=?").get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };

(async () => {
  const sa = client(), ad = client(), st = client();
  await signup(sa, 'consultbanerjee@gmail.com', 'StrongPass123'); await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Stf', email: 'stf@example.com', role: 'staff' }); await signup(st, 'stf@example.com', 'StrongPass123');
  let r = await st('POST', '/api/clients', { name: 'Log Client' }); const cid = r.j.id;
  r = await st('POST', '/api/matters', { client_id: cid, title: 'Log Matter' }); const mid = r.j.id;
  await st('POST', `/api/matters/${mid}/notings`, { note: 'a noting' }); await st('POST', `/api/matters/${mid}/diary`, { date: '2026-11-01', kind: 'note', note: 'x' }); await st('PUT', '/api/matters/' + mid, { title: 'Log Matter 2' });
  await st('GET', '/api/matters'); await st('POST', '/api/logout');
  r = await ad('GET', '/api/activity'); ok(r.s === 200 && r.j.rows.length > 5, 'firm admin sees the log');
  const mine = r.j.rows.filter((x) => x.user === 'Stf'); ok(mine.some((x) => x.what === 'Signed in') && mine.some((x) => x.what === 'Signed out'), 'sign-in and sign-out recorded with the user');
  ok(mine.some((x) => /noting/i.test(x.what)) && mine.some((x) => /diary/i.test(x.what)) && mine.some((x) => /case/i.test(x.what)), 'entries and changes recorded');
  ok(!mine.some((x) => /GET/.test(x.detail)), 'plain looking-at pages are not logged as changes');
  ok(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}$/.test(r.j.rows[0].at), 'date and time to the second, Indian time');
  ok(r.j.summary.some((x) => x.user === 'Stf' && x.signins >= 1 && x.actions >= 3), 'who was in, how many actions');
  r = await ad('GET', '/api/activity?kind=signin'); ok(r.j.rows.every((x) => /Signed|Wrong|refused/.test(x.what)), 'filter: sign-ins only');
  r = await ad('GET', '/api/activity?q=noting'); ok(r.j.rows.length >= 1 && r.j.rows.every((x) => /noting/i.test(x.what + x.detail + x.user)), 'search');
  r = await ad('GET', '/api/activity?from=2999-01-01'); ok(r.j.rows.length === 0, 'date filter');
  ok((await st('GET', '/api/activity')).s === 401 || (await st('GET', '/api/activity')).s === 403, 'staff cannot open the firm log');
  r = await sa('GET', '/api/platform/activity'); ok(r.s === 200 && r.j.rows.some((x) => x.user === 'Stf') && r.j.firms.length >= 1, 'Super Admin sees firm activity');
  const kc = r.j.firms[0].id; r = await sa('GET', '/api/platform/activity?firm=' + kc); ok(r.j.rows.length > 5 && r.j.rows.every((x) => x.firm === r.j.firms[0].name), 'Super Admin can pick one firm');
  ok((await ad('GET', '/api/platform/activity')).s === 403, 'firm cannot see the platform log');
  r = await sa('POST', '/api/export/pdf', { title: 'Activity log', cols: [{ h: 'When', w: 1 }, { h: 'What', w: 2 }], rows: [['12 Nov 2026', 'Signed in']], restricted: 'activity' }, true); ok(r.status === 200 && /pdf/.test(r.headers.get('content-type') || ''), 'Super Admin can download as PDF');
  r = await ad('POST', '/api/export/docx', { title: 'Activity log', cols: [{ h: 'When', w: 1 }], rows: [['x']], restricted: 'activity' }, true); ok(r.status === 200, 'firm admin can download as Word');
  console.log(`activity tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
