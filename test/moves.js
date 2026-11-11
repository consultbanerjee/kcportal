'use strict';
// v5.0.4: file movement - return date, reminders, escalation to the firm
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc5-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const C = require('../routes/control'); const SH = require('../routes/shield');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx, h: r.headers }; }; }
const signup = async (c, email, pw) => { const row = db.prepare("SELECT invite_token t FROM users WHERE email=?").get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
const MV = require('../routes/moves');
(async () => {
  const ad = client(), a1 = client(), tc = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv One', email: 'a1@example.com', role: 'advocate' }); await signup(a1, 'a1@example.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Tele', email: 'tc@example.com', role: 'telecaller', phone: '9830000000' }); await signup(tc, 'tc@example.com', 'StrongPass123');
  const u1 = db.prepare("SELECT id FROM users WHERE email='a1@example.com'").get().id, ut = db.prepare("SELECT id FROM users WHERE email='tc@example.com'").get().id, uad = db.prepare("SELECT id FROM users WHERE email='kclegal.in@gmail.com'").get().id;
  let r = await ad('POST', '/api/clients', { name: 'Mv Client' }); const cid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Move Matter' }); const mid = r.j.id;
  const holderOf = () => db.prepare('SELECT assigned_to a FROM matters WHERE id=?').get(mid).a;
  r = await ad('POST', `/api/matters/${mid}/move`, { to_user: u1, note: 'please prepare' }); ok(r.s === 200, 'admin moves file');
  const mv1 = r.j.id, due = new Date(r.j.due_at).getTime() - Date.now(); ok(due > 23.5 * 3600000 && due < 24.1 * 3600000, 'default return = 24 hours');
  ok(holderOf() === u1, 'file now held by recipient');
  r = await a1('GET', '/api/moves?view=mine'); ok(r.j.rows.length === 1 && r.j.rows[0].overdue === false, 'recipient sees it in My files');
  ok((await ad('POST', `/api/matters/${mid}/move`, { to_user: 99999 })).s === 400, 'bad recipient refused');
  ok((await ad('POST', `/api/matters/${mid}/move`, { to_user: u1, due_date: '2020-01-01' })).s === 400, 'past date refused');
  // recipient forwards to the telecaller with a fixed date (previous movement closes as forwarded)
  const d3 = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  r = await a1('POST', `/api/matters/${mid}/move`, { to_user: ut, due_date: d3 }); ok(r.s === 200, 'holder forwards to telecaller with a date');
  ok(db.prepare('SELECT status s FROM matter_moves WHERE id=?').get(mv1).s === 'forwarded', 'earlier movement closed as forwarded');
  const mv2 = r.j.id; ok(holderOf() === ut, 'telecaller holds it');
  ok((await tc('GET', '/api/moves?view=all')).s === 403, 'only admin sees all');
  // overdue -> notice 1
  const past = (h) => new Date(Date.now() - h * 3600000).toISOString();
  db.prepare('UPDATE matter_moves SET due_at=? WHERE id=?').run(past(1), mv2); await MV.tick();
  let x = db.prepare('SELECT stage,notice1_at FROM matter_moves WHERE id=?').get(mv2); ok(x.stage === 1 && x.notice1_at, 'first notice sent on expiry');
  ok(db.prepare("SELECT COUNT(*) c FROM matter_move_log WHERE move_id=? AND kind='notice1'").get(mv2).c === 2, 'notice1 logged for email and WhatsApp');
  await MV.tick(); ok(db.prepare("SELECT COUNT(*) c FROM matter_move_log WHERE move_id=? AND kind='notice1'").get(mv2).c === 2, 'no duplicate notice');
  r = await tc('GET', '/api/moves?view=mine'); ok(r.j.rows[0].overdue === true, 'shown overdue');
  // 2 days later -> reminder
  db.prepare('UPDATE matter_moves SET notice1_at=? WHERE id=?').run(past(49), mv2); await MV.tick();
  ok(db.prepare('SELECT stage s FROM matter_moves WHERE id=?').get(mv2).s === 2, 'reminder after 2 days');
  // still nothing -> back to the firm
  db.prepare('UPDATE matter_moves SET notice2_at=? WHERE id=?').run(past(25), mv2); await MV.tick();
  x = db.prepare('SELECT status,escalated_to FROM matter_moves WHERE id=?').get(mv2); ok(x.status === 'escalated' && x.escalated_to === uad, 'escalated to firm admin');
  ok(holderOf() === uad, 'file with firm admin for fresh allocation');
  // return flow
  r = await ad('POST', `/api/matters/${mid}/move`, { to_user: u1 }); const mv3 = r.j.id;
  ok((await tc('POST', `/api/moves/${mv3}/return`)).s === 403, 'outsider cannot return');
  ok((await a1('POST', `/api/moves/${mv3}/return`)).s === 200 && holderOf() === uad, 'recipient returns; file goes back to sender');
  ok((await a1('POST', `/api/moves/${mv3}/return`)).s === 404, 'cannot return twice');
  db.prepare('UPDATE matter_moves SET due_at=? WHERE id=?').run(past(100), mv3); await MV.tick(); ok(db.prepare('SELECT stage s FROM matter_moves WHERE id=?').get(mv3).s === 0, 'returned file never reminded');
  r = await ad('GET', `/api/matters/${mid}/moves`); ok(r.j.history.length === 3 && r.j.can_move === true && r.j.holder.id === uad, 'case history of movements');
  ok((await ad('PUT', '/api/moves/settings', { hours: 48 })).j.cfg.hours === 48, 'admin sets default hours');
  console.log(`moves tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
