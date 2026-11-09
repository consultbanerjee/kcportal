'use strict';
// Per-client books: expenses and the client's Accounts tab. Everything reads and writes the SAME tables as the firm's main Billing/Accounts
// section (invoices, payments, cash_entries, expenses), so there is one set of books, shown through each client's page.
const L = require('../lib');
const { db, audit } = L;
const BILL = L.need('admin', 'advocate', 'accounts');
const today = () => new Date().toISOString().slice(0, 10);

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const client = (req) => db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.params.id || req.query.client_id || req.body.client_id), T(req));

  app.get('/api/expenses', BILL, (req, res) => {
    const c = client(req); if (!c) return res.status(404).json({ error: 'Client not found.' });
    const rows = db.prepare('SELECT e.*, m.file_no FROM expenses e LEFT JOIN matters m ON m.id=e.matter_id WHERE e.tenant_id=? AND e.client_id=? ORDER BY e.exp_date DESC, e.id DESC').all(T(req), c.id);
    res.json({ rows, total_paise: rows.reduce((s, r) => s + r.amount_paise, 0), recoverable_paise: rows.filter((r) => r.reimbursable).reduce((s, r) => s + r.amount_paise, 0) });
  });
  // mode 'cash' also writes a cash-book payment so the cash book stays complete; 'bank' is matched from the imported bank statement; 'other' flows straight into the final report
  app.post('/api/expenses', BILL, (req, res) => {
    const c = client(req), amount = L.paise(req.body.amount), head = L.str(req.body.head, 80);
    const mode = ['cash', 'bank', 'other'].includes(req.body.mode) ? req.body.mode : 'cash';
    if (!L.must(res, c && amount > 0 && head, 'Client, head and amount are required.')) return;
    const matter = L.int(req.body.matter_id) ? db.prepare('SELECT id FROM matters WHERE id=? AND tenant_id=? AND client_id=?').get(L.int(req.body.matter_id), T(req), c.id) : null;
    const date = L.isDate(req.body.exp_date) ? req.body.exp_date : today();
    const id = db.transaction(() => {
      let cashId = null;
      if (mode === 'cash') cashId = db.prepare('INSERT INTO cash_entries(tenant_id,entry_date,kind,amount_paise,head,narration,client_id,created_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(T(req), date, 'out', amount, head, L.str(req.body.narration, 300) || 'Expense for ' + c.name, c.id, req.user.id).lastInsertRowid;
      return db.prepare('INSERT INTO expenses(tenant_id,client_id,matter_id,exp_date,head,amount_paise,mode,reimbursable,narration,cash_entry_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(T(req), c.id, matter && matter.id, date, head, amount, mode, req.body.reimbursable ? 1 : 0, L.str(req.body.narration, 300), cashId, req.user.id).lastInsertRowid;
    })();
    audit(T(req), req.user.id, 'expense_added', 'expense', id, head, L.ip(req));
    res.json({ id });
  });
  app.delete('/api/expenses/:id', L.need('admin', 'accounts'), (req, res) => {
    const e = db.prepare('SELECT * FROM expenses WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!e) return res.status(404).json({ error: 'Not found.' });
    db.transaction(() => { if (e.cash_entry_id) db.prepare('DELETE FROM cash_entries WHERE id=? AND tenant_id=?').run(e.cash_entry_id, T(req)); db.prepare('DELETE FROM expenses WHERE id=?').run(e.id); })();
    audit(T(req), req.user.id, 'expense_deleted', 'expense', e.id, e.head, L.ip(req));
    res.json({ ok: true });
  });

  // Accounts tab: the statement (billed vs received) plus a cash-basis Receipts & Payments summary for this client.
  app.get('/api/clients/:id/accounts', BILL, (req, res) => {
    const c = client(req); if (!c) return res.status(404).json({ error: 'Not found.' });
    const t = T(req), id = c.id;
    const stmt = [
      ...db.prepare("SELECT inv_date AS date, 'Invoice ' || inv_no AS particulars, total_paise AS debit_paise, 0 AS credit_paise FROM invoices WHERE tenant_id=? AND client_id=? AND status NOT IN ('draft','cancelled')").all(t, id),
      ...db.prepare("SELECT pay_date AS date, 'Receipt ' || rec_no || ' (' || mode || ')' AS particulars, 0 AS debit_paise, amount_paise AS credit_paise FROM payments WHERE tenant_id=? AND client_id=?").all(t, id),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0; stmt.forEach((r) => { bal += r.debit_paise - r.credit_paise; r.balance_paise = bal; });
    const one = (sql, ...a) => db.prepare(sql).get(...a).v;
    const receipts = [
      ...db.prepare('SELECT pay_date AS date, rec_no || \' (\' || mode || \')\' AS particulars, amount_paise FROM payments WHERE tenant_id=? AND client_id=?').all(t, id),
      ...db.prepare("SELECT entry_date AS date, 'Cash received — ' || head AS particulars, amount_paise FROM cash_entries WHERE tenant_id=? AND client_id=? AND kind='in'").all(t, id),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const payments = [
      ...db.prepare('SELECT exp_date AS date, head || \' (\' || mode || \')\' || CASE reimbursable WHEN 1 THEN \' — recoverable\' ELSE \'\' END AS particulars, amount_paise FROM expenses WHERE tenant_id=? AND client_id=?').all(t, id),
      ...db.prepare("SELECT entry_date AS date, 'Cash paid — ' || head AS particulars, amount_paise FROM cash_entries WHERE tenant_id=? AND client_id=? AND kind='out' AND id NOT IN (SELECT cash_entry_id FROM expenses WHERE cash_entry_id IS NOT NULL)").all(t, id),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const sum = (a) => a.reduce((s, r) => s + r.amount_paise, 0);
    res.json({ client: c, statement: stmt, balance_paise: bal,
      advance_paise: one('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE tenant_id=? AND client_id=? AND invoice_id IS NULL', t, id),
      receipts, payments, receipts_paise: sum(receipts), payments_paise: sum(payments), net_paise: sum(receipts) - sum(payments),
      recoverable_paise: one('SELECT COALESCE(SUM(amount_paise),0) v FROM expenses WHERE tenant_id=? AND client_id=? AND reimbursable=1', t, id) });
  });

  // Drafts tab: AI drafts and letters tied to this client
  app.get('/api/clients/:id/drafts', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const c = client(req); if (!c) return res.status(404).json({ error: 'Not found.' });
    res.json({
      ai: db.prepare('SELECT d.id,d.kind,d.title,d.created_at,u.name AS by FROM ai_drafts d JOIN users u ON u.id=d.user_id WHERE d.tenant_id=? AND d.client_id=? ORDER BY d.id DESC LIMIT 100').all(T(req), c.id),
      letters: db.prepare('SELECT id,ref_no,subject,status,created_at,sent_at FROM letters WHERE tenant_id=? AND client_id=? ORDER BY id DESC LIMIT 100').all(T(req), c.id),
    });
  });
};
