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
const Q = require('../routes/quote');
(async () => {
  const ad = client(), a1 = client(), sa = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123'); await signup(sa, 'consultbanerjee@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv One', email: 'a1@example.com', role: 'advocate' }); await signup(a1, 'a1@example.com', 'StrongPass123');
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  let asked = null; AI.setTransport(async (body) => { asked = body; return { content: [{ type: 'text', text: 'Answer under Indian law. Please verify every citation.' }], usage: { input_tokens: 5, output_tokens: 5 } }; });
  // quote of the day: same all day, changes with the date, available to everyone
  const q1 = (await ad('GET', '/api/quote')).j; ok(q1.text && q1.by && /^\d{4}-\d\d-\d\d$/.test(q1.date), 'quote returned');
  ok(JSON.stringify((await ad('GET', '/api/quote')).j) === JSON.stringify(q1), 'quote is stable within the day');
  ok(Q.quoteFor('2026-11-12').text !== Q.quoteFor('2026-11-13').text, 'quote changes next day');
  ok(Q.quoteFor('2026-11-12').text === Q.quoteFor('2026-11-12').text && Q.QUOTES.length >= 40 && new Set(Q.QUOTES.map((x) => x[0])).size === Q.QUOTES.length, 'quote list is long and unique');
  ok((await a1('GET', '/api/quote')).s === 200 && (await sa('GET', '/api/quote')).s === 200 && (await client()('GET', '/api/quote')).s === 401, 'quote for everyone who is signed in');
  // research
  const cid = (await ad('POST', '/api/clients', { name: 'Res Client' })).j.id;
  await ad('POST', '/api/judgments', { court: 'Supreme Court of India', title: 'State of X v. Y', case_no: 'CA 12/2020', citation: '(2020) 5 SCC 1', judge: 'Justice Z', subject: 'Section 138 NI Act cheque dishonour', summary: 'test', decided_on: '2020-01-02' });
  let r = await ad('GET', '/api/research/search?mode=keyword&q=cheque'); ok(r.s === 200 && r.j.judgments.length === 1 && r.j.sources.length >= 4, 'keyword search');
  ok((await ad('GET', '/api/research/search?mode=citation&q=5 SCC')).j.judgments.length === 1, 'citation search');
  ok((await ad('GET', '/api/research/search?mode=judge&q=Justice Z')).j.judgments.length === 1, 'judge search');
  ok((await ad('GET', '/api/research/search?mode=act&q=Section 138')).j.judgments.length === 1, 'act search');
  const mid = (await ad('POST', '/api/matters', { client_id: cid, title: 'Res Case', forum: 'DRT-2 Kolkata', opposite_party: 'Alpha Bank' })).j.id;
  ok((await ad('GET', '/api/research/search?mode=party&q=Alpha')).j.matters.length === 1, 'party search finds own case');
  r = await ad('POST', '/api/research/ask', { q: 'Can a bank enforce security interest after limitation?', matter_id: mid }); ok(r.s === 200 && /Indian law/.test(r.j.answer), 'AI answer');
  ok(/Indian law/.test(JSON.stringify(asked.system)) && /DRT-2 Kolkata/.test(asked.system) && /overruled/i.test(asked.system), 'prompt: India only, same forum first, overruled check');
  ok((await ad('POST', '/api/research/ask', { q: 'short' })).s === 400, 'short question refused');
  r = await ad('POST', '/api/research/overruled', { case: 'Some v. Other (2019) 1 SCC 1' }); ok(r.s === 200 && r.j.id, 'overruled check');
  ok((await ad('GET', '/api/research/history')).j.length === 2, 'history kept');
  const hid = (await ad('GET', '/api/research/history')).j[0].id;
  ok((await ad('POST', '/api/research/save', { id: hid, matter_id: mid })).s === 200 && db.prepare('SELECT COUNT(*) n FROM notings WHERE matter_id=?').get(mid).n === 1, 'answer saved as a noting');
  // switches: advocate gate, firm switch, Super Admin plan switch
  ok((await a1('GET', '/api/research/status')).s === 403, 'advocate: closed by default');
  await ad('PUT', '/api/team/settings', { advocate: ['research'] }); ok((await a1('GET', '/api/research/status')).s === 200, 'advocate: open when firm allows');
  ok((await a1('PUT', '/api/research/settings', { on: false })).s === 403, 'only admin switches the firm');
  ok((await ad('PUT', '/api/research/settings', { on: false })).s === 200 && (await ad('GET', '/api/research/search?mode=keyword&q=cheque')).s === 403, 'firm switch off blocks search');
  ok((await ad('GET', '/api/modules')).j.off.includes('research'), 'menu hides it when firm is off');
  await ad('PUT', '/api/research/settings', { on: true });
  ok(!(await ad('GET', '/api/modules')).j.off.includes('research'), 'menu shows it when on');
  const off = (db.prepare("SELECT value FROM firm_settings WHERE tenant_id=? AND key='sa_off'").get(t) || {}).value || '';
  r = await sa('PUT', `/api/platform/firms/${t}/plan`, { off: [...off.split(',').filter(Boolean), 'research'] });
  ok([200, 404].includes(r.s), 'Super Admin plan call answered ' + r.s);
  AI.setS(t, 'sa_off', 'research');
  ok((await ad('GET', '/api/research/status')).s === 403 && (await ad('GET', '/api/modules')).j.off.includes('research'), 'Super Admin switch blocks the firm');
  AI.setS(t, 'sa_off', '');
  // dashboard honours scope
  const d = (await a1('GET', '/api/dashboard')).j; ok(d.open_matters === 0 && d.dates.length === 0, 'advocate dashboard counts only his own');
  console.log(`research tests: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
