'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kci-')); process.env.PUBLIC_URL = 'https://portal.kclegal.us';
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const AIM = require('../routes/aimail'); const WA = require('../routes/whatsapp'); const IS = require('../routes/invsend');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const mails = [], was = [];
AIM.setMailer({ fetch: async () => ({ messages: [], maxUid: 0 }), send: async (c, m) => { mails.push(m); }, verify: async () => ({}) });
WA.setTransport(async (method, url, { body }) => { was.push(JSON.parse(body)); return { status: 200, json: async () => ({ messages: [{ id: 'w' + was.length }] }) }; });
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
(async () => {
  ok(IS.addPeriod('2026-01-31', 1, 'month') === '2026-02-28' && IS.addPeriod('2026-11-10', 1, 'quarter') === '2027-02-10' && IS.addPeriod('2026-11-10', 1, 'week') === '2026-11-17' && IS.addPeriod('2028-02-29', 1, 'year') === '2029-02-28', 'date arithmetic');
  const admin0 = client(), anon = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin0('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin0('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  const sa0 = client(); { const stk = db.prepare("SELECT invite_token t FROM users WHERE role='superadmin'").get().t; await sa0('POST', '/api/invite/' + stk, { password: 'SuperPass123' }); await sa0('POST', '/api/login', { email: 'consultbanerjee@gmail.com', password: 'SuperPass123' }); }
  const LK = /^\/api\/(whatsapp$|reminders|contacts|calendar\/(settings|refresh)$|storage)/;
  const admin = (m, u, b, f) => (LK.test(u) ? sa0(m, '/api/platform/f/' + t + u.slice(4), b, f) : admin0(m, u, b, f));
  const cid = (await admin('POST', '/api/clients', { name: 'Sita Devi', phone: '9830012345', email: 'sita@example.com' })).j.id;
  let r = await admin('POST', '/api/invoices', { client_id: cid, subject: 'Lease', items: [{ description: 'Deed\nDrafting', qty: 2, rate: 5000 }], notes: 'n1' }); const inv = r.j.id;
  // send needs a mailbox
  r = await admin('POST', `/api/invoices/${inv}/send`, { email: true }); ok(r.s === 200 && r.j.failed.length === 1 && /not set up/.test(r.j.failed[0]), 'e-mail refused without mailbox');
  ok(db.prepare('SELECT status FROM invoices WHERE id=?').get(inv).status === 'sent', 'sending issues a draft');
  AI.setS(t, 'mail_smtp_host', 'smtp.x'); AI.setS(t, 'mail_smtp_user', 'info@kclegal.us'); AI.setSecret(t, 'mail_smtp_pass', 'pw');
  r = await admin('POST', `/api/invoices/${inv}/send`, { email: true, message: 'Thanks' }); ok(r.j.sent[0] === 'email', 'email sent');
  const ml = mails[mails.length - 1]; const link = (ml.text.match(/https:\/\/portal\.kclegal\.us\/#\/inv\/([a-f0-9]+)/) || [])[1];
  ok(ml.to === 'sita@example.com' && link && /10,000.00/.test(ml.subject) && /Thanks/.test(ml.text), 'mail has link, amount, note');
  r = await anon('GET', '/api/public/invoice/' + link); ok(r.s === 200 && r.j.invoice.inv_no && r.j.invoice.items.length === 1 && !r.j.invoice.share_token && r.j.tpl.settings, 'public view works without login and hides internals');
  r = await anon('GET', '/api/public/invoice/deadbeef'); ok(r.s === 404, 'bad link 404');
  // whatsapp without API -> chat link
  r = await admin('POST', `/api/invoices/${inv}/send`, { whatsapp: true }); ok(r.s === 200 && /^https:\/\/wa\.me\/919830012345\?text=/.test(r.j.wa_link) && decodeURIComponent(r.j.wa_link).includes('/#/inv/' + link), 'whatsapp link (no API)');
  await admin('PUT', '/api/whatsapp', { phone_id: '1', waba: '2', token: 'EAAtok', app_secret: 's', lang: 'en' });
  r = await admin('POST', `/api/invoices/${inv}/send`, { whatsapp: true }); ok(r.j.sent[0] === 'whatsapp' && was.length === 1 && was[0].template.components[0].parameters[3].text.includes('/#/inv/' + link), 'whatsapp API template');
  r = await admin('GET', `/api/invoices/${inv}/send-info`); ok(r.j.email === 'sita@example.com' && r.j.log.length >= 3, 'send info + log');
  // cancelled cannot be sent and public link stops
  const i2 = (await admin('POST', '/api/invoices', { client_id: cid, items: [{ description: 'x', qty: 1, rate: 100 }] })).j.id;
  await admin('POST', `/api/invoices/${i2}/send`, { email: true }); await admin('POST', `/api/invoices/${i2}/cancel`);
  r = await admin('POST', `/api/invoices/${i2}/send`, { email: true }); ok(r.s === 409, 'cancelled invoice not sent');
  // recurring
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  r = await admin('POST', '/api/recurring', { client_id: cid, name: 'Retainer', subject: 'Monthly retainer', items: [{ description: 'Retainer', qty: 1, rate: 20000 }], every_n: 1, unit: 'month', next_date: today, auto_send: true, send_email: true, due_days: 7 }); ok(r.s === 200, 'recurring created'); const rid = r.j.id;
  r = await admin('POST', '/api/recurring', { client_id: cid, items: [], next_date: today }); ok(r.s === 400, 'needs items');
  const before = mails.length; r = await IS.runDue(t, today); ok(r.made === 1 && r.sent === 1 && mails.length === before + 1, 'due profile created + emailed: ' + JSON.stringify(r));
  const gen = db.prepare('SELECT * FROM invoices WHERE recurring_id=?').all(rid); ok(gen.length === 1 && gen[0].status === 'sent' && gen[0].total_paise === 2000000 && gen[0].due_date === IS.addPeriod(today, 7, 'day') && gen[0].subject === 'Monthly retainer', 'generated invoice correct');
  const p = db.prepare('SELECT * FROM recurring_invoices WHERE id=?').get(rid); ok(p.next_date === IS.addPeriod(today, 1, 'month') && p.runs === 1, 'next date advanced');
  r = await IS.runDue(t, today); ok(r.made === 0, 'not run twice');
  await admin('POST', `/api/recurring/${rid}/toggle`); db.prepare('UPDATE recurring_invoices SET next_date=? WHERE id=?').run(today, rid); r = await IS.runDue(t, today); ok(r.made === 0, 'paused profile skipped');
  await admin('POST', `/api/recurring/${rid}/toggle`);
  // draft-for-review profile
  const r2 = (await admin('POST', '/api/recurring', { client_id: cid, items: [{ description: 'Audit', qty: 1, rate: 500 }], every_n: 1, unit: 'week', next_date: today, end_date: today })).j.id;
  r = await IS.runDue(t, today); ok(r.made === 2, 'both ran'); const g2 = db.prepare('SELECT status FROM invoices WHERE recurring_id=?').get(r2); ok(g2.status === 'draft', 'draft kept for review when not auto-send');
  ok(db.prepare('SELECT status FROM recurring_invoices WHERE id=?').get(r2).status === 'ended', 'profile ends after end date');
  r = await admin('POST', `/api/recurring/${rid}/run`); ok(r.s === 200 && r.j.inv_no, 'create-now works');
  r = await admin('GET', '/api/recurring'); ok(r.j.length === 2 && r.j[0].items.length === 1 && r.j[0].client_name === 'Sita Devi', 'list');
  const staff = client(); await admin('POST', '/api/users', { name: 'Stf', email: 'stf@example.com', role: 'staff' }); const st = db.prepare("SELECT invite_token t FROM users WHERE email='stf@example.com'").get().t;
  await staff('POST', '/api/invite/' + st, { password: 'StrongPass123' }); await staff('POST', '/api/login', { email: 'stf@example.com', password: 'StrongPass123' });
  r = await staff('POST', `/api/invoices/${inv}/send`, { email: true }); ok(r.s === 403, 'staff cannot send'); r = await staff('GET', '/api/recurring'); ok(r.s === 403, 'staff cannot see recurring');
  r = await admin('DELETE', `/api/recurring/${r2}`); ok(r.s === 200, 'delete');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
