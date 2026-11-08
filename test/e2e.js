'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kct-'));
process.env.WEBHOOK_SECRET = 'whsec';
const app = require('../server');
const { db } = require('../db');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const srv = app.listen(0);
const base = 'http://127.0.0.1:' + srv.address().port;
function client() {
  let cookie = '';
  return async (method, url, body, raw) => {
    const h = { 'X-Requested-With': 'kcportal', cookie };
    let b = body;
    if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers: h, body: b });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    if (raw) return r;
    let j = null; try { j = await r.json(); } catch (e) {}
    return { s: r.status, j };
  };
}
async function setup(c, invite, pw) { const tok = invite.split('/').pop(); return c('POST', '/api/invite/' + tok, { password: pw }); }

(async () => {
  const admin = client();
  const tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin'").get().t;
  let r = await admin('POST', '/api/invite/' + tok, { password: 'short' }); ok(r.s === 400, 'weak password rejected');
  r = await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); ok(r.s === 200, 'admin password set: ' + JSON.stringify(r.j));
  r = await admin('POST', '/api/login', { email: 'consultbanerjee@gmail.com', password: 'StrongPass123' }); ok(r.s === 200, 'admin login');
  r = await admin('GET', '/api/me'); ok(r.j && r.j.user && r.j.user.role === 'admin', 'me');
  const nohdr = await fetch(base + '/api/matters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); ok(nohdr.status === 403, 'csrf guard');

  // staff users
  const mk = async (role, email) => { const x = await admin('POST', '/api/users', { name: role + ' user', email, role }); ok(x.s === 200, 'create ' + role + JSON.stringify(x.j)); const c = client(); const s = await setup(c, x.j.invite_path, 'Passw0rdPass1'); ok(s.s === 200, 'invite ' + role); await c('POST', '/api/login', { email, password: 'Passw0rdPass1' }); return c; };
  const adv = await mk('advocate', 'adv@x.com'), staff = await mk('staff', 'staff@x.com'), tele = await mk('telecaller', 'tele@x.com'), acct = await mk('accounts', 'acct@x.com');
  r = await staff('POST', '/api/users', { name: 'x', email: 'x@x.com', role: 'staff' }); ok(r.s === 403, 'staff cannot create users');
  r = await tele('GET', '/api/invoices'); ok(r.s === 403, 'telecaller blocked from invoices');

  // clients & matters
  r = await staff('POST', '/api/clients', { name: 'Ramesh Kumar Sharma', email: 'ramesh@c.com', phone: '9830012345' }); ok(r.s === 200, 'client created'); const cid = r.j.id;
  r = await staff('POST', '/api/clients', { name: 'Other Person', email: 'o@c.com', phone: '9000000001' }); const cid2 = r.j.id;
  r = await staff('POST', '/api/matters', { client_id: cid, title: 'Ramesh v. State Bank', forum: 'Calcutta High Court', case_no: 'WPA 123/2026' }); ok(r.s === 200 && /^KC\/M\/\d{4}\/\d{4}$/.test(r.j.file_no), 'matter ' + JSON.stringify(r.j)); const mid = r.j.id;
  r = await staff('POST', '/api/matters', { client_id: cid2, title: 'Other matter' }); const mid2 = r.j.id;
  r = await staff('POST', `/api/matters/${mid}/hearings`, { hearing_date: '2026-11-01', purpose: 'Admission', outcome: 'Adjourned', next_date: '2099-01-10' }); ok(r.s === 200, 'hearing');
  r = await adv('GET', '/api/dates?days=99999'); ok(r.s === 200 && r.j.length === 1, 'cause list');
  r = await tele('POST', '/api/matters', { client_id: cid, title: 'x' }); ok(r.s === 403, 'telecaller cannot create matter');

  // documents + client portal
  const fd = new FormData(); fd.append('matter_id', mid); fd.append('client_visible', '1'); fd.append('file', new Blob(['hello pdf']), 'notice.pdf');
  r = await staff('POST', '/api/documents', fd); ok(r.s === 200, 'office upload ' + JSON.stringify(r.j)); const did = r.j.id;
  const fd2 = new FormData(); fd2.append('matter_id', mid); fd2.append('file', new Blob(['secret']), 'internal.pdf');
  r = await staff('POST', '/api/documents', fd2); const hidden = r.j.id;
  const fd3 = new FormData(); fd3.append('matter_id', mid); fd3.append('file', new Blob(['x']), 'evil.exe');
  r = await staff('POST', '/api/documents', fd3); ok(r.s === 400, 'exe rejected');

  r = await staff('POST', `/api/clients/${cid}/login`, {}); ok(r.s === 200, 'client login invite');
  const cl = client(); await setup(cl, r.j.invite_path, 'ClientPass123'); r = await cl('POST', '/api/login', { email: 'ramesh@c.com', password: 'ClientPass123' }); ok(r.s === 200, 'client login');
  r = await cl('GET', '/api/matters'); ok(r.j.length === 1 && r.j[0].id === mid, 'client sees only own matter');
  r = await cl('GET', '/api/matters/' + mid2); ok(r.s === 404, 'client cannot open other matter');
  r = await cl('GET', '/api/matters/' + mid); ok(r.j.documents.length === 1 && !r.j.notings && !r.j.opposite_party, 'client view hides internal data');
  r = await cl('GET', `/api/documents/${did}/download`, null, true); ok(r.status === 200, 'client downloads visible doc');
  r = await cl('GET', `/api/documents/${hidden}/download`, null, true); ok(r.status === 404, 'client cannot download hidden doc');
  r = await cl('GET', '/api/users'); ok(r.s === 403, 'client blocked from users');
  r = await cl('DELETE', '/api/documents/' + did); ok(r.s === 403, 'client cannot delete');
  r = await cl('PATCH', '/api/documents/' + did, { client_visible: 0 }); ok(r.s === 403, 'client cannot alter');
  const fd4 = new FormData(); fd4.append('matter_id', mid); fd4.append('file', new Blob(['id proof']), 'aadhaar.pdf');
  r = await cl('POST', '/api/documents', fd4); ok(r.s === 200, 'client uploads to own matter');
  const fd5 = new FormData(); fd5.append('matter_id', mid2); fd5.append('file', new Blob(['x']), 'a.pdf');
  r = await cl('POST', '/api/documents', fd5); ok(r.s === 403, 'client cannot upload to other matter');

  // letters
  r = await staff('POST', '/api/letters', { matter_id: mid, to_name: 'Bank Manager', subject: 'Notice', body: 'Dear Sir…', client_visible: true }); const lid = r.j.id;
  r = await cl('GET', '/api/letters'); ok(r.j.length === 0, 'draft hidden from client');
  r = await staff('POST', `/api/letters/${lid}/send`); ok(r.s === 403, 'staff cannot send');
  r = await adv('POST', `/api/letters/${lid}/send`); ok(r.s === 200 && /KC\/OUT\/0001/.test(r.j.ref_no), 'advocate sends: ' + JSON.stringify(r.j));
  r = await cl('GET', '/api/letters'); ok(r.j.length === 1, 'sent letter visible to client');
  r = await cl('GET', '/api/letters/' + lid); ok(r.s === 200, 'client reads letter');
  r = await adv('GET', '/api/letters/' + lid); ok(!!r.j.read_at, 'read receipt recorded');
  r = await staff('POST', '/api/dak', { from_name: 'Calcutta HC', subject: 'Notice of hearing' }); ok(/KC\/IN\/0001/.test(r.j.ref_no), 'dak number');

  // tasks
  r = await adv('POST', '/api/tasks', { title: 'Draft reply', assigned_to: db.prepare("SELECT id FROM users WHERE email='staff@x.com'").get().id, due_date: '2020-01-01', matter_id: mid }); ok(r.s === 200, 'task assigned'); const tid = r.j.id;
  r = await staff('GET', '/api/tasks?view=mine'); ok(r.j.length === 1, 'staff sees task');
  r = await tele('PATCH', '/api/tasks/' + tid, { status: 'done' }); ok(r.s === 403, 'others cannot change task');
  r = await staff('PATCH', '/api/tasks/' + tid, { status: 'done', note: 'sent' }); ok(r.s === 200, 'assignee completes');

  // messages
  r = await cl('POST', '/api/messages', { body: 'When is next date?' }); ok(r.s === 200, 'client message');
  r = await staff('GET', '/api/messages'); ok(r.j[0].unread === 1, 'unread count');
  r = await staff('POST', '/api/messages', { client_id: cid, body: '10 Jan 2099' }); ok(r.s === 200, 'reply');
  r = await cl('GET', '/api/dashboard'); ok(r.j.matters === 1 && r.j.next_dates.length === 1, 'client dashboard ' + JSON.stringify(r.j));

  // CRM
  r = await tele('POST', '/api/leads', { name: 'Lead One', phone: '9831111111', issue: 'Cheque bounce' }); ok(r.s === 200, 'lead'); const lead = r.j.id;
  r = await tele('POST', `/api/leads/${lead}/notes`, { outcome: 'no_answer', note: 'call later', callback_at: '2099-01-01T10:00' }); ok(r.s === 200, 'lead note');
  r = await tele('POST', `/api/leads/${lead}/convert`); ok(r.s === 403, 'telecaller cannot convert');
  r = await staff('POST', `/api/leads/${lead}/convert`); ok(r.s === 200 && r.j.client_id, 'convert');

  // appointments
  r = await admin('PUT', '/api/availability', { slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, start_time: '10:00', end_time: '13:00' })) }); ok(r.s === 200, 'availability');
  const pub = client();
  r = await pub('GET', '/api/public/booking'); const types = r.j.types; ok(types.length === 2, 'public types');
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  r = await pub('GET', `/api/public/slots?type=${types[0].id}&date=${day}`); ok(r.j.length === 9, 'slots 3h/20m = 9, got ' + r.j.length);
  const slot = r.j[0];
  const advId = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
  r = await admin('PUT', '/api/consult-fees', { user_id: advId, consult_type_id: types[0].id, fee: 777 }); ok(r.s === 200, 'set advocate fee');
  r = await staff('PUT', '/api/consult-fees', { user_id: advId, consult_type_id: types[0].id, fee: 1 }); ok(r.s === 403, 'staff cannot set fees');
  r = await pub('GET', '/api/public/booking'); ok(r.j.advocates.some((a) => a.id === advId && a.fees[types[0].id] === 77700), 'advocate fee shown');
  r = await pub('GET', `/api/public/slots?type=${types[0].id}&date=${day}&advocate=${advId}`); ok(r.j[0].fee_paise === 77700, 'slot carries advocate fee');
  r = await pub('POST', '/api/public/book', { name: 'Walk In', phone: '9876543210', email: 'walk@in.com', issue: 'Divorce', type_id: types[0].id, advocate_id: advId, start_at: slot.start_at }); ok(r.s === 200 && r.j.pay_ref && r.j.fee_paise === 77700, 'book at advocate fee'); const ref = r.j.pay_ref; const apId = r.j.id;
  r = await pub('GET', `/api/public/slots?type=${types[0].id}&date=${day}`); ok(r.j.length === 8, 'held slot removed');
  r = await pub('POST', '/api/public/book', { name: 'Late', phone: '9876543211', email: 'l@in.com', type_id: types[0].id, start_at: slot.start_at }); ok(r.s === 400, 'double booking blocked');
  r = await pub('GET', '/api/public/booking/' + ref); ok(r.j.status === 'awaiting_payment' && !r.j.meet_link, 'no link before payment');
  r = await pub('POST', '/api/payments/webhook', { pay_ref: ref, status: 'paid', amount_paise: types[0].fee_paise }); ok(r.s === 401, 'webhook needs secret');
  const wh = await fetch(base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'whsec' }, body: JSON.stringify({ pay_ref: ref, status: 'paid', amount_paise: 100, txn_id: 't1' }) }); 
  r = await pub('GET', '/api/public/booking/' + ref); ok(r.j.status === 'awaiting_payment', 'short payment ignored');
  await fetch(base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'whsec' }, body: JSON.stringify({ pay_ref: ref, status: 'paid', amount_paise: 77700, txn_id: 't2' }) });
  r = await pub('GET', '/api/public/booking/' + ref); ok(r.j.status === 'confirmed' && /meet\.jit\.si/.test(r.j.meet_link), 'confirmed after payment');
  r = await acct('GET', '/api/payments'); ok(r.j.some((p) => p.reference === 't2'), 'consult payment recorded');

  // billing
  r = await acct('POST', '/api/invoices', { client_id: cid, matter_id: mid, items: [{ description: 'Professional fee', qty: 1, rate: 25000 }, { description: 'Drafting', qty: 2, rate: 2500 }] }); ok(r.s === 200 && r.j.total_paise === 3000000, 'invoice total ' + JSON.stringify(r.j)); const inv = r.j.id;
  r = await cl('GET', '/api/invoices'); ok(r.j.length === 0, 'draft invoice hidden');
  r = await acct('POST', `/api/invoices/${inv}/issue`); ok(r.s === 200, 'issue');
  r = await cl('GET', '/api/invoices'); ok(r.j.length === 1, 'issued visible');
  r = await acct('POST', '/api/payments', { client_id: cid, invoice_id: inv, amount: 10000, mode: 'cash' }); ok(r.s === 200 && /RCT/.test(r.j.rec_no), 'part payment');
  r = await acct('GET', '/api/invoices/' + inv); ok(r.j.status === 'part_paid' && r.j.paid_paise === 1000000, 'part_paid');
  r = await acct('GET', '/api/cash'); ok(r.j.closing_paise === 1000000, 'cash book auto-entry');
  await acct('POST', '/api/cash', { kind: 'out', amount: 500, head: 'Stationery' });
  r = await acct('GET', '/api/cash'); ok(r.j.closing_paise === 950000, 'cash out');
  const csv = 'Date,Narration,Chq/Ref No,Withdrawal Amt.,Deposit Amt.,Closing Balance\n05/11/2026,"UPI/RAMESH KUMAR SHARMA/9830012345",UTR111,,20000.00,120000.00\n06/11/2026,ELECTRICITY BILL,UTR112,1800.50,,118199.50\n07/11/2026,NEFT UNKNOWN PERSON,UTR113,,500.00,118699.50\n';
  r = await acct('POST', '/api/bank/import', { csv }); ok(r.j.added === 3, 'bank import ' + JSON.stringify(r.j));
  r = await acct('POST', '/api/bank/import', { csv }); ok(r.j.added === 0 && r.j.duplicates === 3, 'dup protection');
  r = await acct('GET', '/api/bank'); const sug = r.j.find((b) => b.ref === 'UTR111'); ok(sug.status === 'suggested' && sug.matched_client_id === cid, 'auto-suggest client');
  r = await acct('POST', `/api/bank/${sug.id}/match`, { invoice_id: inv }); ok(r.s === 200, 'match ' + JSON.stringify(r.j));
  r = await acct('GET', '/api/invoices/' + inv); ok(r.j.status === 'paid', 'invoice fully paid (30000 = 10000 + 20000)');
  r = await acct('POST', `/api/bank/${sug.id}/match`, {}); ok(r.s === 400, 'no double match');
  r = await acct('GET', `/api/reports/ledger?client_id=${cid}`); ok(r.j.balance_paise === 0, 'ledger balance 0, got ' + (r.j && r.j.balance_paise));
  r = await acct('GET', '/api/reports/final?from=2026-01-01'); ok(r.s === 200 && r.j.total_income_paise > 0 && r.j.expenses.length, 'final accounts');
  r = await staff('GET', '/api/reports/final'); ok(r.s === 403, 'staff blocked from accounts');

  // judgments
  r = await adv('POST', '/api/judgments', { court: 'Supreme Court', title: 'ABC v. XYZ', case_no: 'CA 1/2020', summary: 'Held that arbitration clause survives novation', subject: 'Arbitration', decided_on: '2020-05-05' }); ok(r.s === 200, 'judgment add');
  r = await adv('GET', '/api/judgments?q=arbitrat'); ok(r.j.length === 1 && /arbitrat/i.test(r.j[0].snippet), 'FTS prefix search');
  r = await adv('GET', '/api/judgments?q=%22%29%20OR%20' ); ok(r.s === 200, 'FTS injection safe');
  r = await cl('GET', '/api/judgments'); ok(r.s === 403, 'client blocked from judgments');

  // isolation: lockout
  const bad = client(); for (let i = 0; i < 5; i++) await bad('POST', '/api/login', { email: 'staff@x.com', password: 'wrong' });
  r = await bad('POST', '/api/login', { email: 'staff@x.com', password: 'Passw0rdPass1' }); ok(r.s === 429, 'lockout after 5 fails (got ' + r.s + ')');
  r = await admin('GET', '/api/audit'); ok(r.s === 200 && r.j.length > 10, 'audit trail');

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
