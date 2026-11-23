'use strict';
// v6.0: time & billing, conflict check, search, pipeline, firm data export, plan limits
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc60-'));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
(async () => {
  const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore');
  const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
  function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; try { j = JSON.parse(await r.text()); } catch (e) { /* not json */ } return { s: r.status, j }; }; }
  const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
  const ad = client(), adv = client(), sa = client(), anon = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123'); await signup(sa, 'consultbanerjee@gmail.com', 'SuperPass123');
  await ad('POST', '/api/users', { name: 'Adv One', email: 'adv1@example.com', role: 'advocate' }); await signup(adv, 'adv1@example.com', 'StrongPass123');
  await ad('PUT', '/api/team/settings', { advocate: ['time', 'allcases', 'clients'] });
  const firmId = db.prepare("SELECT id FROM tenants WHERE kind='firm' ORDER BY id LIMIT 1").get().id;
  let r;

  // ---- data ----
  const mk = async (name, phone) => (await ad('POST', '/api/clients', { name, phone })).j.id;
  const c1 = await mk('Ramesh Kumar Sharma', '98300 11111'), c2 = await mk('Sunita Devi', '9830022222');
  const m1 = (await ad('POST', '/api/matters', { client_id: c1, title: 'Sharma v Gupta Traders', forum: 'City Civil Court', opposite_party: 'Gupta Traders Pvt Ltd' })).j.id;
  const m2 = (await ad('POST', '/api/matters', { client_id: c2, title: 'Sunita Devi v State', forum: 'Calcutta HC', opposite_party: 'State of West Bengal' })).j.id;
  ok(m1 && m2, 'cases created');

  // ---- time: entries, rates, ownership ----
  ok((await anon('GET', '/api/time')).s === 401, 'time needs sign-in');
  r = await ad('PUT', '/api/time/settings', { rate: 2000, round: 6, users: [] }); ok(r.s === 200, 'firm rate set ' + JSON.stringify(r));
  r = await ad('POST', '/api/time', { matter_id: m1, hours: 1.5, narration: 'Conference and drafting', work_date: '2026-11-20' }); ok(r.s === 200, 'entry added: ' + JSON.stringify(r.j));
  const e1 = r.j.id;
  r = await ad('POST', '/api/time', { matter_id: m1, minutes: 30, narration: 'Court visit', work_date: '2026-11-21', rate: 3000 }); const e2 = r.j.id; ok(r.s === 200, 'entry with own rate');
  ok((await ad('POST', '/api/time', { matter_id: m1, minutes: 0, narration: 'x' })).s === 400, 'zero time refused');
  ok((await ad('POST', '/api/time', { matter_id: m1, minutes: 20 })).s === 400, 'narration required');
  r = await ad('GET', '/api/time'); ok(r.j.entries.length === 2 && r.j.totals.minutes === 120, 'list and total minutes');
  ok(r.j.totals.value_paise === 300000 + 150000 && r.j.totals.unbilled_paise === 450000, 'value 1.5h@2000 + 0.5h@3000 = 4500');
  r = await adv('POST', '/api/time', { matter_id: m2, hours: 1, narration: 'Advocate entry' }); ok(r.s === 200, 'advocate can add'); const e3 = r.j.id;
  ok((await adv('GET', '/api/time')).j.entries.length === 1, 'advocate sees only his own time');
  ok((await ad('GET', '/api/time')).j.entries.length === 3, 'admin sees all');
  ok((await adv('DELETE', '/api/time/' + e1)).s === 404, 'cannot remove another person\'s entry');
  ok((await adv('GET', '/api/time/settings')).s === 403, 'rates are admin only');

  // ---- timer ----
  ok((await adv('GET', '/api/time/timer')).j.running === null, 'no timer yet');
  r = await adv('POST', '/api/time/timer/start', { matter_id: m2, narration: 'Reading file' }); ok(r.s === 200 && r.j.running.file_no, 'timer started');
  ok((await adv('POST', '/api/time/timer/start', {})).s === 400, 'only one timer at a time');
  db.prepare("UPDATE time_timers SET started_at=? WHERE user_id=(SELECT id FROM users WHERE email='adv1@example.com')").run(new Date(Date.now() - 25 * 60000).toISOString());
  r = await adv('POST', '/api/time/timer/stop', {}); ok(r.s === 200 && r.j.minutes === 30, 'timer stopped, 25 minutes rounded up to 30 (firm rounds to 6): ' + JSON.stringify(r.j));
  ok((await adv('POST', '/api/time/timer/stop', {})).s === 400, 'stop with nothing running refused');

  // ---- billing ----
  r = await ad('POST', '/api/time/bill', { entry_ids: [e1, e3] }); ok(r.s === 400, 'two clients in one bill refused');
  r = await ad('POST', '/api/time/bill', { entry_ids: [e1, e2] }); ok(r.s === 200 && /INV\/\d+/.test(r.j.inv_no) && r.j.total_paise === 450000, 'billed into one draft invoice: ' + JSON.stringify(r.j));
  const inv = (await ad('GET', '/api/invoices/' + r.j.invoice_id)).j; ok(inv.items.length === 2 && inv.status === 'draft' && inv.client_id === c1 && inv.matter_id === m1, 'invoice holds both lines for the case');
  ok((await ad('POST', '/api/time/bill', { entry_ids: [e1] })).s === 400, 'already billed');
  ok((await ad('PUT', '/api/time/' + e1, { minutes: 10 })).s === 400, 'billed time cannot be edited');
  ok((await ad('GET', '/api/time?billed=unbilled')).j.entries.every((x) => !x.invoice_id), 'unbilled filter');
  r = await ad('GET', '/api/time/report'); ok(r.s === 200 && r.j.by_user.length >= 1 && r.j.by_case.some((x) => /M\//.test(x.name)), 'report by person and case');

  // ---- conflict check ----
  r = await ad('GET', '/api/conflicts?q=Gupta%20Traders'); ok(r.s === 200 && r.j.conflicts === 1 && r.j.hits.some((h) => h.type === 'opposite'), 'opposite party found as a conflict');
  r = await ad('GET', '/api/conflicts?q=Mr.%20Ramesh%20Sharma'); ok(r.j.hits.some((h) => h.type === 'client'), 'same client found despite title and middle name');
  r = await ad('GET', '/api/conflicts?q=Zzyzx%20Holdings'); ok(r.j.clear === true && r.j.hits.length === 0, 'clear when nothing matches');
  r = await ad('GET', '/api/conflicts?phone=%2B91%2098300%2011111'); ok(r.j.hits.some((h) => h.type === 'client'), 'found by phone number');
  ok((await ad('GET', '/api/conflicts?q=ab')).s === 400, 'too short refused');
  ok((await ad('GET', '/api/conflicts/history')).j.length >= 4, 'checks are noted');
  ok((await adv('GET', '/api/conflicts/history')).s === 403, 'history is admin only');

  // ---- search ----
  r = await ad('GET', '/api/gsearch?q=Gupta'); ok(r.j.groups.some((g) => g.key === 'matters'), 'search finds the case by opposite party');
  r = await ad('GET', '/api/gsearch?q=Sunita'); ok(r.j.groups.some((g) => g.key === 'clients') && r.j.groups.some((g) => g.key === 'matters'), 'search finds client and case');
  ok((await ad('GET', '/api/gsearch?q=KC/INV')).j.groups.some((g) => g.key === 'invoices'), 'search finds invoice number');
  ok((await anon('GET', '/api/gsearch?q=Gupta')).s === 401, 'search needs sign-in');
  ok((await ad('GET', '/api/gsearch?q=a')).j.groups.length === 0, 'one letter returns nothing');
  r = await ad('GET', '/api/gsearch?q=%25'); ok(r.s === 200 && r.j.groups.length === 0, 'percent sign is not a wildcard');

  // restricted advocate sees only his cases
  await ad('PUT', '/api/team/settings', { advocate: ['time', 'clients'] });
  r = await adv('GET', '/api/gsearch?q=Gupta'); ok(!r.j.groups.some((g) => g.key === 'matters'), 'restricted advocate cannot find a case he is not on');
  await ad('PUT', '/api/matters/' + m1, { assigned_to: db.prepare("SELECT id FROM users WHERE email='adv1@example.com'").get().id, title: 'Sharma v Gupta Traders' });
  r = await adv('GET', '/api/gsearch?q=Gupta'); ok(r.j.groups.some((g) => g.key === 'matters'), 'after assignment he finds it');
  r = await adv('GET', '/api/conflicts?q=Sunita%20Devi'); const ct = r.j.hits.filter((h) => h.type === 'case-title'); ok(r.s === 200 && ct.length === 1 && !/Sunita/.test(ct[0].title) && !ct[0].link, 'conflict check hides details of cases he is not on');

  // ---- pipeline ----
  r = await ad('GET', '/api/pipeline'); ok(r.s === 200 && r.j.columns.length === 7 && r.j.total === 2, 'pipeline: seven columns, two open cases: ' + JSON.stringify(r.j.columns.map((c) => c.cards.length)));
  ok(r.j.columns[0].cards.length === 2, 'both new cases start in "New"');
  await ad('POST', '/api/matters/' + m1 + '/diary', { kind: 'notice_sent', date: '2026-11-20', title: 'Notice to Gupta' });
  r = await ad('GET', '/api/pipeline'); ok(r.j.columns[2].cards.some((c) => c.id === m1), 'case moves to the Notice column from its diary');
  ok((await ad('GET', '/api/pipeline?who=me')).j.total === 0, 'admin has no cases of his own');

  // ---- export ----
  const ex = await ad('GET', '/api/export/firm', null, true); const buf = Buffer.from(await ex.arrayBuffer());
  ok(ex.status === 200 && /spreadsheetml/.test(ex.headers.get('content-type')) && buf[0] === 0x50 && buf[1] === 0x4b, 'export is an xlsx file');
  const JSZip = require('jszip'), z = await JSZip.loadAsync(buf), names = Object.keys(z.files);
  const wb = await z.file('xl/workbook.xml').async('string'); ok(/Clients/.test(wb) && /Invoices/.test(wb) && /Time/.test(wb) && /Case diary/.test(wb), 'workbook has the main sheets');
  const all = (await Promise.all(names.filter((n) => /worksheets\/sheet\d+\.xml/.test(n)).map((n) => z.file(n).async('string')))).join(' ');
  ok(/Ramesh Kumar Sharma/.test(all) && /Conference and drafting/.test(all), 'workbook holds the firm\'s records');
  ok((await adv('GET', '/api/export/firm')).s === 403 && (await anon('GET', '/api/export/firm')).s === 401, 'export is Admin only');
  ok(db.prepare("SELECT 1 FROM audit_log WHERE action='firm_export'").get(), 'export is audited');

  // ---- limits and modules ----
  r = await sa('GET', '/api/platform/overview'); const f0 = r.j.firms.find((x) => x.id === firmId); ok(f0 && f0.users_n === 2 && f0.clients_n === 2, 'firm list shows usage');
  r = await sa('PUT', `/api/platform/firms/${firmId}/plan`, { max_users: 2, max_clients: 2 }); ok(r.s === 200, 'limits set');
  r = await ad('POST', '/api/users', { name: 'Third', email: 'third@example.com', role: 'staff' }); ok(r.s === 403 && /allows 2 users/.test(r.j.error), 'user limit enforced');
  r = await ad('POST', '/api/clients', { name: 'Third Client' }); ok(r.s === 403 && /allows 2 clients/.test(r.j.error), 'client limit enforced');
  r = await ad('GET', '/api/my-limits'); ok(r.j.max_users === 2 && r.j.used.users === 2, 'firm sees its limits');
  ok((await sa('PUT', `/api/platform/firms/${firmId}/plan`, { max_users: -1 })).s === 400, 'bad limit refused');
  await sa('PUT', `/api/platform/firms/${firmId}/plan`, { max_users: 0, max_clients: 0 });
  ok((await ad('POST', '/api/clients', { name: 'Third Client' })).s === 200, 'limit lifted');
  await sa('PUT', `/api/platform/firms/${firmId}/plan`, { plan: 'starter', apply_preset: true });
  ok((await ad('GET', '/api/time')).s === 403, 'Starter plan has no time module');
  await sa('PUT', `/api/platform/firms/${firmId}/plan`, { plan: 'premium', apply_preset: true });
  ok((await ad('GET', '/api/time')).s === 200, 'Premium has it');
  await ad('PUT', '/api/team/settings', { advocate: [] });
  ok((await adv('GET', '/api/time')).s === 403, 'advocate gated until the Admin opens Time');

  console.log(`v6: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
