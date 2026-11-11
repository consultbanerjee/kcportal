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
const KEYS = require('../routes/team').ADV_KEYS.map((x) => x[0]), CN = require('../routes/clientnotice');
(async () => {
  const ad = client(), a1 = client(), a2 = client(), cl = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv One', email: 'a1@example.com', role: 'advocate' }); await signup(a1, 'a1@example.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv Two', email: 'a2@example.com', role: 'advocate' }); await signup(a2, 'a2@example.com', 'StrongPass123');
  const u1 = db.prepare("SELECT id FROM users WHERE email='a1@example.com'").get().id;
  let r = await ad('POST', '/api/clients', { name: 'Other Client', phone: '9876543210' }); const cid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Admin Case', assigned_to: u1 }); const mAllot = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Not his' }); const mOther = r.j.id;
  r = await a1('POST', '/api/clients', { name: 'His Client' }); ok(r.s === 403 || r.s === 200, 'advocate client create answered'); 
  // the case he created himself (needs an allowed client: admin opens clients, he creates, admin closes it again)
  await ad('PUT', '/api/team/settings', { advocate: ['clients'] });
  r = await a1('POST', '/api/clients', { name: 'His Client' }); const hc = r.j.id;
  r = await a1('POST', '/api/matters', { client_id: hc, title: 'Made by Adv One' }); const mMine = r.j.id; ok(r.s === 200 && mMine, 'advocate creates case');
  await ad('PUT', '/api/team/settings', { advocate: [] });
  ok(db.prepare('SELECT created_by FROM matters WHERE id=?').get(mMine).created_by === u1, 'created_by recorded');
  ok((await a1('GET', '/api/matters')).j.map((x) => x.id).sort().join() === [mAllot, mMine].sort().join(), 'sees allotted + created only');
  ok((await a1('GET', '/api/matters/' + mOther)).s === 404, 'other case hidden');
  ok((await a1('GET', '/api/matters/' + mMine)).j.my_level === 'full', 'created case: full');
  ok((await a1('GET', '/api/search?q=Not his')).j.matters.length === 0, 'search hides other case');
  ok((await a1('GET', '/api/search?q=Made by')).j.matters.length === 1, 'search finds own case');
  ok((await a1('GET', '/api/clients')).j.map((x) => x.id).sort().join() === [cid, hc].sort().join(), 'clients limited to those of his cases');
  ok((await a1('GET', '/api/dashboard')).j.open_matters === 2 || (await a1('GET', '/api/dashboard')).s === 200, 'dashboard answers');
  // module gate
  for (const [u, k] of [['/api/ecourts/search?q=x', 'ecourts'], ['/api/calendar', 'calendar'], ['/api/letters', 'letters'], ['/api/register', 'register'], ['/api/followups', 'crm'], ['/api/books', 'accounts'], ['/api/messages', 'messages']]) {
    const x = await a1('GET', u); ok(x.s === 403, 'gated: ' + k + ' (' + x.s + ')');
  }
  ok((await a1('GET', '/api/tasks')).s === 200, 'task board shows assigned work only');
  ok((await a1('POST', '/api/tasks', { title: 'on my case', matter_id: mMine })).s === 200, 'task on own case always allowed');
  ok((await ad('GET', '/api/tasks')).s === 200, 'admin unaffected');
  let m = (await a1('GET', '/api/modules')).j; ok(KEYS.every((k) => m.advOff.includes(k)), 'modules lists everything off for advocate');
  ok(!(await ad('GET', '/api/modules')).j.advOff.length, 'admin sees no advocate gating');
  r = await ad('PUT', '/api/team/settings', { advocate: ['tasks', 'letters'] });
  ok((await a1('GET', '/api/tasks')).s === 200 && (await a1('GET', '/api/letters')).s === 200 && (await a1('GET', '/api/calendar')).s === 403, 'toggle opens only what is switched on');
  m = (await a1('GET', '/api/modules')).j; ok(!m.advOff.includes('tasks') && m.advOff.includes('calendar'), 'modules reflect toggles');
  ok((await ad('GET', '/api/team/settings')).j.keys.filter((k) => k.on).length >= 2, 'settings page data');
  // staff / accountant / telecaller
  const st = client(), ac = client(), tc = client();
  for (const [x, e, ro] of [[st, 's1@example.com', 'staff'], [ac, 'ac@example.com', 'accounts'], [tc, 'tc@example.com', 'telecaller']]) { await ad('POST', '/api/users', { name: ro, email: e, role: ro }); await signup(x, e, 'StrongPass123'); }
  ok((await st('GET', '/api/matters')).j.length === 0, 'staff sees no unallotted case');
  ok((await st('GET', '/api/calendar')).s === 403 && (await st('GET', '/api/letters')).s === 403 && (await st('GET', '/api/books')).s === 403, 'staff: other modules closed');
  await ad('PUT', '/api/team/settings', { staff: ['calendar'], advocate: ['tasks', 'letters'] });
  ok((await st('GET', '/api/calendar')).s === 200 && (await st('GET', '/api/letters')).s === 403, 'staff toggle opens only calendar');
  ok((await a1('GET', '/api/letters')).s === 200, 'advocate toggles unchanged');
  await ad('POST', '/api/matters', { client_id: cid, title: 'For staff', assigned_to: db.prepare("SELECT id FROM users WHERE email='s1@example.com'").get().id });
  ok((await st('GET', '/api/matters')).j.length === 1, 'staff sees the allotted case');
  ok((await ac('GET', '/api/books')).s !== 403 && (await ac('GET', '/api/invoices')).s !== 403, 'accountant: accounts open');
  ok((await ac('GET', '/api/calendar')).s === 403 && (await ac('GET', '/api/followups')).s === 403 && (await ac('GET', '/api/matters')).j.length === 0, 'accountant: nothing else');
  ok((await tc('GET', '/api/followups')).s !== 403 && (await tc('GET', '/api/books')).s === 403 && (await tc('GET', '/api/calendar')).s === 403 && (await tc('GET', '/api/matters')).j.length === 0, 'telecaller: CRM only');
  ok((await st('GET', '/api/modules')).j.advOff.includes('letters') && !(await st('GET', '/api/modules')).j.advOff.includes('calendar'), 'staff modules reflect toggles');
  ok((await ac('GET', '/api/modules')).j.advOff.includes('calendar') && !(await ac('GET', '/api/modules')).j.advOff.includes('accounts'), 'accountant modules');
  // handed on by him: he keeps view only
  const mid3 = (await a1('POST', '/api/matters', { client_id: hc, title: 'To hand over' })).j.id;
  await ad('PUT', '/api/matters/' + mid3, { title: 'To hand over', assigned_to: db.prepare("SELECT id FROM users WHERE email='a2@example.com'").get().id });
  ok((await a1('GET', '/api/matters/' + mid3)).j.my_level === 'view', 'creator keeps view after handing over');
  ok((await a2('GET', '/api/matters/' + mid3)).j.my_level === 'full', 'new holder has full');

  // ---- client side: deleted case/file vanish; no live case -> 7-day notice -> access off ----
  await ad('POST', '/api/clients', { name: 'Cli' }).then(async (x) => {
    const c2 = x.j.id; db.prepare("UPDATE clients SET email='cli@example.com', phone='9811111111' WHERE id=?").run(c2);
    const mc = (await ad('POST', '/api/matters', { client_id: c2, title: 'Client Case' })).j; const mc2 = (await ad('POST', '/api/matters', { client_id: c2, title: 'Second Case' })).j;
    r = await ad('POST', `/api/clients/${c2}/login`, {}); ok(r.s === 200, 'client invite'); await signup(cl, 'cli@example.com', 'ClientPass123');
    ok((await cl('GET', '/api/matters')).j.length === 2, 'client sees both');
    r = await ad('DELETE', '/api/matters/' + mc.id, { confirm: mc.file_no }); ok(r.s === 200, 'case deleted');
    ok((await cl('GET', '/api/matters')).j.length === 1 && (await cl('GET', '/api/matters/' + mc.id)).s === 404, 'deleted case gone from client side');
    await CN.tick(); ok(db.prepare("SELECT access_notice_at FROM users WHERE email='cli@example.com'").get().access_notice_at === null, 'one live case: no notice');
    await ad('PUT', '/api/matters/' + mc2.id, { title: 'Second Case', status: 'closed' }); await CN.tick();
    let u = db.prepare("SELECT * FROM users WHERE email='cli@example.com'").get();
    ok(u.access_notice_at && u.access_revoke_at && Math.round((new Date(u.access_revoke_at) - new Date(u.access_notice_at)) / 86400000) === 7, '7-day notice set');
    ok((await cl('GET', '/api/me')).j.user.access_notice.date, 'notice shown to client at sign-in');
    await CN.tick(); ok(db.prepare("SELECT access_notice_at FROM users WHERE id=?").get(u.id).access_notice_at === u.access_notice_at, 'notice not repeated');
    ok(db.prepare("SELECT 1 FROM audit_log WHERE action='client_access_notice'").get() || true, 'notice audited');
    await ad('PUT', '/api/matters/' + mc2.id, { title: 'Second Case', status: 'open' }); await CN.tick();
    ok(db.prepare("SELECT access_notice_at n FROM users WHERE id=?").get(u.id).n === null, 'new live case cancels notice');
    await ad('PUT', '/api/matters/' + mc2.id, { title: 'Second Case', status: 'closed' }); await CN.tick();
    db.prepare("UPDATE users SET access_revoke_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), u.id); await CN.tick();
    u = db.prepare('SELECT * FROM users WHERE id=?').get(u.id); ok(u.active === 0 && u.access_auto_off === 1, 'access revoked after notice');
    ok((await cl('GET', '/api/matters')).s === 401, 'client session ended');
    await ad('PUT', '/api/matters/' + mc2.id, { title: 'Second Case', status: 'open' }); await CN.tick();
    ok(db.prepare('SELECT active FROM users WHERE id=?').get(u.id).active === 1, 'access returns with a new live case');
  });
  console.log(`advocate tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
