'use strict';
// v5.0.4: case team - assign a case to advocates with view / work / full rights
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc5-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const C = require('../routes/control'); const SH = require('../routes/shield');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx, h: r.headers }; }; }
const signup = async (c, email, pw) => { const row = db.prepare("SELECT invite_token t FROM users WHERE email=?").get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
(async () => {
  const ad = client(), a1 = client(), a2 = client(), anon = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  let r = await ad('POST', '/api/users', { name: 'Adv One', email: 'a1@example.com', role: 'advocate' }); await signup(a1, 'a1@example.com', 'StrongPass123');
  r = await ad('POST', '/api/users', { name: 'Adv Two', email: 'a2@example.com', role: 'advocate' }); await signup(a2, 'a2@example.com', 'StrongPass123');
  const u1 = db.prepare("SELECT id FROM users WHERE email='a1@example.com'").get().id, u2 = db.prepare("SELECT id FROM users WHERE email='a2@example.com'").get().id;
  r = await ad('POST', '/api/clients', { name: 'Team Client', phone: '9876543210' }); const cid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Team Matter' }); const mid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Other Matter' }); const mid2 = r.j.id;
  // advocates are strict by default: only their own (allotted or created) cases
  ok((await a2('GET', '/api/matters/' + mid)).s === 404, 'default: advocate cannot open another\'s case');
  ok((await a2('GET', '/api/matters')).j.length === 0, 'default: advocate list empty');
  ok((await a1('PUT', '/api/team/settings', { advocate: ['allcases'] })).s === 403, 'only admin can change advocate access');
  ok((await ad('PUT', '/api/team/settings', { advocate: ['allcases'] })).s === 200, 'admin opens all cases to advocates');
  ok((await a2('GET', '/api/matters/' + mid)).s === 200, 'toggle: advocate sees any case');
  ok((await a2('GET', '/api/matters')).j.length === 2, 'toggle: list shows all');
  ok((await ad('PUT', '/api/team/settings', { advocate: [] })).s === 200, 'toggle off again');
  ok((await ad('PUT', '/api/team/settings', { restrict: true })).j.restrict === true, 'admin switches staff restriction on');
  ok((await a1('GET', '/api/matters')).j.length === 0, 'on: unassigned advocate sees nothing');
  ok((await a1('GET', '/api/matters/' + mid)).s === 404, 'on: unassigned case hidden (404)');
  // assign
  r = await ad('PUT', `/api/matters/${mid}/team`, { members: [{ user_id: u1, level: 'work' }, { user_id: u2, level: 'view' }, { user_id: 99999, level: 'full' }] }); ok(r.s === 200 && r.j.members.length === 2, 'assign two, bad user ignored');
  ok((await a1('GET', '/api/matters')).j.map((x) => x.id).join() === String(mid), 'assigned advocate sees only their case');
  r = await a1('GET', '/api/matters/' + mid); ok(r.s === 200 && r.j.my_level === 'work' && r.j.client_phone === '9876543210', 'work level loads; my_level set');
  ok((await a1('GET', '/api/matters/' + mid2)).s === 404, 'other case still hidden');
  ok((await a1('POST', `/api/matters/${mid}/notings`, { note: 'hello' })).s === 200, 'work can add noting');
  ok((await a1('POST', `/api/matters/${mid}/hearings`, { hearing_date: '2030-01-01' })).s === 200, 'work can add hearing');
  ok((await a1('PUT', '/api/matters/' + mid, { title: 'X' })).s === 403, 'work cannot edit details');
  ok((await a1('PUT', `/api/matters/${mid}/team`, { members: [] })).s === 403, 'work cannot change team');
  ok((await a2('GET', '/api/matters/' + mid)).j.invoices.length === 0, 'view: fees hidden');
  ok((await a2('POST', `/api/matters/${mid}/notings`, { note: 'no' })).s === 403, 'view cannot add noting');
  ok((await a2('POST', `/api/matters/${mid}/hearings`, { hearing_date: '2030-01-01' })).s === 403, 'view cannot add hearing');
  ok((await a2('POST', '/api/tasks', { title: 't', matter_id: mid })).s === 403, 'view cannot add task');
  ok((await a1('POST', '/api/tasks', { title: 't', matter_id: mid })).s === 200, 'work can add task');
  ok((await a1('POST', '/api/tasks', { title: 't', matter_id: mid2 })).s === 403, 'cannot add task on hidden case');
  ok((await a1('GET', '/api/clients')).j.length === 1 && (await a1('GET', '/api/clients/' + cid)).j.matters.length === 1, 'client + matter list limited to own cases');
  ok((await a2('GET', '/api/fs/list?client_id=' + cid)).s === 200, 'view can browse client files');
  ok((await ad('GET', '/api/matters')).j.length === 2 && (await ad('GET', '/api/matters/' + mid2)).s === 200, 'admin sees all');
  ok((await ad('GET', `/api/matters/${mid}/team`)).j.can_manage === true, 'admin can manage');
  ok((await anon('GET', `/api/matters/${mid}/team`)).s === 401, 'team needs sign-in');
  // lead advocate (assigned_to) has full
  db.prepare('UPDATE matters SET assigned_to=? WHERE id=?').run(u1, mid2);
  ok((await a1('GET', '/api/matters/' + mid2)).j.my_level === 'full', 'lead advocate gets full');
  // turn off again
  await ad('PUT', '/api/team/settings', { restrict: false });
  ok((await a1('GET', '/api/matters')).j.length === 2, 'off again: all visible');
  console.log(`team tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
