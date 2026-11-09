'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcb-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const B = require('../routes/bankstmt');
const { PDFDocument } = require('pdf-lib');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, form) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (form) b = form; else if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
const wait = async (f, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
let calls = [], failChunk = -1;
AI.setTransport(async (body) => {
  calls.push(body.tools[0].name);
  if (body.tools[0].name === 'save_transactions') {
    if (calls.filter((c) => c === 'save_transactions').length === failChunk) throw new Error('timeout');
    return { content: [{ type: 'tool_use', name: 'save_transactions', input: { transactions: [
      { date: '2026-11-02', narration: 'UPI/CR/312345678901/SITA DEVI/okaxis', ref: '312345678901', debit: 0, credit: 5000 },
      { date: '2026-11-03', narration: 'NEFT-ADV ONE-SALARY', debit: 20000, credit: 0 },
      { date: '2026-11-04', narration: 'UPI/CR/RK TRADERS/ pay', debit: 0, credit: 1180 },
      { date: '2026-11-05', narration: 'BAD ROW', debit: 5, credit: 5 }], unreadable: [{ raw: '06 Nov ??? 4,5', reason: 'smudged' }] } }], usage: {} };
  }
  const m = JSON.parse(body.messages[0].content);
  return { content: [{ type: 'tool_use', name: 'save_matches', input: { matches: m.transactions.map((t) => /RK TRADERS/.test(t.narration) ? { id: t.id, kind: 'client', target_id: m.clients[0].id, confidence: 0.5, party_name: 'RK TRADERS' } : { id: t.id, kind: 'none', confidence: 0.1 }) } }], usage: {} };
});
(async () => {
  const admin = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  await admin('POST', '/api/clients', { name: 'Sita Devi', phone: '9830012345' });
  await admin('POST', '/api/users', { name: 'Adv One', email: 'adv1@example.com', role: 'advocate' }); const uid = db.prepare("SELECT id FROM users WHERE email='adv1@example.com'").get().id;
  const pid = (await admin('POST', '/api/payees', { kind: 'advocate', user_id: uid })).j.id;
  const pdf = await PDFDocument.create(); for (let i = 0; i < 6; i++) pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const send = () => { const f = new FormData(); f.append('file', new Blob([bytes], { type: 'application/pdf' }), 'stmt.pdf'); return admin('POST', '/api/bank/import-pdf', null, f); };
  let r = await send(); ok(r.s === 200 && r.j.import_id, 'PDF accepted');
  const imp = await wait(async () => { const x = (await admin('GET', '/api/bank/imports')).j[0]; return x && x.status === 'done' ? x : null; }); ok(imp && imp.pages_total === 6 && imp.pages_done === 6, 'all 6 pages processed in 2 chunks');
  ok(calls.filter((c) => c === 'save_transactions').length === 2, 'sent in chunks of 4 pages');
  r = await admin('GET', '/api/bank'); const rows = r.j;
  ok(rows.length === 3, 'dedupe across chunks → 3 distinct rows, got ' + rows.length);
  const sita = rows.find((x) => /SITA/.test(x.narration)), adv = rows.find((x) => /ADV ONE/.test(x.narration)), rk = rows.find((x) => /RK TRADERS/.test(x.narration));
  ok(sita.party_kind === 'client' && sita.status === 'suggested' && adv.party_kind === 'payee' && adv.party_id === pid, 'client and payee found automatically');
  ok(rk.status === 'unmatched' && rk.party_name === 'RK TRADERS', 'low-confidence AI guess stays for manual review, name kept');
  r = await admin('GET', '/api/bank/errors'); ok(r.j.length >= 2 && r.j.some((e) => /smudged/.test(e.reason)) && r.j.some((e) => /Both debit and credit/.test(e.reason)), 'unreadable rows kept for correction');
  // fix an error row
  const e1 = r.j.find((e) => /Both debit/.test(e.reason)); r = await admin('POST', `/api/bank/errors/${e1.id}/fix`, { date: '2026-11-05', narration: 'CASH DEP', credit: 5 }); ok(r.s === 200 && r.j.added === 1, 'corrected row added');
  r = await admin('GET', '/api/bank/errors'); ok(!r.j.some((e) => e.id === e1.id), 'corrected row leaves the list');
  // bulk assign with a typed name + remember
  r = await admin('POST', '/api/bank/bulk', { action: 'assign', ids: [rk.id], party_kind: 'other', party_name: 'R K Traders', head: 'Sundry receipts', remember: true, alias: 'RK TRADERS' }); ok(r.j.changed === 1, 'manual name saved');
  r = await admin('PUT', `/api/bank/${rk.id}`, { narration: 'UPI/CR/RK TRADERS/pay (edited)', head: 'Sundry receipts' }); ok(r.s === 200, 'single edit');
  // preserved across "restarts": state is in the DB
  ok(db.prepare("SELECT narration n FROM bank_txns WHERE id=?").get(rk.id).n.includes('edited'), 'edit persisted');
  // confirm in bulk
  r = await admin('POST', '/api/bank/bulk', { action: 'confirm', ids: [sita.id, adv.id, rk.id] }); ok(r.j.confirmed === 3, 'bulk confirm: ' + JSON.stringify(r.j));
  ok(db.prepare('SELECT COUNT(*) n FROM payments WHERE bank_txn_id=?').get(sita.id).n === 1, 'client receipt issued');
  ok(db.prepare('SELECT COUNT(*) n FROM payee_payments WHERE bank_txn_id=? AND status=\'paid\'').get(adv.id).n === 1, 'payee payout recorded');
  r = await admin('PUT', `/api/bank/${adv.id}`, { head: 'x' }); ok(r.s === 400, 'posted entries are locked');
  r = await admin('POST', '/api/bank/bulk', { action: 'reopen', ids: [adv.id, rk.id] }); ok(r.j.changed === 2 && db.prepare('SELECT COUNT(*) n FROM payee_payments WHERE bank_txn_id=?').get(adv.id).n === 0, 'reopen undoes payout');
  // remembered name applies to next import
  db.prepare("INSERT INTO bank_txns(tenant_id,txn_date,narration,credit_paise) SELECT tenant_id,'2026-12-01','UPI/CR/RK TRADERS/again',500 FROM clients LIMIT 1").run();
  const nid = db.prepare("SELECT id,narration FROM bank_txns WHERE narration LIKE '%again'").get(); B.localMatch(1, nid); ok(db.prepare('SELECT party_name p FROM bank_txns WHERE id=?').get(nid.id).p === 'R K Traders', 'remembered name auto-applied');
  // chunk failure leaves a correction item; re-upload fills the gap
  calls = []; failChunk = 2; db.prepare('DELETE FROM bank_txns').run(); db.prepare('DELETE FROM bank_import_errors').run(); r = await send();
  await wait(async () => (await admin('GET', '/api/bank/imports')).j[0].status === 'done'); r = await admin('GET', '/api/bank/errors');
  ok(r.j.some((e) => /Pages 5–6/.test(e.raw) && /upload the same PDF again/.test(e.reason)), 'failed chunk recorded for retry');
  r = await admin('POST', '/api/bank/entry', { date: '2026-11-09', narration: 'Missed line', debit: 100 }); ok(r.j.added === 1, 'manual entry');
  const staff = client(); await admin('POST', '/api/users', { name: 'Stf', email: 'stf@example.com', role: 'staff' }); const st = db.prepare("SELECT invite_token t FROM users WHERE email='stf@example.com'").get().t;
  await staff('POST', '/api/invite/' + st, { password: 'StrongPass123' }); await staff('POST', '/api/login', { email: 'stf@example.com', password: 'StrongPass123' });
  r = await staff('GET', '/api/bank'); ok(r.s === 403, 'staff blocked');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
