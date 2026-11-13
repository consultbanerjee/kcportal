'use strict';
// v5.2: case labels, saved research, usage summary
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc52-'));
const app = require('../server'); const { db } = require('../db');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = JSON.parse(await r.text()); } catch (e) {} return { s: r.status, j }; }; }
const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
(async () => {
  const ad = client(), st = client(), anon = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv', email: 'stf@example.com', role: 'advocate' }); await signup(st, 'stf@example.com', 'StrongPass123');
  let r = await ad('POST', '/api/clients', { name: 'Test Client', phone: '9000000000' }); const cid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Label test case' }); const mid = r.j.id; ok(mid, 'case created');
  r = await ad('PUT', `/api/matters/${mid}/labels`, { labels: ['ROC', 'roc', 'Private', '<b>x</b>'] }); ok(r.s === 200 && r.j.labels.length === 3 && !r.j.labels.join().includes('<'), 'labels cleaned and de-duplicated');
  r = await ad('GET', '/api/labels'); ok(r.j.some((x) => x.label === 'ROC' && x.count === 1), 'label counts');
  r = await ad('GET', '/api/matters'); ok(/ROC/.test(r.j[0].labels), 'labels in case list');
  r = await ad('GET', '/api/matters/' + mid); ok(/Private/.test(r.j.labels), 'labels on case');
  ok((await anon('PUT', `/api/matters/${mid}/labels`, { labels: ['x'] })).s === 401, 'labels need sign-in');
  r = await ad('PUT', '/api/matters/99999/labels', { labels: ['x'] }); ok(r.s === 404, 'unknown case');
  await ad('PUT', '/api/team/settings', { advocate: ['research'] });
  // saved research
  r = await st('POST', '/api/research/saved', { title: 'AIR 1950 SC 27', body: 'A K Gopalan', kind: 'Judgment', url: 'javascript:alert(1)' }); ok(r.s === 200, 'save bookmark');
  const id = r.j.id; r = await st('GET', '/api/research/saved'); ok(r.j.length === 1 && r.j[0].url === '', 'unsafe link dropped');
  r = await ad('GET', '/api/research/saved'); ok(r.j.length === 0, 'bookmarks are private to the user');
  ok((await ad('PUT', '/api/research/saved/' + id, { note: 'x' })).s === 404 && (await ad('DELETE', '/api/research/saved/' + id)).s === 404, "another user cannot touch it");
  ok((await st('PUT', '/api/research/saved/' + id, { note: 'good case' })).s === 200 && (await st('GET', '/api/research/saved')).j[0].note === 'good case', 'note saved');
  ok((await st('DELETE', '/api/research/saved/' + id)).s === 200 && (await st('GET', '/api/research/saved')).j.length === 0, 'bookmark removed');
  ok((await st('POST', '/api/research/saved', { title: '' })).s === 400, 'empty refused');
  // usage
  r = await ad('GET', '/api/usage'); ok(r.s === 200 && r.j.cases === 1 && r.j.clients >= 1, 'usage summary for admin');
  ok((await st('GET', '/api/usage')).s === 403 && (await anon('GET', '/api/usage')).s === 401, 'usage is admin only');
  console.log(`v52: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
