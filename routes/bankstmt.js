'use strict';
// Bank statement handling: PDF/CSV import, AI reading + sorting by client / payee, bulk and single edits,
// "needs correction" rows kept until fixed, and remembered name rules. Everything is stored in the database
// as it is entered, so unfinished work is still there, in the same state, the next time the portal is opened.
const fs = require('fs'), path = require('path');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;
const BILL = L.need('admin', 'advocate', 'accounts');
const ACC = L.need('admin', 'accounts');
const CHUNK = 4;                       // pages sent to the AI at a time
const tmpDir = () => { const d = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'bank-tmp'); fs.mkdirSync(d, { recursive: true }); return d; };
const STOP = new Set(['MRS', 'MR', 'MS', 'DR', 'SHRI', 'SMT', 'MESSRS', 'LTD', 'PVT', 'LIMITED', 'PRIVATE', 'THE', 'AND', 'SRI']);
const words = (n) => String(n || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));

// ---- local matching: remembered rules, then client / payee names, phone numbers and UPI IDs ----
function localMatch(tid, t) {
  const narr = String(t.narration || '').toUpperCase(); if (!narr) return;
  const set = (kind, id, name, conf) => { db.prepare("UPDATE bank_txns SET party_kind=?, party_id=?, party_name=?, matched_client_id=?, conf=?, status='suggested', by_ai=0 WHERE id=? AND status='unmatched'").run(kind, id, name, kind === 'client' ? id : null, conf, t.id); return true; };
  for (const r of db.prepare('SELECT * FROM bank_rules WHERE tenant_id=? ORDER BY length(alias) DESC').all(tid)) if (narr.includes(r.alias)) {
    if (r.head) db.prepare('UPDATE bank_txns SET head=? WHERE id=?').run(r.head, t.id);
    if (set(r.party_kind, r.party_id, r.party_name, 1)) return;
  }
  const hit = (list, kind) => list.filter((c) => { const w = words(c.name), ph = String(c.phone || '').replace(/\D/g, '');
    return ((w.length >= 2 || (w.length === 1 && w[0].length >= 4)) && w.every((x) => new RegExp('(^|[^A-Z0-9])' + x + '([^A-Z0-9]|$)').test(narr))) || (ph.length >= 10 && narr.includes(ph.slice(-10))) || (c.upi_id && narr.includes(String(c.upi_id).toUpperCase())); }).map((c) => ({ ...c, kind }));
  const all = [...hit(db.prepare('SELECT id,name,phone FROM clients WHERE tenant_id=?').all(tid), 'client'), ...hit(db.prepare('SELECT id,name,phone,upi_id FROM payees WHERE tenant_id=? AND active=1').all(tid), 'payee')];
  if (all.length === 1) set(all[0].kind, all[0].id, all[0].name, 0.9);
}

// ---- AI helpers ----
const TXN_TOOL = { name: 'save_transactions', description: 'Save the transactions read from the bank statement pages.', input_schema: { type: 'object', properties: {
  transactions: { type: 'array', items: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, narration: { type: 'string' }, ref: { type: 'string', description: 'cheque no. / UTR / reference if shown' },
    debit: { type: 'number', description: 'money out in rupees, 0 if none' }, credit: { type: 'number', description: 'money in in rupees, 0 if none' }, balance: { type: 'number' } }, required: ['date', 'narration', 'debit', 'credit'] } },
  unreadable: { type: 'array', items: { type: 'object', properties: { raw: { type: 'string' }, reason: { type: 'string' } }, required: ['raw'] } } }, required: ['transactions'] } };
const CLS_TOOL = { name: 'save_matches', description: 'Say who each bank transaction belongs to.', input_schema: { type: 'object', properties: { matches: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'integer' }, kind: { type: 'string', enum: ['client', 'payee', 'none'] }, target_id: { type: 'integer' }, party_name: { type: 'string', description: 'name of the sender / receiver as read from the narration, if any' }, confidence: { type: 'number' } }, required: ['id', 'kind', 'confidence'] } } }, required: ['matches'] } };
const toolInput = (res) => { const b = (res.content || []).find((x) => x.type === 'tool_use'); return b ? b.input : null; };
const iso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00Z')) ? s : null);
const paise = (v) => Math.max(0, Math.round((Number(v) || 0) * 100));

async function readChunk(tid, pdfBytes) {
  const res = await AI.call(tid, 'bank_pdf', { max_tokens: 16000, tools: [TXN_TOOL], tool_choice: { type: 'tool', name: 'save_transactions' },
    system: 'You read Indian bank statements. Extract every transaction row exactly as printed. Dates as YYYY-MM-DD (Indian statements are day-first). debit = money going out (withdrawal), credit = money coming in (deposit). Skip headers, opening/closing balance lines, totals and page footers. Copy the full narration including UPI/NEFT/IMPS names and reference numbers. If a row is cut off, smudged or you are unsure of a date or amount, do NOT guess — put its text in "unreadable".',
    messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdfBytes).toString('base64') } }, { type: 'text', text: 'Extract the transactions from these statement pages.' }] }] });
  const out = toolInput(res); if (!out) throw new Error('The AI did not return any transactions for these pages.');
  return out;
}

async function aiSort(tid, importId) {
  if (!AI.configured(tid)) return 0;
  const rows = db.prepare("SELECT id,narration,debit_paise,credit_paise FROM bank_txns WHERE tenant_id=? AND status='unmatched' AND party_kind IS NULL" + (importId ? ' AND import_id=?' : '') + ' ORDER BY id LIMIT 400').all(...(importId ? [tid, importId] : [tid]));
  if (!rows.length) return 0;
  const clients = db.prepare('SELECT id,name FROM clients WHERE tenant_id=? ORDER BY name LIMIT 500').all(tid), payees = db.prepare('SELECT id,name,kind FROM payees WHERE tenant_id=? AND active=1 LIMIT 300').all(tid);
  let done = 0;
  for (let i = 0; i < rows.length; i += 40) {
    const part = rows.slice(i, i + 40);
    let res; try { res = await AI.call(tid, 'bank_sort', { max_tokens: 6000, tools: [CLS_TOOL], tool_choice: { type: 'tool', name: 'save_matches' },
      system: "You help an Indian law firm's accountant. For each bank transaction decide whether it was made by / for one of the firm's CLIENTS (usually a credit: fees received) or to one of its PAYEES (usually a debit: salary, vendor, advocate). Match on the person's name in the narration (UPI / NEFT / IMPS text), allowing for initials, spelling variants and word order. Only answer 'client' or 'payee' when you are reasonably sure; otherwise 'none' with a low confidence. Never invent ids: target_id must come from the lists given.",
      messages: [{ role: 'user', content: JSON.stringify({ clients, payees, transactions: part.map((r) => ({ id: r.id, narration: r.narration, debit: r.debit_paise / 100, credit: r.credit_paise / 100 })) }) }] }); } catch (e) { if (!done) throw e; break; }
    const m = (toolInput(res) || {}).matches || [];
    for (const x of m) {
      const row = part.find((r) => r.id === x.id); if (!row) continue;
      const conf = Math.max(0, Math.min(1, Number(x.confidence) || 0));
      const target = x.kind === 'client' ? clients.find((c) => c.id === x.target_id) : x.kind === 'payee' ? payees.find((p) => p.id === x.target_id) : null;
      if (target && conf >= 0.7) { db.prepare("UPDATE bank_txns SET party_kind=?, party_id=?, party_name=?, matched_client_id=?, conf=?, by_ai=1, status='suggested' WHERE id=? AND status='unmatched'").run(x.kind, target.id, target.name, x.kind === 'client' ? target.id : null, conf, row.id); done++; }
      else if (x.party_name) db.prepare("UPDATE bank_txns SET party_name=?, conf=?, by_ai=1 WHERE id=? AND status='unmatched' AND party_name IS NULL").run(String(x.party_name).slice(0, 100), conf, row.id);
    }
  }
  return done;
}

const addTxn = (tid, importId, source, t) => {
  const dup = db.prepare("SELECT 1 FROM bank_txns WHERE tenant_id=? AND txn_date=? AND COALESCE(narration,'')=? AND COALESCE(ref,'')=? AND debit_paise=? AND credit_paise=?").get(tid, t.date, t.narration, t.ref || '', t.dr, t.cr);
  if (dup) return 0;
  const x = db.prepare('INSERT INTO bank_txns(tenant_id,txn_date,narration,ref,debit_paise,credit_paise,balance_paise,import_id,source) VALUES (?,?,?,?,?,?,?,?,?)').run(tid, t.date, t.narration, t.ref || '', t.dr, t.cr, t.bal == null ? null : t.bal, importId, source);
  localMatch(tid, { id: x.lastInsertRowid, narration: t.narration }); return 1;
};
const logErr = (tid, importId, raw, reason) => db.prepare('INSERT INTO bank_import_errors(tenant_id,import_id,raw,reason) VALUES (?,?,?,?)').run(tid, importId, String(raw || '').slice(0, 400), String(reason || '').slice(0, 200));

// Runs in the background; survives restarts (the uploaded PDF is kept only until the job ends).
const running = new Set();
async function processImport(id) {
  if (running.has(id)) return; running.add(id);
  const imp = db.prepare('SELECT * FROM bank_imports WHERE id=?').get(id), file = path.join(tmpDir(), id + '.pdf');
  try {
    const src = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true }), total = src.getPageCount();
    db.prepare('UPDATE bank_imports SET pages_total=? WHERE id=?').run(total, id);
    for (let from = db.prepare('SELECT pages_done d FROM bank_imports WHERE id=?').get(id).d; from < total; from += CHUNK) {
      const to = Math.min(total, from + CHUNK), doc = await PDFDocument.create();
      (await doc.copyPages(src, Array.from({ length: to - from }, (_, i) => from + i))).forEach((p) => doc.addPage(p));
      try {
        const out = await readChunk(imp.tenant_id, await doc.save());
        let add = 0, dup = 0;
        db.transaction(() => {
          for (const t of out.transactions || []) {
            const date = iso(t.date), dr = paise(t.debit), cr = paise(t.credit), narration = String(t.narration || '').trim().slice(0, 300);
            if (!date || (!dr && !cr) || (dr && cr)) { logErr(imp.tenant_id, id, `${t.date} | ${narration} | Dr ${t.debit} | Cr ${t.credit}`, !date ? 'Date not clear' : dr && cr ? 'Both debit and credit shown' : 'No amount'); continue; }
            if (addTxn(imp.tenant_id, id, 'pdf', { date, narration, ref: String(t.ref || '').slice(0, 80), dr, cr, bal: t.balance == null ? null : Math.round(Number(t.balance) * 100) })) add++; else dup++;
          }
          for (const u of out.unreadable || []) logErr(imp.tenant_id, id, u.raw, u.reason || 'Could not be read');
          db.prepare('UPDATE bank_imports SET added=added+?, duplicates=duplicates+?, pages_done=? WHERE id=?').run(add, dup, to, id);
        })();
      } catch (e) {
        logErr(imp.tenant_id, id, `Pages ${from + 1}–${to} of ${total}`, 'Could not be read: ' + e.message + ' — upload the same PDF again; entries already saved are skipped.');
        db.prepare('UPDATE bank_imports SET pages_done=? WHERE id=?').run(to, id);
      }
    }
    db.prepare("UPDATE bank_imports SET message='Sorting by client and payee…' WHERE id=?").run(id);
    try { await aiSort(imp.tenant_id, id); } catch (e) { logErr(imp.tenant_id, id, 'Automatic sorting', 'Not completed: ' + e.message + ' — use "Sort with AI" again later.'); }
    db.prepare("UPDATE bank_imports SET status='done', message=NULL WHERE id=?").run(id);
  } catch (e) {
    db.prepare("UPDATE bank_imports SET status='failed', message=? WHERE id=?").run('The PDF could not be opened: ' + e.message, id);
  } finally { running.delete(id); try { fs.unlinkSync(file); } catch (e) {} }
}
const resume = () => { for (const r of db.prepare("SELECT id FROM bank_imports WHERE status='processing'").all()) { if (fs.existsSync(path.join(tmpDir(), r.id + '.pdf'))) processImport(r.id); else db.prepare("UPDATE bank_imports SET status='failed', message='Interrupted — upload the PDF again; entries already saved are kept.' WHERE id=?").run(r.id); } };

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  const txn = (req, id) => db.prepare('SELECT * FROM bank_txns WHERE id=? AND tenant_id=?').get(id, T(req));

  app.post('/api/bank/import-pdf', ACC, up.single('file'), (req, res) => {
    if (!req.file || !/pdf/i.test(req.file.mimetype + req.file.originalname)) return res.status(400).json({ error: 'Choose the bank statement as a PDF file.' });
    if (!AI.configured(T(req))) return res.status(503).json({ error: 'AI is not active for your firm, so a PDF cannot be read. Upload the statement as CSV instead.' });
    const r = db.prepare('INSERT INTO bank_imports(tenant_id,filename,source,created_by) VALUES (?,?,?,?)').run(T(req), L.str(req.file.originalname, 120), 'pdf', req.user.id);
    fs.writeFileSync(path.join(tmpDir(), r.lastInsertRowid + '.pdf'), req.file.buffer);
    audit(T(req), req.user.id, 'bank_pdf_upload', 'bank', r.lastInsertRowid, req.file.originalname, L.ip(req));
    processImport(r.lastInsertRowid); res.json({ import_id: r.lastInsertRowid });
  });
  app.get('/api/bank/imports', BILL, (req, res) => res.json(db.prepare('SELECT * FROM bank_imports WHERE tenant_id=? ORDER BY id DESC LIMIT 10').all(T(req))));
  app.get('/api/bank/summary', BILL, (req, res) => {
    const c = db.prepare("SELECT status, COUNT(*) n FROM bank_txns WHERE tenant_id=? GROUP BY status").all(T(req)); const o = {}; c.forEach((x) => (o[x.status] = x.n));
    res.json({ ...o, errors: db.prepare('SELECT COUNT(*) n FROM bank_import_errors WHERE tenant_id=? AND resolved=0').get(T(req)).n, ai: AI.configured(T(req)) });
  });

  // Rows the reader could not understand — kept until corrected or dismissed.
  app.get('/api/bank/errors', BILL, (req, res) => res.json(db.prepare('SELECT * FROM bank_import_errors WHERE tenant_id=? AND resolved=0 ORDER BY id LIMIT 200').all(T(req))));
  app.post('/api/bank/errors/:id/fix', ACC, (req, res) => {
    const e = db.prepare('SELECT * FROM bank_import_errors WHERE id=? AND tenant_id=? AND resolved=0').get(req.params.id, T(req)); if (!e) return res.status(404).json({ error: 'Not found.' });
    const date = iso(req.body.date), dr = paise(req.body.debit), cr = paise(req.body.credit);
    if (!L.must(res, date && ((dr > 0) !== (cr > 0)), 'Enter the date and either a debit or a credit amount.')) return;
    const added = addTxn(T(req), e.import_id, 'manual', { date, narration: L.str(req.body.narration, 300) || e.raw, ref: L.str(req.body.ref, 80), dr, cr });
    db.prepare('UPDATE bank_import_errors SET resolved=1 WHERE id=?').run(e.id); res.json({ ok: true, added });
  });
  app.post('/api/bank/errors/:id/dismiss', ACC, (req, res) => { db.prepare('UPDATE bank_import_errors SET resolved=1 WHERE id=? AND tenant_id=?').run(req.params.id, T(req)); res.json({ ok: true }); });
  app.post('/api/bank/entry', ACC, (req, res) => {          // add a missed line by hand
    const date = iso(req.body.date), dr = paise(req.body.debit), cr = paise(req.body.credit);
    if (!L.must(res, date && ((dr > 0) !== (cr > 0)) && L.str(req.body.narration, 300), 'Enter the date, narration and either a debit or a credit amount.')) return;
    res.json({ added: addTxn(T(req), null, 'manual', { date, narration: L.str(req.body.narration, 300), ref: L.str(req.body.ref, 80), dr, cr }) });
  });

  // Assign party / head / remark and optionally remember the name. Works on one or many rows.
  function assign(req, ids, b) {
    let n = 0;
    const kind = ['client', 'payee', 'other', 'none'].includes(b.party_kind) ? b.party_kind : null;
    let target = null, name = L.str(b.party_name, 100);
    if (kind === 'client') { target = db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(L.int(b.party_id), T(req)); if (!target) throw Object.assign(new Error('Choose a client.'), { status: 400 }); }
    if (kind === 'payee') { target = db.prepare('SELECT id,name FROM payees WHERE id=? AND tenant_id=?').get(L.int(b.party_id), T(req)); if (!target) throw Object.assign(new Error('Choose a payee.'), { status: 400 }); }
    if (kind === 'other' && !name) throw Object.assign(new Error('Type the name of the person or party.'), { status: 400 });
    db.transaction(() => {
      for (const id of ids) {
        const t = txn(req, id); if (!t || ['matched', 'tagged'].includes(t.status)) continue;
        const sets = [], vals = [];
        if (kind) { const nm = kind === 'none' ? null : target ? target.name : name; sets.push('party_kind=?', 'party_id=?', 'party_name=?', 'matched_client_id=?', 'by_ai=0', 'conf=?'); vals.push(kind === 'none' ? null : kind, target ? target.id : null, nm, kind === 'client' ? target.id : null, kind === 'none' ? null : 1); sets.push("status=?"); vals.push(kind === 'none' ? 'unmatched' : 'suggested'); }
        if (b.head !== undefined) { sets.push('head=?'); vals.push(L.str(b.head, 80) || null); }
        if (b.remark !== undefined) { sets.push('remark=?'); vals.push(L.str(b.remark, 300) || null); }
        if (!sets.length) continue; db.prepare(`UPDATE bank_txns SET ${sets.join(',')} WHERE id=?`).run(...vals, id); n++;
        const alias = String(b.alias || '').toUpperCase().trim();
        if (b.remember && alias.length >= 4 && kind && kind !== 'none') db.prepare('INSERT INTO bank_rules(tenant_id,alias,party_kind,party_id,party_name,head) VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,alias) DO UPDATE SET party_kind=excluded.party_kind, party_id=excluded.party_id, party_name=excluded.party_name, head=excluded.head')
          .run(T(req), alias, kind, target ? target.id : null, target ? target.name : name, L.str(b.head, 80) || null);
      }
    })();
    return n;
  }
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { if (res.headersSent) return; res.status(e.status || 500).json({ error: e.status ? e.message : (e.message || 'Something went wrong.') }); if (!e.status) console.error(e); } };

  // Edit one entry (date / narration / amounts too, until it is posted)
  app.put('/api/bank/:id', ACC, wrap((req, res) => {
    const t = txn(req, req.params.id); if (!t) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, !['matched', 'tagged'].includes(t.status), 'This entry is already posted. Reopen it first.')) return;
    const b = req.body;
    if (b.date !== undefined || b.narration !== undefined || b.debit !== undefined || b.credit !== undefined) {
      const date = b.date === undefined ? t.txn_date : iso(b.date), dr = b.debit === undefined ? t.debit_paise : paise(b.debit), cr = b.credit === undefined ? t.credit_paise : paise(b.credit);
      if (!L.must(res, date && ((dr > 0) !== (cr > 0)), 'Enter a valid date and either a debit or a credit amount.')) return;
      db.prepare('UPDATE bank_txns SET txn_date=?, narration=?, debit_paise=?, credit_paise=? WHERE id=?').run(date, b.narration === undefined ? t.narration : L.str(b.narration, 300), dr, cr, t.id);
    }
    assign(req, [t.id], b); res.json({ ok: true });
  }));
  // Bulk: assign / ignore / reopen / confirm / sort-with-AI
  app.post('/api/bank/bulk', ACC, wrap(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => L.int(x)).filter(Boolean).slice(0, 500), act = req.body.action;
    if (!L.must(res, ids.length, 'Select at least one entry.')) return;
    if (act === 'assign') return res.json({ changed: assign(req, ids, req.body) });
    if (act === 'ignore') { let n = 0; for (const id of ids) n += db.prepare("UPDATE bank_txns SET status='ignored' WHERE id=? AND tenant_id=? AND status IN ('unmatched','suggested')").run(id, T(req)).changes; return res.json({ changed: n }); }
    if (act === 'reopen') { let n = 0; for (const id of ids) { if (reopen(req, id)) n++; } return res.json({ changed: n }); }
    if (act === 'confirm') { let ok = 0, skipped = 0; for (const id of ids) { try { confirm(req, id) ? ok++ : skipped++; } catch (e) { skipped++; } } return res.json({ confirmed: ok, skipped }); }
    if (act === 'ai') { db.prepare("UPDATE bank_txns SET party_kind=NULL, party_id=NULL, party_name=NULL WHERE tenant_id=? AND status IN ('unmatched','suggested') AND by_ai=1 AND id IN (" + ids.map(() => '?').join(',') + ')').run(T(req), ...ids);
      const only = ids; const rows = db.prepare("SELECT id FROM bank_txns WHERE tenant_id=? AND status='unmatched' AND party_kind IS NULL AND id IN (" + only.map(() => '?').join(',') + ')').all(T(req), ...only);
      for (const r of rows) localMatch(T(req), db.prepare('SELECT id,narration FROM bank_txns WHERE id=?').get(r.id));
      return res.json({ sorted: await aiSort(T(req), null) }); }
    res.status(400).json({ error: 'Unknown action.' });
  }));

  // Post an entry: credit→client = receipt; debit→payee = payout record; anything else = tagged with its head.
  function confirm(req, id) {
    const t = txn(req, id); if (!t || !['suggested', 'unmatched'].includes(t.status) || !t.party_kind || t.party_kind === 'none') return false;
    return db.transaction(() => {
      if (t.party_kind === 'client' && t.credit_paise > 0 && t.party_id) {
        const p = req.app.locals.recordPayment(req, { client_id: t.party_id, amount_paise: t.credit_paise, mode: 'bank', pay_date: t.txn_date, reference: t.ref || t.narration, bank_txn_id: t.id });
        db.prepare("UPDATE bank_txns SET status='matched', matched_payment_id=? WHERE id=?").run(p.id, t.id); return true;
      }
      if (t.party_kind === 'payee' && t.debit_paise > 0 && t.party_id) {
        const due = db.prepare("SELECT id FROM payee_payments WHERE tenant_id=? AND payee_id=? AND status='due' AND amount_paise=? ORDER BY due_date LIMIT 1").get(T(req), t.party_id, t.debit_paise);
        if (due) db.prepare("UPDATE payee_payments SET status='paid', paid_on=?, mode='bank', reference=?, paid_by=?, bank_txn_id=?, bank_created=0 WHERE id=?").run(t.txn_date, t.ref || (t.narration || '').slice(0, 60), req.user.id, t.id, due.id);
        else db.prepare("INSERT INTO payee_payments(tenant_id,payee_id,head,amount_paise,due_date,status,paid_on,mode,reference,narration,paid_by,bank_txn_id,bank_created) VALUES (?,?,?,?,?,'paid',?,'bank',?,?,?,?,1)")
          .run(T(req), t.party_id, t.head || 'Payment', t.debit_paise, t.txn_date, t.txn_date, t.ref || (t.narration || '').slice(0, 60), t.remark, req.user.id, t.id);
      }
      db.prepare("UPDATE bank_txns SET status='tagged' WHERE id=?").run(t.id); return true;
    })();
  }
  function reopen(req, id) {
    const t = txn(req, id); if (!t || !['tagged', 'ignored'].includes(t.status)) return false;
    db.transaction(() => {
      const pp = db.prepare('SELECT * FROM payee_payments WHERE bank_txn_id=? AND tenant_id=?').get(t.id, T(req));
      if (pp) { if (pp.bank_created) db.prepare('DELETE FROM payee_payments WHERE id=?').run(pp.id); else db.prepare("UPDATE payee_payments SET status='due', paid_on=NULL, mode=NULL, reference=NULL, paid_by=NULL, bank_txn_id=NULL WHERE id=?").run(pp.id); }
      db.prepare("UPDATE bank_txns SET status='unmatched' WHERE id=?").run(t.id);
    })(); return true;
  }

  // Remembered names
  app.get('/api/bank/rules', BILL, (req, res) => res.json(db.prepare('SELECT * FROM bank_rules WHERE tenant_id=? ORDER BY alias').all(T(req))));
  app.delete('/api/bank/rules/:id', ACC, (req, res) => { db.prepare('DELETE FROM bank_rules WHERE id=? AND tenant_id=?').run(req.params.id, T(req)); res.json({ ok: true }); });
  const rt = setTimeout(resume, 1500); if (rt.unref) rt.unref();
};
Object.assign(module.exports, { localMatch, processImport, aiSort, resume });
