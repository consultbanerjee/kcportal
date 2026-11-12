'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcc-')); process.env.PUBLIC_URL = 'https://portal.kclegal.us';
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const AIM = require('../routes/aimail'); const WA = require('../routes/whatsapp'); const C = require('../routes/calendar');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const mails = [], was = [];
AIM.setMailer({ fetch: async () => ({ messages: [], maxUid: 0 }), send: async (c, m) => { mails.push(m); }, verify: async () => ({}) });
WA.setTransport(async (method, url, { body }) => { was.push(JSON.parse(body)); return { status: 200, json: async () => ({ messages: [{ id: 'w' + was.length }] }) }; });
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, form) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (form) b = form; else if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10), md = today.slice(5), dmy = today.slice(8) + '/' + today.slice(5, 7) + '/1985';
(async () => {
  // ---- pure helpers
  const P = C.parseDob;
  ok(JSON.stringify(P('15/08/1980')) === '{"month":8,"day":15,"year":1980}', 'DD/MM/YYYY');
  ok(P('1980-08-15').day === 15 && P('15-Aug-1980').month === 8 && P('15 August').year === null && P('Aug 15, 1980').day === 15, 'other formats');
  ok(P('31/02/1990') === null && P('hello') === null && P('13/13/2000') === null, 'invalid dates refused');
  ok(P('29/02/2000').day === 29, 'leap day kept'); ok(P(29221).year === 1980 && P('29221').month === 1, 'Excel serial');
  const rows = C.parseCsv('﻿Name,Date of Birth,E-mail,Mobile\n"Roy, Amit",15/08/1980,amit@example.com,98300 11111\nSita,xx,,\n');
  const rd = C.readRows(rows); ok(rd.items.length === 1 && rd.items[0].name === 'Roy, Amit' && rd.bad.length === 1 && rd.items[0].phone === '98300 11111', 'CSV with quotes, header detection and bad row report');
  const prov = C.provisional([{ cat: 'state', date: '2026-01-01' }], 2026, 2027); ok(!prov.some((x) => x.cat === 'state' && x.date.startsWith('2026')) && prov.some((x) => x.cat === 'state' && x.date === '2027-01-12') && prov.every((x) => x.prov), 'provisional only where no official list');
  ok(C.saturdays(2027, 2027).length === 24 && C.saturdays(2026, 2026).some((x) => x.date === '2026-01-24' && x.title === 'Fourth Saturday') && C.saturdays(2026, 2026).some((x) => x.date === '2026-05-09'), '2nd/4th Saturdays');

  const admin0 = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin0('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin0('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  const sa0 = client(); { const stk = db.prepare("SELECT invite_token t FROM users WHERE role='superadmin'").get().t; await sa0('POST', '/api/invite/' + stk, { password: 'SuperPass123' }); await sa0('POST', '/api/login', { email: 'consultbanerjee@gmail.com', password: 'SuperPass123' }); }
  const LK = /^\/api\/(whatsapp$|reminders|contacts|calendar\/(settings|refresh)$|storage)/;
  const admin = (m, u, b, f) => (LK.test(u) ? sa0(m, '/api/platform/f/' + t + u.slice(4), b, f) : admin0(m, u, b, f));

  // ---- official data
  let r = await admin('GET', '/api/calendar?from=2026-10-01&to=2026-11-30');
  ok(r.s === 200 && r.j.holidays.length > 20, 'holidays returned: ' + r.j.holidays.length);
  const has = (cat, date, re) => r.j.holidays.some((h) => h.cat === cat && h.date <= date && (h.end_date || h.date) >= date && re.test(h.title));
  ok(has('state', '2026-10-20', /Navami/) && has('hc', '2026-10-20', /Vacation/) && has('sc', '2026-10-20', /Dussehra/) && has('central', '2026-11-08', /Diwali/), 'four categories present for Puja / Diwali');
  ok(has('hc', '2026-11-18', /Jagaddhatri/) && has('state', '2026-11-12', /Bhratridwitiya/) && has('sc', '2026-11-24', /Guru Nanak/), 'November 2026 items');
  r = await admin('GET', '/api/calendar?from=2027-01-01&to=2028-12-31'); ok(r.s === 400, 'range limit');
  r = await admin('GET', '/api/calendar?from=2027-01-01&to=2027-12-31');
  ok(has('central', '2027-03-23', /Holi/) && has('sc', '2027-05-31', /Partial/) && has('sc', '2027-12-25', /Christmas/), '2027 central and SC lists');
  ok(r.j.holidays.some((h) => h.cat === 'state' && h.provisional === 1 && h.date === '2027-01-26') && !r.j.holidays.some((h) => h.cat === 'central' && h.provisional === 1 && h.date.startsWith('2027')), '2027 state provisional, central official');
  r = await admin('GET', '/api/calendar?from=2028-01-01&to=2028-03-01'); ok(r.j.holidays.some((h) => h.cat === 'central' && h.date === '2028-01-26'), '2028 provisional reaches two years ahead');

  // ---- manual add / edit / delete, official delete survives refresh
  r = await admin('POST', '/api/calendar/holidays', { cat: 'firm', date: '2026-12-01', end_date: '2026-12-03', title: 'Office closed', note: 'Annual audit' }); ok(r.s === 201, 'manual add');
  const mid = r.j.id; r = await admin('PUT', '/api/calendar/holidays/' + mid, { cat: 'state', date: '2026-12-02', title: 'Office closed (edited)' }); ok(r.s === 200, 'edit manual');
  r = await admin('POST', '/api/calendar/holidays', { cat: 'state', date: '2026-12-03', end_date: '2026-12-01', title: 'x' }); ok(r.s === 400, 'bad range refused');
  r = await admin('POST', '/api/calendar/holidays', { title: '', date: '2026-12-03' }); ok(r.s === 400, 'title required');
  r = await admin('GET', '/api/calendar?from=2026-12-01&to=2026-12-31'); const off = r.j.holidays.find((h) => h.cat === 'state' && h.date === '2026-12-25');
  ok(off && off.origin === 'data' && (await admin('PUT', '/api/calendar/holidays/' + off.id, { cat: 'state', date: '2026-12-25', title: 'z' })).s === 404, 'official rows cannot be edited');
  ok((await admin('DELETE', '/api/calendar/holidays/' + off.id)).s === 200, 'official row deleted');
  C.setFetch(async () => { throw new Error('offline'); }); r = await admin('POST', '/api/calendar/refresh'); ok(r.s === 200 && r.j.source === 'bundled list' && r.j.count > 100, 'manual refresh (offline → bundled): ' + JSON.stringify(r.j));
  r = await admin('GET', '/api/calendar?from=2026-12-01&to=2026-12-31'); ok(!r.j.holidays.some((h) => h.cat === 'state' && h.date === '2026-12-25') && r.j.holidays.some((h) => h.title === 'Office closed (edited)'), 'deleted entry stays deleted, manual entry kept');
  // online feed: newer version wins; junk feed ignored
  const feed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'holidays.json'), 'utf8')); feed.version = '2026-12-20'; feed.items.push({ cat: 'state', date: '2027-01-14', title: 'Feed holiday' });
  C.setFetch(async () => ({ ok: true, json: async () => feed })); r = await admin('POST', '/api/calendar/refresh'); ok(/online/.test(r.j.source), 'feed used');
  r = await admin('GET', '/api/calendar?from=2027-01-01&to=2027-01-31'); ok(r.j.holidays.some((h) => h.title === 'Feed holiday'), 'feed item present');
  C.setFetch(async () => ({ ok: true, json: async () => ({ items: [{ bad: 1 }] }) })); r = await admin('POST', '/api/calendar/refresh'); ok(/bundled/.test(r.j.source), 'junk feed ignored');
  C.setFetch(async () => { throw new Error('offline'); }); r = await admin('POST', '/api/calendar/refresh'); ok(r.s === 200, 'offline is fine');

  // ---- cases
  const cid = (await admin('POST', '/api/clients', { name: 'Sita Devi', phone: '9830012345', email: 'sita@example.com' })).j.id;
  const mid2 = (await admin('POST', '/api/matters', { client_id: cid, title: 'Sita v State', forum: 'Calcutta High Court', case_no: 'WPA 1/2026' })).j.id;
  const fut = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10), fut2 = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  await admin('POST', `/api/matters/${mid2}/hearings`, { hearing_date: today, purpose: 'Admission', next_date: fut });
  r = await admin('GET', `/api/calendar?from=${today}&to=${fut2}&cases=1`); ok(r.j.cases.some((c) => c.d === fut && c.kind === 'next' && c.title === 'Sita v State' && c.client === 'Sita Devi'), 'next date of the case on the calendar');
  r = await admin('GET', `/api/calendar?from=${today}&to=${fut2}`); ok(r.j.cases.length === 0, 'cases are off unless asked');
  await admin('POST', `/api/matters/${mid2}/hearings`, { hearing_date: fut, purpose: 'Hearing', next_date: fut2 });
  r = await admin('GET', `/api/calendar?from=${today}&to=${fut2}&cases=1`); ok(r.j.cases.some((c) => c.d === fut2) && !r.j.cases.some((c) => c.d === fut && c.kind === 'next'), 'superseded next date is dropped');

  // ---- birthdays: CSV, XLSX, manual
  const JSZip = require('jszip'), z = new JSZip();
  z.file('xl/sharedStrings.xml', '<sst><si><t>Name</t></si><si><t>Birthday</t></si><si><t>Email</t></si><si><t>Phone</t></si><si><t>Rina Sen</t></si><si><t>rina@example.com</t></si></sst>');
  z.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>29221</v></c><c r="C2" t="s"><v>5</v></c><c r="D2"><v>9830099999</v></c></row></sheetData></worksheet>`);
  const xl = await z.generateAsync({ type: 'nodebuffer' }); let fd = new FormData(); fd.append('file', new Blob([xl]), 'birthdays.xlsx');
  r = await admin('POST', '/api/calendar/birthdays/import', null, fd); ok(r.s === 200 && r.j.added === 1, 'xlsx import ' + JSON.stringify(r.j));
  fd = new FormData(); fd.append('file', new Blob([`Name,Birthday,Email,Phone\nSita Devi,${dmy},sita@example.com,9830012345\nToday Person,${dmy},,\nBad,zzz,,\n`]), 'b.csv');
  r = await admin('POST', '/api/calendar/birthdays/import', null, fd); ok(r.s === 200 && r.j.added === 2 && r.j.skipped === 1, 'csv import ' + JSON.stringify(r.j));
  fd = new FormData(); fd.append('file', new Blob(['x']), 'old.xls'); r = await admin('POST', '/api/calendar/birthdays/import', null, fd); ok(r.s === 400 && /xlsx or .csv/.test(r.j.error), '.xls explained');
  r = await admin('POST', '/api/calendar/birthdays/import', { text: `Name\tDOB\nPasted Pat\t${dmy}` }); ok(r.s === 200 && r.j.added === 1, 'pasted list');
  r = await admin('POST', '/api/calendar/birthdays/import', { text: `Name,Birthday\nSita Devi,${dmy}` }); ok(r.j.added === 0 && r.j.updated === 1, 'no duplicates on re-import');
  r = await admin('GET', '/api/calendar/birthdays'); const sita = r.j.find((b) => b.name === 'Sita Devi'); ok(r.j.length === 4 && sita.client_id === cid, 'birthday linked to the client by phone');
  r = await admin('GET', `/api/calendar?from=${today}&to=${today}&bday=1`); ok(r.j.birthdays.length === 3 && r.j.birthdays.find((b) => b.name === 'Sita Devi').age === new Date().getUTCFullYear() - 1985, 'birthdays on the calendar with age');
  r = await admin('GET', `/api/calendar?from=${today}&to=${today}`); ok(r.j.birthdays.length === 0, 'birthdays off unless asked');
  r = await admin('POST', '/api/calendar/birthdays', { name: 'Leap Baby', date: '29/02/2000' }); ok(r.s === 201, 'manual birthday');
  r = await admin('GET', '/api/calendar?from=2027-02-01&to=2027-02-28&bday=1'); ok(r.j.birthdays.some((b) => b.name === 'Leap Baby' && b.date === '2027-02-28'), 'Feb 29 falls on Feb 28 in non-leap years');
  r = await admin('POST', '/api/calendar/birthdays', { name: 'x', date: 'nope' }); ok(r.s === 400, 'bad birthday refused');

  // ---- greetings
  AI.setS(t, 'mail_smtp_host', 'smtp.x'); AI.setS(t, 'mail_smtp_user', 'info@kclegal.us'); AI.setSecret(t, 'mail_smtp_pass', 'pw');
  r = await admin('POST', `/api/calendar/birthdays/${sita.id}/greet`, { email: true, whatsapp: true });
  ok(r.j.email.status === 'sent' && mails.length === 1 && mails[0].to === 'sita@example.com' && /Dear Sita Devi/.test(mails[0].text) && /Happy Birthday, Sita Devi/.test(mails[0].subject), 'e-mail greeting');
  ok(r.j.whatsapp.status === 'opened' && /^https:\/\/wa\.me\/919830012345\?text=/.test(r.j.whatsapp.link), 'WhatsApp opens a wa.me link when the API is off');
  const today2 = await admin('GET', `/api/calendar?from=${today}&to=${today}&bday=1`); ok(today2.j.birthdays.find((b) => b.id === sita.id).sent.includes('email'), 'sent flag shown');
  r = await admin('PUT', '/api/calendar/settings', { auto: true, email: true, wa: true, msg: 'Hi {name}, from {firm}' }); ok(r.j.auto && r.j.msg.startsWith('Hi'), 'settings saved');
  const before = mails.length; let n = await C.runGreetings(t); ok(n === 0 || mails.length === before, 'already greeted today: not repeated (' + n + ')');
  const tp = (await admin('GET', '/api/calendar/birthdays')).j.find((b) => b.name === 'Today Person'); await admin('PUT', '/api/calendar/birthdays/' + tp.id, { name: 'Today Person', date: dmy, email: 'tp@example.com' });
  n = await C.runGreetings(t); ok(mails.length === before + 1 && mails[mails.length - 1].to === 'tp@example.com' && /^Hi Today Person, from /.test(mails[mails.length - 1].text), 'auto greeting sent once: ' + n);
  n = await C.runGreetings(t); ok(mails.length === before + 1, 'and not twice');
  await admin('PUT', '/api/whatsapp', { phone_id: '1', waba: '2', token: 'EAAtok', app_secret: 's', lang: 'en' });
  r = await admin('POST', `/api/calendar/birthdays/${sita.id}/greet`, { whatsapp: true }); ok(r.j.whatsapp.status === 'sent' && was.length >= 1 && was[was.length - 1].template.name === 'kc_birthday', 'WhatsApp API template for linked clients');
  AI.setS(t, 'cal_bday_auto', '0'); const b2 = mails.length; await C.runGreetings(t); ok(mails.length === b2, 'auto off sends nothing');
  r = await admin('DELETE', '/api/calendar/birthdays/' + tp.id); ok(r.s === 200, 'delete birthday');

  // ---- permissions
  const tel = client(); await admin('POST', '/api/users', { name: 'Tel', email: 'tel@example.com', role: 'telecaller' }); const tt = db.prepare("SELECT invite_token t FROM users WHERE email='tel@example.com'").get().t;
  await tel('POST', '/api/invite/' + tt, { password: 'StrongPass123' }); await tel('POST', '/api/login', { email: 'tel@example.com', password: 'StrongPass123' });
  r = await tel('GET', `/api/calendar?from=${today}&to=${fut2}&cases=1&bday=1`); ok(r.s === 403, 'telecaller sees only calling work, not the calendar');
  ok((await tel('POST', '/api/calendar/holidays', { title: 'x', date: today })).s === 403 && [403, 404].includes((await tel('PUT', '/api/calendar/settings', { auto: true })).s) && [403, 404].includes((await tel('POST', '/api/calendar/refresh')).s), 'telecaller cannot edit');
  ok((await client()('GET', '/api/calendar')).s === 401, 'sign-in required');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
