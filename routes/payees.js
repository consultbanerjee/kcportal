'use strict';
// Payees and scheduled payments (Accounts). A payee can be an advocate or staff member, a client, or anyone else.
// A schedule (once / weekly / monthly / quarterly / yearly) raises a "due" payment on each scheduled date; the accountant pays it
// (Google Pay / bank / cash) and records the reference. Cash payments also go into the cash book. Nothing is paid automatically.
const L = require('../lib');
const U = require('./upi');
const { db, audit } = L;
const ACC = L.need('admin', 'accounts');
const today = () => new Date().toISOString().slice(0, 10);
const FREQ = ['once', 'weekly', 'monthly', 'quarterly', 'yearly'];

function addPeriod(date, freq, anchorDay) {
  const d = new Date(date + 'T00:00:00Z');
  if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else { const m = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12; const day = anchorDay || d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); }
  return d.toISOString().slice(0, 10);
}

// Raise due payments for every schedule whose date has come (catches up if the server was off).
function raiseDue(tid, upTo = today()) {
  let n = 0;
  const rows = db.prepare("SELECT s.* FROM pay_schedules s JOIN payees p ON p.id=s.payee_id WHERE s.active=1 AND s.next_due<=? AND p.active=1" + (tid ? ' AND s.tenant_id=?' : '')).all(...(tid ? [upTo, tid] : [upTo]));
  for (const s of rows) {
    let due = s.next_due; const anchor = Number(s.next_due.slice(8, 10)); let guard = 0;
    while (due <= upTo && guard++ < 60) {
      if (s.end_date && due > s.end_date) break;
      n += db.prepare('INSERT OR IGNORE INTO payee_payments(tenant_id,schedule_id,payee_id,head,amount_paise,due_date,narration) VALUES (?,?,?,?,?,?,?)').run(s.tenant_id, s.id, s.payee_id, s.head, s.amount_paise, due, s.narration).changes;
      if (s.frequency === 'once') { due = null; break; }
      due = addPeriod(due, s.frequency, anchor);
    }
    if (due == null || (s.end_date && due > s.end_date)) db.prepare('UPDATE pay_schedules SET active=0, next_due=? WHERE id=?').run(due || s.next_due, s.id);
    else db.prepare('UPDATE pay_schedules SET next_due=? WHERE id=?').run(due, s.id);
  }
  return n;
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const OFF = L.need('admin', 'accounts', 'advocate');

  app.get('/api/payees', OFF, (req, res) => {
    res.json(db.prepare('SELECT * FROM payees WHERE tenant_id=? ORDER BY active DESC, name').all(T(req)));
  });
  // People who can be picked as payees: team members and clients.
  app.get('/api/payee-sources', ACC, (req, res) => {
    res.json({ team: db.prepare("SELECT id,name,role,phone FROM users WHERE tenant_id=? AND active=1 AND role IN ('advocate','staff','telecaller','accounts','admin') ORDER BY name").all(T(req)),
      clients: db.prepare('SELECT id,name,phone FROM clients WHERE tenant_id=? ORDER BY name').all(T(req)) });
  });
  app.post('/api/payees', ACC, (req, res) => {
    const b = req.body; let name = L.str(b.name, 100), kind = ['advocate', 'staff', 'client', 'other'].includes(b.kind) ? b.kind : 'other', userId = null, clientId = null, phone = L.str(b.phone, 30);
    if (kind === 'client' && L.int(b.client_id)) { const c = db.prepare('SELECT id,name,phone FROM clients WHERE id=? AND tenant_id=?').get(L.int(b.client_id), T(req)); if (!c) return res.status(404).json({ error: 'Client not found.' }); clientId = c.id; name = name || c.name; phone = phone || c.phone; }
    if ((kind === 'advocate' || kind === 'staff') && L.int(b.user_id)) { const u = db.prepare('SELECT id,name,phone,role FROM users WHERE id=? AND tenant_id=?').get(L.int(b.user_id), T(req)); if (!u) return res.status(404).json({ error: 'Team member not found.' }); userId = u.id; name = name || u.name; phone = phone || u.phone; }
    const upi = L.str(b.upi_id, 80);
    if (!L.must(res, name, 'Enter the payee name.') || !L.must(res, !upi || /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(upi), 'Enter a valid UPI ID, like name@okhdfcbank.')) return;
    const r = db.prepare('INSERT INTO payees(tenant_id,name,kind,user_id,client_id,phone,upi_id,bank_details,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(T(req), name, kind, userId, clientId, phone, upi, L.str(b.bank_details, 300), L.str(b.notes, 300));
    audit(T(req), req.user.id, 'payee_added', 'payee', r.lastInsertRowid, name, L.ip(req)); res.json({ id: r.lastInsertRowid });
  });
  app.put('/api/payees/:id', ACC, (req, res) => {
    const p = db.prepare('SELECT * FROM payees WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!p) return res.status(404).json({ error: 'Not found.' });
    const b = req.body, upi = b.upi_id === undefined ? p.upi_id : L.str(b.upi_id, 80);
    if (!L.must(res, !upi || /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(upi), 'Enter a valid UPI ID.')) return;
    db.prepare('UPDATE payees SET name=?,phone=?,upi_id=?,bank_details=?,notes=?,active=? WHERE id=?').run(L.str(b.name, 100) || p.name, b.phone === undefined ? p.phone : L.str(b.phone, 30), upi,
      b.bank_details === undefined ? p.bank_details : L.str(b.bank_details, 300), b.notes === undefined ? p.notes : L.str(b.notes, 300), b.active === undefined ? p.active : (b.active ? 1 : 0), p.id);
    audit(T(req), req.user.id, 'payee_updated', 'payee', p.id, p.name, L.ip(req)); res.json({ ok: true });
  });

  app.get('/api/pay-schedules', OFF, (req, res) => {
    res.json(db.prepare('SELECT s.*, p.name AS payee, p.kind FROM pay_schedules s JOIN payees p ON p.id=s.payee_id WHERE s.tenant_id=? ORDER BY s.active DESC, s.next_due').all(T(req)));
  });
  app.post('/api/pay-schedules', ACC, (req, res) => {
    const b = req.body, p = db.prepare('SELECT * FROM payees WHERE id=? AND tenant_id=? AND active=1').get(L.int(b.payee_id), T(req)), amount = L.paise(b.amount), head = L.str(b.head, 80);
    if (!L.must(res, p && head && amount > 0 && FREQ.includes(b.frequency) && L.isDate(b.next_due) && (!b.end_date || L.isDate(b.end_date)), 'Payee, purpose, amount, how often and the first due date are required.')) return;
    const mode = ['bank', 'upi', 'cash', 'cheque'].includes(b.mode) ? b.mode : 'bank';
    const r = db.prepare('INSERT INTO pay_schedules(tenant_id,payee_id,head,amount_paise,frequency,next_due,end_date,mode,narration,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(T(req), p.id, head, amount, b.frequency, b.next_due, b.end_date || null, mode, L.str(b.narration, 300), req.user.id);
    audit(T(req), req.user.id, 'pay_schedule_added', 'pay_schedule', r.lastInsertRowid, `${p.name} ${head} ${b.frequency}`, L.ip(req));
    raiseDue(T(req)); res.json({ id: r.lastInsertRowid });
  });
  app.put('/api/pay-schedules/:id', ACC, (req, res) => {
    const s = db.prepare('SELECT * FROM pay_schedules WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!s) return res.status(404).json({ error: 'Not found.' });
    const b = req.body, amount = b.amount == null ? s.amount_paise : L.paise(b.amount);
    if (!L.must(res, amount > 0, 'Enter a valid amount.')) return;
    db.prepare('UPDATE pay_schedules SET amount_paise=?, active=?, end_date=?, head=? WHERE id=?').run(amount, b.active === undefined ? s.active : (b.active ? 1 : 0), b.end_date === undefined ? s.end_date : (b.end_date || null), L.str(b.head, 80) || s.head, s.id);
    audit(T(req), req.user.id, 'pay_schedule_updated', 'pay_schedule', s.id, '', L.ip(req)); res.json({ ok: true });
  });

  // The pay list: due / overdue / paid. Raises anything newly due first.
  app.get('/api/payee-payments', OFF, (req, res) => {
    raiseDue(T(req));
    const st = ['due', 'paid', 'skipped'].includes(req.query.status) ? req.query.status : null;
    const rows = db.prepare(`SELECT x.*, p.name AS payee, p.kind, p.upi_id, p.phone, p.bank_details FROM payee_payments x JOIN payees p ON p.id=x.payee_id
      WHERE x.tenant_id=? ${st ? 'AND x.status=?' : ''} ORDER BY ${st === 'paid' ? 'x.paid_on DESC' : 'x.due_date'}, x.id LIMIT 300`).all(...(st ? [T(req), st] : [T(req)]));
    for (const r of rows) { r.overdue = r.status === 'due' && r.due_date < today(); r.upi_link = r.status === 'due' && r.upi_id ? U.linkTo(r.upi_id, p_name(r), r.amount_paise, r.head) : null; }
    res.json(rows);
  });
  const p_name = (r) => r.payee;
  // Ledgers
  app.get('/api/ledger/payee/:id', OFF, (req, res) => {
    const payee = db.prepare('SELECT id,name,kind FROM payees WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!payee) return res.status(404).json({ error: 'Not found.' });
    const rows = db.prepare("SELECT head,amount_paise,due_date,status,paid_on,mode,reference FROM payee_payments WHERE tenant_id=? AND payee_id=? AND status<>'skipped' ORDER BY COALESCE(paid_on,due_date), id").all(T(req), payee.id);
    const sum = (st) => rows.filter((r) => r.status === st).reduce((s, r) => s + r.amount_paise, 0);
    res.json({ payee, rows, paid_paise: sum('paid'), due_paise: sum('due') });
  });
  app.get('/api/ledger/heads', OFF, (req, res) => {
    const m = new Map(), add = (h, k, v) => { const r = m.get(h) || { head: h, in_paise: 0, out_paise: 0 }; r[k] += v; m.set(h, r); };
    for (const r of db.prepare('SELECT head,kind,SUM(amount_paise) v FROM cash_entries WHERE tenant_id=? GROUP BY head,kind').all(T(req))) add(r.head, r.kind === 'in' ? 'in_paise' : 'out_paise', r.v);
    for (const r of db.prepare("SELECT head,SUM(amount_paise) v FROM payee_payments WHERE tenant_id=? AND status='paid' AND cash_entry_id IS NULL GROUP BY head").all(T(req))) add(r.head, 'out_paise', r.v);
    res.json([...m.values()].sort((a, b) => a.head.localeCompare(b.head)));
  });
  // One-off payment (not on a schedule)
  app.post('/api/payee-payments', ACC, (req, res) => {
    const b = req.body, p = db.prepare('SELECT * FROM payees WHERE id=? AND tenant_id=? AND active=1').get(L.int(b.payee_id), T(req)), amount = L.paise(b.amount), head = L.str(b.head, 80);
    if (!L.must(res, p && head && amount > 0, 'Payee, purpose and amount are required.')) return;
    const r = db.prepare('INSERT INTO payee_payments(tenant_id,payee_id,head,amount_paise,due_date,narration) VALUES (?,?,?,?,?,?)').run(T(req), p.id, head, amount, L.isDate(b.due_date) ? b.due_date : today(), L.str(b.narration, 300));
    res.json({ id: r.lastInsertRowid });
  });
  app.post('/api/payee-payments/:id/pay', ACC, (req, res) => {
    const x = db.prepare('SELECT x.*, p.name AS payee FROM payee_payments x JOIN payees p ON p.id=x.payee_id WHERE x.id=? AND x.tenant_id=?').get(req.params.id, T(req));
    if (!x) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, x.status === 'due', 'This payment is already settled.')) return;
    const mode = ['bank', 'upi', 'cash', 'cheque'].includes(req.body.mode) ? req.body.mode : 'bank', ref = L.str(req.body.reference, 60), on = L.isDate(req.body.paid_on) ? req.body.paid_on : today();
    if (!L.must(res, mode === 'cash' || ref, 'Enter the UPI / bank / cheque reference.')) return;
    db.transaction(() => {
      let cashId = null;
      if (mode === 'cash') cashId = db.prepare('INSERT INTO cash_entries(tenant_id,entry_date,kind,amount_paise,head,narration,client_id,created_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(T(req), on, 'out', x.amount_paise, x.head, `Paid to ${x.payee}` + (x.narration ? ' — ' + x.narration : ''), null, req.user.id).lastInsertRowid;
      db.prepare("UPDATE payee_payments SET status='paid', paid_on=?, mode=?, reference=?, cash_entry_id=?, paid_by=? WHERE id=?").run(on, mode, ref, cashId, req.user.id, x.id);
    })();
    audit(T(req), req.user.id, 'payee_paid', 'payee_payment', x.id, `${x.payee} ${x.amount_paise / 100}`, L.ip(req)); res.json({ ok: true });
  });
  app.post('/api/payee-payments/:id/skip', ACC, (req, res) => {
    const r = db.prepare("UPDATE payee_payments SET status='skipped', narration=COALESCE(?,narration) WHERE id=? AND tenant_id=? AND status='due'").run(L.str(req.body.reason, 200) || null, req.params.id, T(req));
    if (!r.changes) return res.status(404).json({ error: 'Not found or already settled.' }); res.json({ ok: true });
  });
};
let timer;
module.exports.startWorker = () => { const run = () => { try { raiseDue(null); } catch (e) { console.error('payee worker', e.message); } }; run(); timer = setInterval(run, 6 * 3600 * 1000); timer.unref && timer.unref(); };
Object.assign(module.exports, { raiseDue, addPeriod });
