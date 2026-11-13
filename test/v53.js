'use strict';
// v5.3: case-law window onto the KC Search service (fake service here)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc53-'));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const seen = [];
const fake = http.createServer((req, res) => {
  seen.push({ url: req.url, key: req.headers['x-api-key'] }); const u = new URL(req.url, 'http://x'); const j = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers['x-api-key'] !== 'k-test') return j({ error: 'no' }, 401);
  if (u.pathname === '/api/v1/courts') return j({ courts: [{ folder: 'CalHC', name: 'Calcutta High Court', docs: 1200 }, { folder: 'SCI', name: 'Supreme Court of India', docs: 900 }] });
  if (u.pathname === '/api/v1/search') return j({ ms: 12, more: false, courts: ['CalHC'], results: [{ id: 7, folder: 'CalHC', court: 'Calcutta High Court', title: 'A v B', year: 2020, decision_date: '2020-05-01', judge: 'X J', snip: 'the <mark>limitation</mark> <script>alert(1)</script> period' }] });
  if (u.pathname === '/api/v1/doc/CalHC/7') return j({ doc: { id: 7, folder: 'CalHC', court: 'Calcutta High Court', title: 'A v B', case_no: 'WP 1/2020', citation: '2020 CHN 1', decision_date: '2020-05-01', judge: 'X J', parties: 'A v B', body: 'Full text of the judgment about limitation.' } });
  if (u.pathname === '/api/v1/doc/CalHC/7/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(Buffer.from('%PDF-1.4 fake original')); }
  if (u.pathname === '/api/v1/doc/CalHC/8') return j({ doc: { id: 8, folder: 'CalHC', court: 'Calcutta High Court', title: 'C v D', body: 'Text only judgment.' } });
  if (u.pathname === '/api/v1/doc/CalHC/8/pdf') return j({ error: 'nf' }, 404);
  j({ error: 'nf' }, 404);
});
(async () => {
  await new Promise((r) => fake.listen(0, r)); process.env.SEARCH_URL = 'http://127.0.0.1:' + fake.address().port; process.env.SEARCH_API_KEY = 'k-test';
  const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore');
  const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
  function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; try { j = JSON.parse(await r.text()); } catch (e) {} return { s: r.status, j }; }; }
  const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
  const ad = client(), st = client(), anon = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv', email: 'stf@example.com', role: 'advocate' }); await signup(st, 'stf@example.com', 'StrongPass123');
  let r = await ad('GET', '/api/research/caselaw/status'); ok(r.j.on && r.j.courts.length === 2 && /CC-BY/.test(r.j.credit), 'status lists courts');
  ok(seen.every((x) => x.key === 'k-test'), 'private key sent to the service');
  r = await ad('GET', '/api/research/caselaw/search?q=limitation&courts=CalHC,bad!&year_from=2019'); ok(r.s === 200 && r.j.results.length === 1, 'search works');
  const last = seen[seen.length - 1].url; ok(/courts=CalHC(&|$)/.test(last) && !/bad/.test(last) && /year_from=2019/.test(last), 'filters passed, junk court dropped');
  ok(!/<script/.test(r.j.results[0].snip) && /<mark>limitation<\/mark>/.test(r.j.results[0].snip), 'snippet sanitised, highlight kept');
  ok((await ad('GET', '/api/research/caselaw/search?q=ab')).j.results.length === 0, 'short query not sent');
  ok((await anon('GET', '/api/research/caselaw/search?q=limitation')).s === 401, 'needs sign-in');
  ok((await st('GET', '/api/research/caselaw/search?q=limitation')).s === 403, 'advocate gated until firm admin opens research');
  await ad('PUT', '/api/team/settings', { advocate: ['research'] });
  ok((await st('GET', '/api/research/caselaw/search?q=limitation')).s === 200, 'advocate can search once opened');
  r = await ad('GET', '/api/research/caselaw/doc/CalHC/7'); ok(r.s === 200 && /limitation/.test(r.j.doc.body), 'judgment opens');
  ok((await ad('GET', '/api/research/caselaw/doc/../7')).s !== 200 && (await ad('GET', '/api/research/caselaw/doc/CalHC/abc')).s === 400, 'bad ids refused');
  ok((await ad('GET', '/api/research/caselaw/doc/CalHC/99')).s === 404, 'unknown judgment');
  let f = await ad('GET', '/api/research/caselaw/doc/CalHC/7/docx', null, true); let b = Buffer.from(await f.arrayBuffer()); ok(f.status === 200 && b[0] === 0x50 && b[1] === 0x4b, 'Word download');
  f = await ad('GET', '/api/research/caselaw/doc/CalHC/7/pdf', null, true); b = Buffer.from(await f.arrayBuffer()); ok(f.status === 200 && /original/.test(b.toString()), 'PDF is the original court file when held');
  f = await ad('GET', '/api/research/caselaw/doc/CalHC/8/pdf', null, true); b = Buffer.from(await f.arrayBuffer()); ok(f.status === 200 && b.subarray(0, 4).toString() === '%PDF', 'PDF made from text when original missing');
  ok((await ad('GET', '/api/research/caselaw/doc/CalHC/7/exe', null, true)).status === 400, 'only docx and pdf');
  // save to a case, bookmark with reference
  r = await ad('POST', '/api/clients', { name: 'C', phone: '9000000000' }); const mid = (await ad('POST', '/api/matters', { client_id: r.j.id, title: 'Limitation matter' })).j.id;
  ok((await ad('POST', '/api/research/caselaw/to-case', { matter_id: mid, folder: 'CalHC', id: 7 })).s === 200 && /A v B/.test(db.prepare('SELECT note FROM notings WHERE matter_id=?').get(mid).note), 'saved as noting');
  ok((await ad('POST', '/api/research/caselaw/to-case', { matter_id: 9999, folder: 'CalHC', id: 7 })).s === 404, 'unknown case refused');
  r = await ad('POST', '/api/research/saved', { title: 'A v B', kind: 'Judgment', ref: 'CalHC/7' }); ok(r.s === 200 && (await ad('GET', '/api/research/saved')).j[0].ref === 'CalHC/7', 'bookmark keeps judgment reference');
  ok((await ad('POST', '/api/research/saved', { title: 'x', ref: '../etc' })).s === 200 && (await ad('GET', '/api/research/saved')).j.find((x) => x.title === 'x').ref === '', 'bad reference dropped');
  // AI answer reads retrieved judgments first
  let asked = null; AI.setTransport(async (body) => { asked = body; return { content: [{ type: 'text', text: 'Answer under Indian law.' }], usage: { input_tokens: 5, output_tokens: 5 } }; });
  r = await ad('POST', '/api/research/ask', { q: 'What is the limitation period for a writ?' }); ok(r.s === 200 && /A v B/.test(JSON.stringify(asked.messages)) && /exist/.test(JSON.stringify(asked.messages)), 'AI prompt carries retrieved judgments');
  ok(!/A v B/.test(db.prepare('SELECT query FROM research_log ORDER BY id DESC').get().query), 'history keeps only the question');
  // service down: answers still work
  fake.close(); await new Promise((r2) => setTimeout(r2, 50)); process.env.SEARCH_URL = 'http://127.0.0.1:1';
  r = await ad('POST', '/api/research/ask', { q: 'What is the limitation period for a writ?' }); ok(r.s === 200, 'AI works when case-law service is down');
  r = await ad('GET', '/api/research/caselaw/search?q=limitation'); ok(r.s === 502, 'clear error when service is down');
  console.log(`v53: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
