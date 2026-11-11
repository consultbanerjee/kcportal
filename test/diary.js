'use strict';
// v5.0.5: case diary - entries, court sync, ordering, reply clock
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc5-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const C = require('../routes/control'); const SH = require('../routes/shield');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx, h: r.headers }; }; }
const signup = async (c, email, pw) => { const row = db.prepare("SELECT invite_token t FROM users WHERE email=?").get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };

const DI = require('../routes/diary');
(async () => {
  const ad = client(), a1 = client(), cl = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv One', email: 'a1@example.com', role: 'advocate' }); await signup(a1, 'a1@example.com', 'StrongPass123');
  let r = await ad('POST', '/api/clients', { name: 'Diary Client' }); const cid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Diary Matter' }); const mid = r.j.id;
  const P = (b) => ad('POST', `/api/matters/${mid}/diary`, b), G = async () => (await ad('GET', `/api/matters/${mid}/diary`)).j;
  const d0 = (n) => new Date(Date.now() + 5.5 * 3600000 + n * 864e5).toISOString().slice(0, 10);
  ok((await P({ kind: 'meeting' })).s === 400 && (await P({ date: d0(-30), kind: 'bogus', note: 'x' })).s === 400, 'validation');
  ok((await P({ date: d0(-30), kind: 'meeting', note: 'First meeting; documents received' })).s === 200, 'first meeting');
  ok((await P({ date: d0(-28), kind: 'advice', note: 'Advised legal notice' })).s === 200, 'advice');
  r = await P({ date: d0(-20), kind: 'notice_sent', note: 'Speed post', reply_days: 15 }); const sentId = r.j.id;
  let g = await G(); ok(g.entries.length === 3 && g.entries.map((e) => e.kind).join() === 'meeting,advice,notice_sent', 'entries in date order');
  ok(g.entries[2].clock.days === 15 && g.entries[2].clock.over === true, 'reply clock: 15 days from sent date, already over');
  // delivery date restarts the clock
  await P({ date: d0(-5), kind: 'notice_received', note: 'Delivered' }); g = await G(); const ns = g.entries.find((e) => e.id === sentId);
  ok(ns.clock.over === false && ns.clock.left === 10, 'delivery date restarts the clock (10 days left)');
  // out-of-order entry still slots by date
  await P({ date: d0(-25), kind: 'note', note: 'Client phoned' }); g = await G(); ok(g.entries.map((e) => e.date).join() === [...g.entries.map((e) => e.date)].sort().join(), 'new entry slotted by date');
  ok(g.stage === 1 && g.stages.length === 6, 'stage = Notice');
  // clock expiry -> system entry once
  const mt = JSON.parse(db.prepare('SELECT meta FROM matter_diary WHERE id=?').get(sentId).meta); db.prepare('UPDATE matter_diary SET meta=? WHERE id=?').run(JSON.stringify({ ...mt, due: d0(-1) }), sentId);
  await DI.tick(); await DI.tick(); g = await G(); ok(g.entries.filter((e) => e.kind === 'no_reply').length === 1, 'no-reply entry added once on expiry');
  // reply closes the clock
  r = await P({ date: d0(-20), kind: 'notice_sent', note: 'Second notice', reply_days: 5 }); const s2 = r.j.id; await P({ date: d0(-18), kind: 'reply', note: 'Reply came' });
  db.prepare("UPDATE matter_diary SET meta=? WHERE id=?").run(JSON.stringify({ days: 5, due: d0(-2), closed: 1 }), s2); const before = (await G()).entries.length; await DI.tick(); ok((await G()).entries.length === before, 'no alert after a reply');
  // manual reorder: reverse
  g = await G(); const ids = g.entries.map((e) => e.id).reverse(); ok((await ad('PUT', `/api/matters/${mid}/diary/order`, { ids })).s === 200, 'reorder'); g = await G(); ok(g.entries.map((e) => e.id).join() === ids.join(), 'custom order kept');
  await ad('POST', `/api/matters/${mid}/diary/sort`); g = await G(); ok(g.entries.map((e) => e.date).join() === [...g.entries.map((e) => e.date)].sort().join(), 'sort by date');
  // edit / delete / audit
  const first = g.entries[0].id; ok((await ad('PUT', '/api/diary/' + first, { note: 'Edited note', date: d0(-31) })).s === 200, 'edit'); g = await G(); ok(g.entries.find((e) => e.id === first).note === 'Edited note' && g.entries.find((e) => e.id === first).edited, 'edit applied and flagged');
  ok(db.prepare('SELECT COUNT(*) c FROM matter_diary_log WHERE entry_id=?').get(first).c === 1, 'old version kept in the trail');
  ok((await ad('DELETE', '/api/diary/' + first)).s === 200 && (await G()).entries.every((e) => e.id !== first), 'delete'); ok((await ad('DELETE', '/api/diary/' + first)).s === 404, 'already deleted');
  // court entries come from stored hearings and orders; editing keeps date, removal is not undone by the next sync
  db.prepare("INSERT INTO hearings(tenant_id,matter_id,hearing_date,purpose,outcome,next_date,source) VALUES (1,?,?,?,?,?,'ecourt')").run(mid, d0(-3), 'Evidence', 'Adjourned', d0(30));
  g = await G(); const ch = g.entries.find((e) => e.kind === 'hearing'); ok(ch && ch.source === 'court' && /Next date/.test(ch.note), 'court hearing appears');
  await ad('PUT', '/api/diary/' + ch.id, { date: '2000-01-01', title: 'hacked', note: 'My comment' }); g = await G(); const ch2 = g.entries.find((e) => e.id === ch.id); ok(ch2.date === d0(-3) && ch2.title === 'Evidence' && ch2.note === 'My comment', 'court entry: date and title fixed, note editable');
  await ad('DELETE', '/api/diary/' + ch.id); g = await G(); ok(g.entries.every((e) => e.id !== ch.id), 'court entry removed'); ok((await G()).entries.every((e) => e.kind !== 'hearing'), 'not re-added by next sync');
  ok(g.stage === 2 || g.stage === 1, 'stage moves with entries');
  // client sees only what is ticked
  await P({ date: d0(-1), kind: 'note', note: 'Visible to client', visible: true }); await ad('POST', `/api/clients/${cid}/invite`, {}).catch(() => {});
  const vis = db.prepare('SELECT COUNT(*) c FROM matter_diary WHERE matter_id=? AND client_visible=1 AND deleted_at IS NULL').get(mid).c; ok(vis === 1, 'one entry marked visible');
  // access: view-only cannot add; unassigned hidden when restriction on
  await ad('PUT', '/api/team/settings', { restrict: true }); ok((await a1('GET', `/api/matters/${mid}/diary`)).s === 404, 'hidden diary for unassigned advocate');
  const u1 = db.prepare("SELECT id FROM users WHERE email='a1@example.com'").get().id; await ad('PUT', `/api/matters/${mid}/team`, { members: [{ user_id: u1, level: 'view' }] });
  ok((await a1('GET', `/api/matters/${mid}/diary`)).j.can_edit === false && (await a1('POST', `/api/matters/${mid}/diary`, { date: d0(0), kind: 'note', note: 'x' })).s === 403, 'view level reads but cannot add');
  console.log(`diary tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
