'use strict';
// v5.4: Super Admin controls the judgments engine from inside the portal (fake service here)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc54-'));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const posts = [];
const fake = http.createServer(async (req, res) => {
  const ch = []; for await (const c of req) ch.push(c); const body = ch.length ? JSON.parse(Buffer.concat(ch)) : null; const j = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers['x-api-key'] !== 'k-test') return j({ error: 'no' }, 401);
  if (req.url === '/api/v1/admin/state') return j({ drive: { connected: true, email: 'x@y.z', client_id: 'SECRETISH' }, settings: { auto: true, hour: 2, concurrency: 4, min_free_gb: 5, delay_ms: 250 }, run: { running: false, queued: [], log: ['a'], free_gb: 60, paused: false }, courts: [{ code: 'CalHC', name: 'Calcutta High Court', folder: 'CalHC', tier: 'full', docs: 5, pdfs: 1, source: 'aws-hc' }, { code: 'NCLT', name: 'NCLT', folder: 'NCLT', source: 'planned' }] });
  if (req.method === 'POST' && req.url.startsWith('/api/v1/admin/')) { posts.push({ url: req.url, body }); return j({ ok: true }); }
  j({ error: 'nf' }, 404);
});
(async () => {
  await new Promise((r) => fake.listen(0, r)); process.env.SEARCH_URL = 'http://127.0.0.1:' + fake.address().port; process.env.SEARCH_API_KEY = 'k-test';
  const app = require('../server'); const { db } = require('../db'); const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
  function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = JSON.parse(await r.text()); } catch (e) {} return { s: r.status, j }; }; }
  const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
  const sa = client(), ad = client();
  await signup(sa, 'consultbanerjee@gmail.com', 'StrongPass123'); await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  let r = await sa('GET', '/api/platform/caselaw/engine'); ok(r.s === 200 && r.j.courts.length === 2 && r.j.drive.connected, 'Super Admin sees the engine');
  ok(!('client_id' in r.j.drive), 'Google client id not passed on');
  ok((await ad('GET', '/api/platform/caselaw/engine')).s === 403, 'a firm admin cannot reach it');
  ok((await ad('POST', '/api/platform/caselaw/engine/run', {})).s === 403, 'a firm admin cannot run it');
  ok((await sa('POST', '/api/platform/caselaw/engine/court', { code: 'CalHC', tier: 'meta' })).s === 200 && posts.pop().body.tier === 'meta', 'court switch passed on');
  ok((await sa('POST', '/api/platform/caselaw/engine/court', { code: '../x', tier: 'full' })).s === 400, 'bad court refused');
  ok((await sa('POST', '/api/platform/caselaw/engine/court', { code: 'CalHC', tier: 'evil' })).s === 400, 'bad tier refused');
  ok((await sa('POST', '/api/platform/caselaw/engine/settings', { auto: true, hour: 3, concurrency: 6, junk: 1 })).s === 200, 'settings saved');
  const p = posts.pop(); ok(p.body.hour === 3 && p.body.concurrency === 6 && !('junk' in p.body), 'only known settings passed on');
  ok((await sa('POST', '/api/platform/caselaw/engine/run', { code: 'SCI' })).s === 200 && posts.pop().body.code === 'SCI', 'run one court');
  ok((await sa('POST', '/api/platform/caselaw/engine/pause', { paused: true })).s === 200 && posts.pop().body.paused === true, 'pause');
  ok((await sa('POST', '/api/platform/caselaw/engine/nuke', {})).s === 404, 'unknown action refused');
  ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'caselaw_engine_%'").get().n >= 4, 'actions recorded in the audit log');
  console.log(`v54: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e); process.exit(1); });
