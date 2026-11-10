'use strict';
// Simple books for a law firm. One set of figures, built automatically from what is already entered
// (receipts, cash book, payee payments, posted bank entries). Heads are assigned by keyword, so staff only enter data.
const L = require('../lib');
const AI = require('../aicore');
const X = require('./xlsxw');
const { db, audit } = L;
const BILL = L.need('admin', 'advocate', 'accounts');

const DEFAULT_HEADS = [
  ['Fees received', 'income', 'fee,professional,retainer,consult'], ['Other income', 'income', 'interest received,refund,commission,rent received,misc income'],
  ['Salary and staff', 'expense', 'salary,stipend,wages,clerk,staff,junior,peon,intern'],
  ['Office rent', 'expense', 'rent,lease'],
  ['Electricity, internet and phone', 'expense', 'electric,power bill,wifi,internet,broadband,airtel,jio,bsnl,phone,mobile,telephone,recharge'],
  ['Stationery and printing', 'expense', 'stationery,printing,xerox,photocopy,paper,toner,cartridge,binding,file cover'],
  ['Court fees and stamps', 'expense', 'court fee,stamp,e-stamp,vakalatnama,filing,affidavit,notary,certified copy,process fee,paper book'],
  ['Travel and conveyance', 'expense', 'travel,taxi,cab,uber,ola,fuel,petrol,diesel,train,flight,conveyance,toll,auto'],
  ['Software and subscriptions', 'expense', 'software,subscription,zoho,google,workspace,hostinger,domain,titan,manupatra,scc online,aironline,license,hosting,claude,anthropic,whatsapp,metricool'],
  ['Statutory and professional dues', 'expense', 'professional tax,gst,tds,income tax,bar council,bar association,licence fee,membership'],
  ['Bank charges and interest', 'expense', 'bank charge,sms charge,interest paid,penalty,processing fee'],
  ['Books and library', 'expense', 'book,journal,library,law report'],
  ['Repairs and maintenance', 'expense', 'repair,maintenance,cleaning,housekeeping,plumber,electrician,furniture'],
  ['Refreshments and hospitality', 'expense', 'tea,snacks,refreshment,lunch,hospitality,pantry,water'],
  ['Advertising and website', 'expense', 'advert,marketing,website,social media,seo,visiting card'],
  ['Insurance', 'expense', 'insurance,premium'],
  ['Miscellaneous expenses', 'expense', ''],
];
const todayStr = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const fyOf = (d) => { const y = +d.slice(0, 4); return +d.slice(5, 7) >= 4 ? y : y - 1; };
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function heads(t) {
  if (!db.prepare('SELECT 1 FROM acc_heads WHERE tenant_id=? LIMIT 1').get(t)) {
    const ins = db.prepare('INSERT INTO acc_heads(tenant_id,name,grp,keywords,sys,sort) VALUES (?,?,?,?,1,?)');
    DEFAULT_HEADS.forEach((h, i) => ins.run(t, h[0], h[1], h[2], i));
  }
  return db.prepare('SELECT * FROM acc_heads WHERE tenant_id=? ORDER BY sort,id').all(t);
}
// pick a head for a free-text label: exact name, then the longest matching keyword, then the group's default
function classifier(t, defaultIncome, defaultExpense) {
  const H = heads(t), kw = [];
  for (const h of H) for (const k of String(h.keywords || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) kw.push([k, h]);
  kw.sort((a, b) => b[0].length - a[0].length);
  return (text, grp) => {
    const s = String(text || '').trim().toLowerCase();
    const ex = H.find((h) => h.name.toLowerCase() === s && (!grp || h.grp === grp)); if (ex) return ex;
    for (const [k, h] of kw) if (s.includes(k) && (!grp || h.grp === grp)) return h;
    return grp === 'income' ? defaultIncome : defaultExpense;
  };
}

function opening(t) { return { cash: L.int(AI.getS(t, 'acc_open_cash', '0')) || 0, bank: L.int(AI.getS(t, 'acc_open_bank', '0')) || 0 }; }

// Every counted money movement in [from,to], already classified. Nothing is counted twice:
//  - a cash receipt's mirror line in the cash book is skipped (the receipt itself is counted)
//  - bank lines count only once posted (matched to a receipt, or tagged); a posted line that already created a payee payment is not repeated
function rowsOf(t, from, to) {
  const H = heads(t), fees = H.find((h) => h.name === 'Fees received'), oi = H.find((h) => h.name === 'Other income'), misc = H.find((h) => h.name === 'Miscellaneous expenses');
  const cls = classifier(t, oi || fees, misc), out = [];
  const add = (r) => out.push(r);
  for (const p of db.prepare('SELECT p.*, c.name cname FROM payments p LEFT JOIN clients c ON c.id=p.client_id WHERE p.tenant_id=? AND p.pay_date>=? AND p.pay_date<=?').all(t, from, to))
    add({ date: p.pay_date, kind: 'in', paise: p.amount_paise, head: fees.name, grp: 'income', acct: p.mode === 'cash' ? 'cash' : 'bank', party: p.cname || '', ref: p.rec_no, narr: (p.mode || '') + (p.reference ? ' ' + p.reference : ''), src: 'payment', id: p.id });
  for (const c of db.prepare("SELECT c.*, cl.name cname FROM cash_entries c LEFT JOIN clients cl ON cl.id=c.client_id WHERE c.tenant_id=? AND c.entry_date>=? AND c.entry_date<=? AND NOT (c.kind='in' AND c.narration LIKE 'Receipt %')").all(t, from, to)) {
    const h = cls(c.head, c.kind === 'in' ? 'income' : 'expense');
    add({ date: c.entry_date, kind: c.kind, paise: c.amount_paise, head: h.name, grp: h.grp, acct: 'cash', party: c.cname || '', ref: '', narr: [c.head, c.narration].filter(Boolean).join(' — '), src: 'cash', id: c.id });
  }
  for (const x of db.prepare("SELECT x.*, p.name pname FROM payee_payments x JOIN payees p ON p.id=x.payee_id WHERE x.tenant_id=? AND x.status='paid' AND x.cash_entry_id IS NULL AND x.paid_on>=? AND x.paid_on<=?").all(t, from, to)) {
    const h = cls(x.head, 'expense');
    add({ date: x.paid_on, kind: 'out', paise: x.amount_paise, head: h.name, grp: h.grp, acct: x.mode === 'cash' ? 'cash' : 'bank', party: x.pname, ref: x.reference || '', narr: [x.head, x.narration].filter(Boolean).join(' — '), src: 'payee', id: x.id });
  }
  for (const e of db.prepare("SELECT e.*, c.name cname FROM expenses e LEFT JOIN clients c ON c.id=e.client_id WHERE e.tenant_id=? AND e.mode='other' AND e.exp_date>=? AND e.exp_date<=?").all(t, from, to)) {
    const h = cls(e.head, 'expense');
    add({ date: e.exp_date, kind: 'out', paise: e.amount_paise, head: h.name, grp: h.grp, acct: 'bank', party: e.cname || '', ref: '', narr: [e.head, e.narration].filter(Boolean).join(' — ') + ' (for client)', src: 'expense', id: e.id });
  }
  for (const b of db.prepare(`SELECT * FROM bank_txns WHERE tenant_id=? AND status='tagged' AND txn_date>=? AND txn_date<=?
      AND id NOT IN (SELECT bank_txn_id FROM payee_payments WHERE bank_txn_id IS NOT NULL) AND id NOT IN (SELECT bank_txn_id FROM payments WHERE bank_txn_id IS NOT NULL)`).all(t, from, to)) {
    const kind = b.credit_paise > 0 ? 'in' : 'out', h = cls(b.head || b.narration, kind === 'in' ? 'income' : 'expense');
    add({ date: b.txn_date, kind, paise: b.credit_paise > 0 ? b.credit_paise : b.debit_paise, head: h.name, grp: h.grp, acct: 'bank', party: b.party_name || '', ref: b.ref || '', narr: b.narration || '', src: 'bank', id: b.id });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.src.localeCompare(b.src) || a.id - b.id);
}

function receivables(t, asof) {
  const out = [];
  for (const c of db.prepare('SELECT id,name,phone FROM clients WHERE tenant_id=? ORDER BY name').all(t)) {
    const inv = db.prepare("SELECT id,inv_no,inv_date,due_date,total_paise FROM invoices WHERE client_id=? AND status NOT IN ('draft','cancelled') AND inv_date<=? ORDER BY inv_date,id").all(c.id, asof);
    let paid = db.prepare('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE client_id=? AND pay_date<=?').get(c.id, asof).v;
    const open = [];
    for (const i of inv) { const use = Math.min(paid, i.total_paise); paid -= use; if (i.total_paise - use > 0) open.push({ ...i, due_paise: i.total_paise - use, age: dayDiff(i.inv_date, asof) }); }
    const dueP = open.reduce((s, i) => s + i.due_paise, 0);
    if (dueP || paid > 0) out.push({ client_id: c.id, name: c.name, phone: c.phone, due_paise: dueP, advance_paise: paid, b0: open.filter((i) => i.age <= 30).reduce((s, i) => s + i.due_paise, 0), b1: open.filter((i) => i.age > 30 && i.age <= 60).reduce((s, i) => s + i.due_paise, 0), b2: open.filter((i) => i.age > 60 && i.age <= 90).reduce((s, i) => s + i.due_paise, 0), b3: open.filter((i) => i.age > 90).reduce((s, i) => s + i.due_paise, 0), invoices: open });
  }
  return out;
}

function build(t, from, to) {
  const rows = rowsOf(t, from, to), op = opening(t);
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.paise, 0);
  const grp = (g) => { const m = new Map(); rows.filter((r) => r.grp === g && (g === 'income' ? r.kind === 'in' : r.kind === 'out')).forEach((r) => m.set(r.head, (m.get(r.head) || 0) + r.paise)); return [...m].map(([head, paise]) => ({ head, paise })).sort((a, b) => b.paise - a.paise); };
  // an "out" in an income head (a refund) reduces income; an "in" in an expense head (a refund) reduces expense
  const income = grp('income'), expense = grp('expense');
  rows.filter((r) => r.grp === 'income' && r.kind === 'out').forEach((r) => { const x = income.find((i) => i.head === r.head); if (x) x.paise -= r.paise; else income.push({ head: r.head, paise: -r.paise }); });
  rows.filter((r) => r.grp === 'expense' && r.kind === 'in').forEach((r) => { const x = expense.find((i) => i.head === r.head); if (x) x.paise -= r.paise; else expense.push({ head: r.head, paise: -r.paise }); });
  const totalIncome = income.reduce((s, x) => s + x.paise, 0), totalExpense = expense.reduce((s, x) => s + x.paise, 0);
  // balances at the end of the period come from ALL movements up to `to` (plus opening balances)
  const all = rowsOf(t, '0000-01-01', to), bal = (acct) => all.filter((r) => r.acct === acct).reduce((s, r) => s + (r.kind === 'in' ? r.paise : -r.paise), 0);
  const cashBal = op.cash + bal('cash'), bankBook = op.bank + bal('bank');
  const lastStmt = db.prepare('SELECT balance_paise, txn_date FROM bank_txns WHERE tenant_id=? AND balance_paise IS NOT NULL AND txn_date<=? ORDER BY txn_date DESC, id DESC LIMIT 1').get(t, to);
  const unposted = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(credit_paise),0) cr, COALESCE(SUM(debit_paise),0) dr FROM bank_txns WHERE tenant_id=? AND status IN ('unmatched','suggested') AND txn_date<=?").get(t, to);
  const rec = receivables(t, to), recv = rec.reduce((s, r) => s + r.due_paise, 0), adv = rec.reduce((s, r) => s + r.advance_paise, 0);
  const pay = db.prepare("SELECT x.id, x.head, x.amount_paise, x.due_date, p.name payee FROM payee_payments x JOIN payees p ON p.id=x.payee_id WHERE x.tenant_id=? AND x.status='due' AND x.due_date<=? ORDER BY x.due_date").all(t, to);
  const payables = pay.reduce((s, x) => s + x.amount_paise, 0);
  const assets = cashBal + bankBook + recv, liabilities = adv + payables, capital = assets - liabilities;
  const trial = [
    ...expense.map((x) => ({ name: x.head, dr: x.paise > 0 ? x.paise : 0, cr: x.paise < 0 ? -x.paise : 0 })), { name: 'Cash in hand', dr: cashBal > 0 ? cashBal : 0, cr: cashBal < 0 ? -cashBal : 0 },
    { name: 'Bank (as per books)', dr: bankBook > 0 ? bankBook : 0, cr: bankBook < 0 ? -bankBook : 0 }, { name: 'Fees receivable from clients', dr: recv, cr: 0 },
    ...income.map((x) => ({ name: x.head, dr: x.paise < 0 ? -x.paise : 0, cr: x.paise > 0 ? x.paise : 0 })), { name: 'Advances received from clients', dr: 0, cr: adv }, { name: 'Payments due to others', dr: 0, cr: payables },
  ];
  const dr0 = trial.reduce((s, x) => s + x.dr, 0), cr0 = trial.reduce((s, x) => s + x.cr, 0);
  trial.push({ name: 'Capital account (balancing figure, includes earlier years)', dr: cr0 > dr0 ? cr0 - dr0 : 0, cr: dr0 > cr0 ? dr0 - cr0 : 0 });
  // months matrix
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  const mat = (g) => { const m = new Map(); rows.filter((r) => r.grp === g).forEach((r) => { const k = r.head, v = m.get(k) || {}; v[r.date.slice(0, 7)] = (v[r.date.slice(0, 7)] || 0) + (r.kind === (g === 'income' ? 'in' : 'out') ? r.paise : -r.paise); m.set(k, v); }); return [...m].map(([head, v]) => ({ head, m: v })); };
  // readiness checks
  const checks = [];
  const n = (sql, ...a) => db.prepare(sql).get(t, ...a).n;
  if (unposted.n) checks.push({ level: 'warn', text: `${unposted.n} bank statement entries are not posted yet (credits ${unposted.cr / 100}, debits ${unposted.dr / 100}). They are not counted until you match or tag them.`, href: '#/accounts/bank' });
  const dr = n("SELECT COUNT(*) n FROM invoices WHERE tenant_id=? AND status='draft' AND inv_date<=?", to); if (dr) checks.push({ level: 'warn', text: `${dr} invoice(s) are still drafts and are not in the receivables.`, href: '#/accounts/invoices' });
  const old = rec.filter((r) => r.b3 > 0); if (old.length) checks.push({ level: 'info', text: `${old.length} client(s) owe fees older than 90 days.`, href: '#/accounts' });
  const misc = rows.filter((r) => r.head === 'Miscellaneous expenses' && r.kind === 'out').length; if (misc) checks.push({ level: 'info', text: `${misc} expense line(s) fell into Miscellaneous. Add a keyword under Heads to classify them.`, href: '#/accounts/heads' });
  if (cashBal < 0) checks.push({ level: 'warn', text: 'The cash book balance is negative. A cash receipt or an opening balance may be missing.', href: '#/accounts/cash' });
  if (lastStmt && Math.abs(lastStmt.balance_paise - bankBook) > 100 && !unposted.n) checks.push({ level: 'warn', text: `Bank balance per books (${bankBook / 100}) differs from the last statement balance (${lastStmt.balance_paise / 100}). Check the opening bank balance.`, href: '#/accounts/heads' });
  if (!op.cash && !op.bank) checks.push({ level: 'info', text: 'Opening cash and bank balances are not entered. Enter them once under Heads so balances match your records.', href: '#/accounts/heads' });
  return { from, to, fy: fyOf(from), income, expense, total_income_paise: totalIncome, total_expense_paise: totalExpense, surplus_paise: totalIncome - totalExpense,
    cash_paise: cashBal, bank_book_paise: bankBook, bank_stmt_paise: lastStmt ? lastStmt.balance_paise : null, bank_stmt_date: lastStmt ? lastStmt.txn_date : null, unposted, opening: op,
    receivables: rec, receivable_paise: recv, advances_paise: adv, payables: pay, payable_paise: payables, assets_paise: assets, liabilities_paise: liabilities, capital_paise: capital,
    trial, months, income_m: mat('income'), expense_m: mat('expense'), rows, checks };
}

const range = (q) => {
  const today = todayStr();
  let fy = L.int(q.fy); if (!fy) fy = fyOf(today);
  const from = L.isDate(q.from) ? q.from : `${fy}-04-01`, to = L.isDate(q.to) ? q.to : (q.from ? today : `${fy + 1}-03-31`);
  return { from, to: to < from ? from : to };
};

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  app.get('/api/books', BILL, (req, res) => { const r = range(req.query); res.json(build(T(req), r.from, r.to)); });

  app.get('/api/books/heads', BILL, (req, res) => res.json({ heads: heads(T(req)), opening: opening(T(req)) }));
  app.post('/api/books/heads', L.need('admin', 'accounts'), (req, res) => {
    const name = L.str(req.body.name, 60), grp = req.body.grp === 'income' ? 'income' : 'expense', kw = L.str(req.body.keywords, 400).toLowerCase();
    if (!L.must(res, name, 'Enter the head name.')) return;
    heads(T(req));
    if (!L.must(res, !db.prepare('SELECT 1 FROM acc_heads WHERE tenant_id=? AND lower(name)=lower(?)').get(T(req), name), 'This head already exists.')) return;
    const id = db.prepare('INSERT INTO acc_heads(tenant_id,name,grp,keywords,sys,sort) VALUES (?,?,?,?,0,500)').run(T(req), name, grp, kw).lastInsertRowid;
    audit(T(req), req.user.id, 'acc_head_added', 'acc_head', id, name, L.ip(req)); res.json({ id });
  });
  app.put('/api/books/heads/:id', L.need('admin', 'accounts'), (req, res) => {
    const h = db.prepare('SELECT * FROM acc_heads WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!h) return res.status(404).json({ error: 'Not found.' });
    const name = h.sys ? h.name : (L.str(req.body.name, 60) || h.name);
    db.prepare('UPDATE acc_heads SET name=?, keywords=? WHERE id=?').run(name, L.str(req.body.keywords, 400).toLowerCase(), h.id); res.json({ ok: true });
  });
  app.delete('/api/books/heads/:id', L.need('admin', 'accounts'), (req, res) => {
    const h = db.prepare('SELECT * FROM acc_heads WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!h) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, !h.sys, 'The standard heads cannot be deleted. You can change their keywords.')) return;
    db.prepare('DELETE FROM acc_heads WHERE id=?').run(h.id); res.json({ ok: true });
  });
  app.put('/api/books/opening', L.need('admin', 'accounts'), (req, res) => {
    const c = Math.round(Number(req.body.cash || 0) * 100), b = Math.round(Number(req.body.bank || 0) * 100);
    if (!L.must(res, Number.isFinite(c) && Number.isFinite(b) && Math.abs(c) < 1e12 && Math.abs(b) < 1e12, 'Enter valid amounts.')) return;
    AI.setS(T(req), 'acc_open_cash', String(c)); AI.setS(T(req), 'acc_open_bank', String(b));
    audit(T(req), req.user.id, 'acc_opening_set', 'firm', T(req), c + '/' + b, L.ip(req)); res.json({ ok: true });
  });

  // Excel workbook for the firm's own evaluation and for the Chartered Accountant
  app.get('/api/books/export.xlsx', BILL, async (req, res) => {
    const r = range(req.query), t = T(req), B = build(t, r.from, r.to), R = (p) => p / 100, h = (x) => ({ v: x, b: true });
    const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '';
    const title = [[h(firm)], [`Accounts for ${r.from} to ${r.to}`], []];
    const sheets = [
      { name: 'Income and expenditure', rows: [...title, [h('Income'), h('Amount (₹)')], ...B.income.map((x) => [x.head, R(x.paise)]), [h('Total income'), { v: R(B.total_income_paise), b: true }], [], [h('Expenditure'), h('Amount (₹)')], ...B.expense.map((x) => [x.head, R(x.paise)]), [h('Total expenditure'), { v: R(B.total_expense_paise), b: true }], [], [h(B.surplus_paise >= 0 ? 'Surplus for the period' : 'Deficit for the period'), { v: R(B.surplus_paise), b: true }]] },
      { name: 'Statement of affairs', rows: [...title, [h('As on ' + r.to)], [h('Assets')], ['Cash in hand', R(B.cash_paise)], ['Bank (as per books)', R(B.bank_book_paise)], ['Fees receivable from clients', R(B.receivable_paise)], [h('Total assets'), { v: R(B.assets_paise), b: true }], [], [h('Liabilities')], ['Advances received from clients', R(B.advances_paise)], ['Payments due to others', R(B.payable_paise)], [h('Total liabilities'), { v: R(B.liabilities_paise), b: true }], [], [h('Net worth (capital and accumulated surplus)'), { v: R(B.capital_paise), b: true }]] },
      { name: 'Trial balance', rows: [...title, [h('Account'), h('Debit (₹)'), h('Credit (₹)')], ...B.trial.map((x) => [x.name, x.dr ? R(x.dr) : '', x.cr ? R(x.cr) : '']), [h('Total'), { v: R(B.trial.reduce((s, x) => s + x.dr, 0)), b: true }, { v: R(B.trial.reduce((s, x) => s + x.cr, 0)), b: true }]] },
      { name: 'Day book', rows: [...title, ['Date', 'Voucher', 'Account', 'Head', 'Party', 'Particulars', 'Receipt (₹)', 'Payment (₹)'].map(h), ...B.rows.map((x) => [x.date, x.ref, x.acct === 'cash' ? 'Cash' : 'Bank', x.head, x.party, x.narr, x.kind === 'in' ? R(x.paise) : '', x.kind === 'out' ? R(x.paise) : ''])] },
      { name: 'Head-wise by month', rows: [...title, [h('Head'), ...B.months.map(h), h('Total')], ...[...B.income_m, ...B.expense_m].map((x) => [x.head, ...B.months.map((m) => R(x.m[m] || 0)), R(Object.values(x.m).reduce((s, v) => s + v, 0))])] },
      { name: 'Receivables', rows: [...title, ['Client', 'Total due', '0-30 days', '31-60', '61-90', 'Over 90', 'Advance held'].map(h), ...B.receivables.map((x) => [x.name, R(x.due_paise), R(x.b0), R(x.b1), R(x.b2), R(x.b3), R(x.advance_paise)])] },
      { name: 'Payables', rows: [...title, ['Due date', 'Payee', 'Purpose', 'Amount (₹)'].map(h), ...B.payables.map((x) => [x.due_date, x.payee, x.head, R(x.amount_paise)])] },
    ];
    try {
      const buf = await X.build(sheets);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="accounts-${r.from}-to-${r.to}.xlsx"` }); res.send(buf);
    } catch (e) { console.error('xlsx', e.message); res.status(500).json({ error: 'Could not build the workbook.' }); }
  });
};
Object.assign(module.exports, { build, rowsOf, heads, classifier, receivables, DEFAULT_HEADS });
