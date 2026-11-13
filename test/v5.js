'use strict';
// v5.0: control plane, locks, Super Admin proxy, access control, script gating, journal, weather, two-step sign-in
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc5-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const C = require('../routes/control'); const SH = require('../routes/shield');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx, h: r.headers }; }; }
const signup = async (c, email, pw) => { const row = db.prepare("SELECT invite_token t FROM users WHERE email=?").get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
(async () => {
  const sa = client(), ad = client(), st = client(), anon = client();
  await signup(sa, 'consultbanerjee@gmail.com', 'StrongPass123'); await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  const kc = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  let r = await ad('POST', '/api/users', { name: 'Stf', email: 'stf@example.com', role: 'staff' }); await signup(st, 'stf@example.com', 'StrongPass123');

  // --- script gating ---
  ok((await anon('GET', '/x/views-office.js')).s === 404, 'private script hidden from visitors');
  ok((await ad('GET', '/x/views-office.js')).s === 200 && (await st('GET', '/x/views-billing.js')).s === 200, 'private script served after sign-in');
  ok((await ad('GET', '/x/sa-config.js')).s === 404 && (await st('GET', '/x/sa-core.js')).s === 404, 'Super Admin scripts hidden from firms');
  ok((await sa('GET', '/x/sa-config.js')).s === 200 && (await sa('GET', '/x/views-office.js')).s === 404, 'Super Admin gets only its own scripts');
  ok((await anon('GET', '/views-office.js')).s !== 200 && (await anon('GET', '/sa-core.js')).s !== 200, 'no readable copy in the public folder');
  r = await ad('GET', '/api/bundle'); ok(r.j.files.includes('views-office') && !r.j.files.some((x) => x.startsWith('sa-')), 'bundle list for a firm');
  r = await sa('GET', '/api/bundle'); ok(r.j.files.every((x) => x.startsWith('sa-')) && r.j.files.includes('sa-config') && r.j.files.includes('sa-journal'), 'bundle list for Super Admin');
  ok((await anon('GET', '/api/bundle')).s === 401, 'bundle needs sign-in');
  r = await anon('GET', '/'); ok(!/views-office|sa-config/.test(r.tx) && /noindex/.test(r.tx), 'start page names no private scripts and is noindex');
  r = await anon('GET', '/robots.txt'); ok(/Disallow: \//.test(r.tx), 'robots disallow');
  r = await ad('GET', '/api/me'); ok(r.h.get('cache-control') === 'no-store' && r.h.get('referrer-policy') === 'no-referrer', 'api never cached; security headers');

  // --- locked set-up paths ---
  for (const [m, u] of [['GET', '/api/ai-admin'], ['PUT', '/api/ai-admin'], ['GET', '/api/storage'], ['PUT', '/api/storage'], ['GET', '/api/reminders'], ['PUT', '/api/reminders'], ['GET', '/api/ecourts/config'], ['PUT', '/api/ecourts/config'], ['POST', '/api/ecourts/test'], ['PUT', '/api/whatsapp'], ['PUT', '/api/calendar/settings'], ['POST', '/api/calendar/refresh'], ['PUT', '/api/contacts'], ['POST', '/api/contacts/sync'], ['GET', '/api/args-admin'], ['PUT', '/api/args-admin'], ['POST', '/api/ai-admin/test-ai']]) {
    r = await ad(m, u, m === 'GET' ? undefined : {}); ok(r.s === 404, `firm admin cannot reach ${m} ${u} (${r.s})`);
  }

  // --- Super Admin proxy ---
  const P = '/api/platform/f/' + kc;
  r = await sa('GET', P + '/reminders'); ok(r.s === 200 && 'on' in r.j, 'Super Admin reads firm reminders set-up');
  r = await sa('PUT', P + '/args-admin', { cap: 5, auto: true, research: false }); ok(r.s === 200, 'Super Admin sets case-argument automation');
  r = await sa('GET', P + '/args-admin'); ok(r.s === 200 && r.j.cap === '5' && r.j.research === false, 'automation saved');
  for (const u of ['/clients', '/matters', '/users', '/invoices', '/files', '/dashboard']) { r = await sa('GET', P + u); ok(r.s === 404, 'proxy shows no client data: ' + u); }
  ok((await sa('GET', '/api/clients')).s === 403, 'Super Admin still blocked from firm data');
  ok((await ad('GET', P + '/reminders')).s === 403, 'firm admin cannot use the proxy');
  ok((await sa('GET', '/api/platform/f/99999/reminders')).s === 404, 'unknown firm');
  const au = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='sa_config'").get().n; ok(au >= 1, 'proxy changes are audited');

  // --- services matrix, defaults, access ---
  r = await sa('POST', '/api/platform/firms', { name: 'Second Chambers', prefix: 'SC', admin_name: 'Tara', admin_email: 'tara@test.in' }); const f2 = r.j.id; const t2 = client(); await signup(t2, 'tara@test.in', 'StrongPass123');
  r = await sa('GET', '/api/platform/services'); ok(r.s === 200 && r.j.services.length >= 9 && r.j.firms.length === 2, 'matrix lists services and firms');
  const row = (id) => r.j.services.find((s) => s.id === id);
  ok(row('claude').firms[kc] === true && row('courtdata').firms[kc] === true && row('drafting').firms[kc] === false && row('drafting').firms[f2] === false && row('claude').firms[f2] === false && row('courtdata').firms[f2] === false, 'owner firm keeps its services; a new firm starts with everything off');
  r = await t2('GET', '/api/features'); ok(r.j.drafting === false && r.j.courtdata === false && r.j.email === false && r.j.whatsapp === false && r.j.drive === false, 'new firm sees no running-cost service');
  r = await t2('GET', '/api/ecourts/search?q=x'); ok(r.s === 403 || r.s === 404, 'court search closed for new firm');
  ok((await t2('POST', '/api/ai/draft', {})).s === 403, 'drafting closed for new firm (server side)');
  r = await sa('PUT', '/api/platform/services', { id: 'drafting', firm_id: f2, on: true }); ok(r.s === 200, 'switch one service');
  r = await t2('GET', '/api/features'); ok(r.j.drafting === false, 'drafting still off: Claude master for the firm is off');
  await sa('PUT', '/api/platform/services', { id: 'claude', firm_id: f2, on: true });
  r = await t2('GET', '/api/features'); ok(r.j.drafting === true, 'drafting on once Claude is on for the firm');
  await sa('PUT', '/api/platform/services', { id: 'drafting', on: false }); r = await t2('GET', '/api/features'); ok(r.j.drafting === false, 'platform master switch overrides every firm');
  await sa('PUT', '/api/platform/services', { id: 'drafting', on: true });
  ok((await t2('PUT', '/api/platform/services', { id: 'drafting', on: true })).s === 403, 'a firm cannot flip a service');
  ok((await sa('PUT', '/api/platform/services', { id: 'nonsense', on: true })).s === 400, 'unknown service refused');
  r = await sa('PUT', `/api/platform/firms/${f2}/services`, { services: { drafting: false, email: true } }); ok(r.s === 200, 'bulk switch');

  // staff access inside the firm
  await sa('PUT', '/api/platform/services', { id: 'drafting', firm_id: kc, on: true });
  r = await ad('GET', '/api/access'); ok(r.s === 200 && r.j.services.some((s) => s.id === 'drafting') && r.j.roles.length === 4, 'firm admin sees the access table');
  r = await st('GET', '/api/features'); ok(r.j.drafting === true, 'staff can draft by default');
  const acl = {}; for (const s of (await ad("GET", "/api/access")).j.services) acl[s.id] = s.id === 'drafting' ? ['advocate'] : s.roles;
  ok((await ad('PUT', '/api/access', { acl })).s === 200, 'admin saves who may use what');
  r = await st('GET', '/api/features'); ok(r.j.drafting === false, 'staff no longer see AI drafting');
  r = await st('POST', '/api/ai/draft', {}); ok(r.s === 403, 'staff are refused by the server too');
  r = await ad('GET', '/api/features'); ok(r.j.drafting === true, 'the administrator always can');
  ok((await st('PUT', '/api/access', { acl })).s === 403, 'staff cannot change access');
  ok((await sa('GET', '/api/access')).s === 403, 'access screen is the firm administrator\'s');

  // --- journal ---
  r = await sa('GET', '/api/platform/journal'); ok(r.s === 200 && r.j.version === '5.3.0' && r.j.modules.length > 10 && r.j.security.length > 3 && r.j.live.firms === 2, 'journal data');
  ok((await ad('GET', '/api/platform/journal')).s === 403, 'journal is owner only');
  r = await sa('POST', '/api/platform/journal/notes', { title: 'Test note', body: 'Decided X' }); ok(r.s === 200, 'note added');
  r = await sa('POST', '/api/platform/journal/cost', { name: 'Test host', kind: 'fixed', amount: 1200, cycle: 'yearly', notes: 'n' }); ok(r.s === 200, 'cost item added');
  r = await sa('GET', '/api/platform/journal'); ok(r.j.notes.length === 1 && r.j.cost.some((c) => c.name === 'Test host' && c.per_month_paise === 10000), 'yearly cost shown per month');
  for (const f of ['docx', 'pdf']) { const x = await sa('GET', '/api/platform/journal/download/' + f, null, true); const b = Buffer.from(await x.arrayBuffer()); ok(x.status === 200 && b.length > 3000 && (f === 'pdf' ? b.slice(0, 4).toString() === '%PDF' : b.slice(0, 2).toString() === 'PK'), 'journal ' + f); }
  ok((await sa('POST', '/api/platform/journal/cost', { name: '', amount: 1 })).s === 400, 'cost needs a name');
  await sa('DELETE', '/api/platform/journal/notes/' + r.j.notes[0].id); r = await sa('GET', '/api/platform/journal'); ok(r.j.notes.length === 0, 'note deleted');

  // --- weather ---
  let wcalls = 0; C.setWeatherTransport(async (url) => { wcalls++; if (/geocoding/.test(url)) return { results: [{ name: 'Mumbai', latitude: 19.07, longitude: 72.87 }] };
    return { current: { temperature_2m: 31.4, apparent_temperature: 35, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 9, is_day: 1 }, daily: { temperature_2m_max: [33], temperature_2m_min: [26] } }; });
  r = await ad('GET', '/api/weather'); ok(r.s === 200 && r.j.city === 'Kolkata' && r.j.temp === 31 && r.j.text === 'Partly cloudy' && r.j.hi === 33, 'weather for the firm city');
  await ad('GET', '/api/weather'); ok(wcalls === 1, 'weather is cached');
  r = await sa('PUT', P + '/wx', { city: 'Mumbai' }); ok(r.s === 200 && r.j.city === 'Mumbai', 'Super Admin sets the city');
  r = await ad('GET', '/api/weather'); ok(r.j.city === 'Mumbai', 'firm sees the new city');
  ok((await ad('PUT', P + '/wx', { city: 'Delhi' })).s === 403, 'firm cannot set the city');
  C.setWeatherTransport(async () => { throw new Error('down'); }); r = await st('GET', '/api/weather'); ok(r.s === 200, 'weather outage does not break the page');
  ok((await anon('GET', '/api/weather')).s === 401, 'weather needs sign-in');

  // --- two-step sign-in ---
  r = await ad('POST', '/api/2fa/start'); ok(r.s === 200 && r.j.secret && /^data:image/.test(r.j.qr), 'two-step starts');
  const secret = r.j.secret.replace(/ /g, '');
  ok((await ad('POST', '/api/2fa/enable', { code: '000000' })).s === 400, 'wrong code refused');
  const code = () => SH.hotp(secret, Math.floor(Date.now() / 30000));
  ok((await ad('POST', '/api/2fa/enable', { code: code() })).s === 200, 'two-step enabled');
  const ad2 = client(); r = await ad2('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' }); ok(r.s === 401 && r.j.need_code, 'password alone is not enough');
  r = await ad2('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123', code: '123456' }); ok(r.s === 401, 'wrong code refused at sign-in');
  r = await ad2('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123', code: code() }); ok(r.s === 200, 'right code signs in');
  r = await ad2('POST', '/api/2fa/disable', { password: 'StrongPass123', code: code() }); ok(r.s === 200, 'two-step can be turned off');
  r = await client()('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' }); ok(r.s === 200, 'back to password only');

  console.log(`v5: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
