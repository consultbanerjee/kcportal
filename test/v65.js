'use strict';
// v6.5: judgment reader - saved marks, marked Word/PDF, filing into a client's Judgements folder (fake search service here)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc65-'));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const posts = [];
const fake = http.createServer(async (req, res) => {
  const ch = []; for await (const c of req) ch.push(c); const body = ch.length ? JSON.parse(Buffer.concat(ch)) : null; const j = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers['x-api-key'] !== 'k-test') return j({ error: 'no' }, 401);
  if (req.url === '/api/v1/doc/CalHC/7') return j({ doc: { title: 'Test v State', court: 'Calcutta High Court', case_no: 'WPA/1/2024', decision_date: '2024-01-02', body: 'The appellant relies on the Act.\nSecond paragraph of the judgment.' } });
  if (req.url === '/api/v1/doc/CalHC/7/pdf') return j({ error: 'none' }, 404);
  j({ error: 'nf' }, 404);
});
(async () => {
  await new Promise((r) => fake.listen(0, r)); process.env.SEARCH_URL = 'http://127.0.0.1:' + fake.address().port; process.env.SEARCH_API_KEY = 'k-test';
  const app = require('../server'); const { db } = require('../db'); const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
  function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = JSON.parse(await r.text()); } catch (e) {} return { s: r.status, j }; }; }
  const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
  const sa = client(), ad = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  const marks = [{ s: 4, e: 13, k: 'h', c: '#39ff14' }, { s: 14, e: 30, k: 'u', c: '#8b0000' }, { s: 'x', e: 3, k: 'u', c: 'red' }, { s: 5, e: 5, k: 'u', c: '#000000' }];
  let r = await ad('PUT', '/api/research/caselaw/marks/CalHC/7', { marks }); ok(r.s === 200, 'marks saved');
  r = await ad('GET', '/api/research/caselaw/marks/CalHC/7'); ok(r.s === 200 && r.j.marks.length === 2 && r.j.marks[0].c === '#39ff14', 'only valid marks kept');
  ok((await ad('GET', '/api/research/caselaw/marks/../7')).s !== 200, 'bad folder refused');
  r = await ad('PUT', '/api/research/caselaw/marks/CalHC/7', { marks: [] }); r = await ad('GET', '/api/research/caselaw/marks/CalHC/7'); ok(r.j.marks.length === 0, 'cleared');
  for (const fm of ['pdf', 'docx']) { const rs = await fetch(base + '/api/research/caselaw/doc/CalHC/7/annotated/' + fm, { method: 'POST', headers: { 'X-Requested-With': 'kcportal', 'Content-Type': 'application/json', cookie: ad.cookie || '' }, body: JSON.stringify({ marks }) }); ok(rs.status === 401 || rs.status === 200, 'marked ' + fm + ' endpoint answers'); }
  const cid = db.prepare("SELECT id FROM tenants WHERE kind='firm' LIMIT 1").get().id;
  const cl = (await ad('POST', '/api/clients', { name: 'Test Client', phone: '9000000001' })).j;
  r = await ad('POST', '/api/research/caselaw/to-client', { client_id: cl.id, folder: 'CalHC', id: '7', kind: 'annotated_docx', marks }); ok(r.s === 200 && /marked/.test(r.j.name), 'marked copy filed in client folder');
  r = await ad('POST', '/api/research/caselaw/to-client', { client_id: cl.id, folder: 'CalHC', id: '7', kind: 'docx' }); ok(r.s === 200, 'plain Word filed');
  r = await ad('POST', '/api/research/caselaw/note-to-client', { client_id: cl.id, title: 'Test v State', note: '[27 Nov 2026, 9:14 pm] Useful on limitation.' }); ok(r.s === 200 && /note/.test(r.j.name), 'note filed');
  const jf = db.prepare("SELECT id FROM fs_nodes WHERE client_id=? AND lower(name)='judgements' AND kind='folder'").get(cl.id);
  ok(jf && db.prepare('SELECT COUNT(*) n FROM fs_nodes WHERE parent_id=? AND kind=\'file\'').get(jf.id).n === 3, 'three files sit under the Judgements folder');
  ok((await ad('POST', '/api/research/caselaw/to-client', { client_id: 99999, folder: 'CalHC', id: '7', kind: 'pdf' })).s === 404, 'unknown client refused');
  ok((await ad('POST', '/api/research/caselaw/to-client', { client_id: cl.id, folder: 'CalHC', id: '7', kind: 'evil' })).s === 400, 'bad kind refused');
  ok((await ad('POST', '/api/research/caselaw/note-to-client', { client_id: cl.id, note: '' })).s === 400, 'empty note refused');
  console.log(`v65: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
