'use strict';
// Accounts > Reports centre: the reports a law firm needs (chosen from the report list of Zoho Books), the final accounts
// (Profit and Loss, Income and Expenditure, Balance Sheet, Cash Flow), and the tax-audit working paper for the Chartered
// Accountant (Form 3CA/3CB-3CD up to FY 2025-26, Form No. 26 from FY 2026-27). Every report downloads as Word or PDF and
// can be sent at once by e-mail (attached) or WhatsApp (private link, valid 14 days). Built only from the firm's own books.
const crypto = require('crypto');
const L = require('../lib'); const AI = require('../aicore'); const X = require('../exportdoc'); const WA = require('./whatsapp');
const B = require('./books');
const { db, audit } = L;
const BILL = L.need('admin', 'advocate', 'accounts');
const T = (req) => req.user.tenant_id;
const base = () => (process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');
db.exec('CREATE TABLE IF NOT EXISTS report_shares (token TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, type TEXT, from_d TEXT, to_d TEXT, opts TEXT, created_at TEXT DEFAULT (datetime(\'now\')), expires_at TEXT)');

// The catalogue: grouped as in the Zoho Books Reports Centre, limited to what a law firm uses.
const CATALOG = [
  ['Final accounts', [['pl', 'Profit and Loss Account', 'Professional income less expenses, with last year alongside'], ['ie', 'Income and Expenditure Account', 'Receipts-based statement, expenditure on the left and income on the right'], ['bs', 'Balance Sheet', 'What the firm owns and owes on the last day, with capital'], ['cf', 'Cash Flow Statement', 'Cash and bank received and paid, opening to closing']]],
  ['Accountant', [['tb', 'Trial Balance', 'Debit and credit totals of every account'], ['day', 'Day Book', 'Every receipt and payment in date order'], ['ledger', 'General Ledger (by head)', 'All entries under each income and expense head']]],
  ['Receivables (clients)', [['ar', 'Fees Receivable — ageing', 'Who owes how much, by age, with advances held'], ['rec', 'Receipts register', 'Every receipt issued, with mode and reference'], ['cust', 'Client-wise fees summary', 'Fees received from each client in the period']]],
  ['Payables and expenses', [['pay', 'Payments due', 'Amounts due to payees, vendors and staff'], ['exp', 'Expense details', 'Every payment, by head, with party and narration']]],
  ['Compliance', [['tax', 'Tax Audit working paper (Form 3CA/3CB-3CD or Form 26)', 'Draft statement of particulars for the Chartered Accountant'], ['hygiene', 'Books health check', 'Unposted bank entries, drafts, old dues, missing balances']]],
];
const TYPES = CATALOG.flatMap((g) => g[1].map((x) => x[0]));
const rs = (p) => (p === 0 || p == null ? '' : (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const rs0 = (p) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d) => (d ? d.split('-').reverse().join('-') : '');
const fyOf = (d) => { const y = +d.slice(0, 4); return +d.slice(5, 7) >= 4 ? y : y - 1; };
const fyLabel = (y) => `${y}-${String(y + 1).slice(2)}`;
const dayBefore = (d) => new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);
const prevYear = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;
const firmName = (t) => (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '';
const prof = (t) => { const g = (k) => AI.getS(t, 'ta_' + k, ''); return { pan: g('pan'), gstin: g('gstin'), address: g('address'), status: g('status') || 'Firm', partners: g('partners'), practice: g('practice') || 'Legal practice (advocates)', method: g('method') || 'Cash', ca: g('ca_name'), ca_email: g('ca_email'), ca_phone: g('ca_phone'), law_audit: g('law_audit') === '1' }; };
const rangeOf = (q) => { const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10); let fy = L.int(q.fy); if (!fy) fy = fyOf(today); const from = L.isDate(q.from) ? q.from : `${fy}-04-01`, to = L.isDate(q.to) ? q.to : (q.from ? today : `${fy + 1}-03-31`); return { from, to: to < from ? from : to }; };

function opening(t, from) { const o = B.build(t, '0000-01-01', dayBefore(from)); return { cash: o.cash_paise, bank: o.bank_book_paise, cap: o.capital_paise }; }
const tbl = (heading, cols, rows, text) => ({ heading, cols, rows, text });
const money = (h) => ({ h, w: 2 });

function spec(t, type, from, to, opts = {}) {
  const b = B.build(t, from, to), firm = firmName(t), per = `For the period ${dmy(from)} to ${dmy(to)}`, asof = `As on ${dmy(to)}`, S = [];
  const meta = (title, sub) => ({ firm, title, subtitle: sub, sections: S });
  if (type === 'pl' || type === 'ie') {
    const pb = B.build(t, prevYear(from), prevYear(to)), pm = (arr) => Object.fromEntries(arr.map((x) => [x.head, x.paise]));
    const pi = pm(pb.income), pe = pm(pb.expense), heads = (cur, prv) => [...new Set([...cur.map((x) => x.head), ...Object.keys(prv)])];
    const ih = heads(b.income, pi), eh = heads(b.expense, pe), ci = Object.fromEntries(b.income.map((x) => [x.head, x.paise])), ce = Object.fromEntries(b.expense.map((x) => [x.head, x.paise]));
    if (type === 'pl') {
      S.push(tbl('Income', [{ h: 'Particulars', w: 5 }, money('Current period (Rs.)'), money('Previous year (Rs.)')], [...ih.map((h) => [h, rs(ci[h]), rs(pi[h])]), ['Total income', rs0(b.total_income_paise), rs0(pb.total_income_paise)]]));
      S.push(tbl('Expenses', [{ h: 'Particulars', w: 5 }, money('Current period (Rs.)'), money('Previous year (Rs.)')], [...eh.map((h) => [h, rs(ce[h]), rs(pe[h])]), ['Total expenses', rs0(b.total_expense_paise), rs0(pb.total_expense_paise)]]));
      S.push(tbl('Result', [{ h: 'Particulars', w: 5 }, money('Current period (Rs.)'), money('Previous year (Rs.)')], [[b.surplus_paise >= 0 ? 'Net profit for the period' : 'Net loss for the period', rs0(Math.abs(b.surplus_paise)), rs0(Math.abs(pb.surplus_paise))]]));
      S.push({ text: 'Prepared from the firm\'s receipts, cash book, payments and posted bank entries. Fees are shown as received; billed but unpaid fees appear in the Balance Sheet as receivable. No depreciation or provisions are included unless entered as an expense head.' });
      return meta('Profit and Loss Account', per);
    }
    const n = Math.max(ih.length, eh.length), rows = [];
    for (let i = 0; i < n; i++) rows.push([eh[i] ? `To ${eh[i]}` : '', eh[i] ? rs(ce[eh[i]]) : '', ih[i] ? `By ${ih[i]}` : '', ih[i] ? rs(ci[ih[i]]) : '']);
    rows.push(['Total expenditure', rs0(b.total_expense_paise), 'Total income', rs0(b.total_income_paise)], b.surplus_paise >= 0 ? ['To surplus carried to capital', rs0(b.surplus_paise), '', ''] : ['', '', 'By deficit carried to capital', rs0(-b.surplus_paise)]);
    S.push(tbl('Income and Expenditure Account', [{ h: 'Expenditure', w: 4 }, money('Rs.'), { h: 'Income', w: 4 }, money('Rs.')], rows));
    return meta('Income and Expenditure Account', per);
  }
  if (type === 'bs') {
    const o = opening(t, from), openCap = b.capital_paise - b.surplus_paise;
    S.push(tbl('Liabilities', [{ h: 'Particulars', w: 5 }, money('Rs.')], [['Capital account — opening balance (including earlier years)', rs0(openCap)], [b.surplus_paise >= 0 ? 'Add: net profit for the period' : 'Less: net loss for the period', rs0(Math.abs(b.surplus_paise))], ['Capital account — closing', rs0(b.capital_paise)], ['Advances received from clients', rs0(b.advances_paise)], ['Payments due to others', rs0(b.payable_paise)], ['Total liabilities and capital', rs0(b.capital_paise + b.advances_paise + b.payable_paise)]]));
    S.push(tbl('Assets', [{ h: 'Particulars', w: 5 }, money('Rs.')], [['Cash in hand', rs0(b.cash_paise)], ['Bank balance (as per books)', rs0(b.bank_book_paise)], ['Fees receivable from clients', rs0(b.receivable_paise)], ['Total assets', rs0(b.assets_paise)]]));
    S.push({ text: 'Fixed assets (furniture, computers) and depreciation are not kept in the portal; add them from the firm\'s asset register before the accounts are finalised. Opening capital is the balancing figure of earlier years.' });
    return meta('Balance Sheet', asof);
  }
  if (type === 'cf') {
    const o = opening(t, from), rin = {}, rout = {};
    b.rows.forEach((r) => { const m = r.kind === 'in' ? rin : rout; m[r.head] = (m[r.head] || 0) + r.paise; });
    const totIn = Object.values(rin).reduce((s, v) => s + v, 0), totOut = Object.values(rout).reduce((s, v) => s + v, 0), open = o.cash + o.bank;
    S.push(tbl('Cash and bank received', [{ h: 'Particulars', w: 5 }, money('Rs.')], [['Opening cash and bank balance', rs0(open)], ...Object.entries(rin).map(([h, v]) => [h, rs0(v)]), ['Total received', rs0(open + totIn)]]));
    S.push(tbl('Cash and bank paid', [{ h: 'Particulars', w: 5 }, money('Rs.')], [...Object.entries(rout).map(([h, v]) => [h, rs0(v)]), ['Total paid', rs0(totOut)], ['Closing cash and bank balance', rs0(open + totIn - totOut)]]));
    return meta('Cash Flow Statement', per);
  }
  if (type === 'tb') { S.push(tbl('Trial balance', [{ h: 'Account', w: 6 }, money('Debit (Rs.)'), money('Credit (Rs.)')], [...b.trial.map((x) => [x.name, rs(x.dr), rs(x.cr)]), ['Total', rs0(b.trial.reduce((s, x) => s + x.dr, 0)), rs0(b.trial.reduce((s, x) => s + x.cr, 0))]])); return meta('Trial Balance', asof); }
  if (type === 'day') { S.push(tbl('Day book', [{ h: 'Date', w: 2 }, { h: 'Voucher', w: 2 }, { h: 'A/c', w: 1 }, { h: 'Head', w: 3 }, { h: 'Party and particulars', w: 5 }, money('Receipt'), money('Payment')], b.rows.map((x) => [dmy(x.date), x.ref, x.acct === 'cash' ? 'Cash' : 'Bank', x.head, [x.party, x.narr].filter(Boolean).join(' — '), x.kind === 'in' ? rs(x.paise) : '', x.kind === 'out' ? rs(x.paise) : '']))); return meta('Day Book', per); }
  if (type === 'ledger') {
    const by = {}; b.rows.forEach((r) => (by[r.head] = by[r.head] || []).push(r));
    Object.keys(by).sort().forEach((h) => S.push(tbl(h, [{ h: 'Date', w: 2 }, { h: 'Particulars', w: 6 }, money('Receipt'), money('Payment')], [...by[h].map((x) => [dmy(x.date), [x.party, x.narr].filter(Boolean).join(' — '), x.kind === 'in' ? rs(x.paise) : '', x.kind === 'out' ? rs(x.paise) : '']), ['Total', '', rs0(by[h].filter((x) => x.kind === 'in').reduce((s, x) => s + x.paise, 0)), rs0(by[h].filter((x) => x.kind === 'out').reduce((s, x) => s + x.paise, 0))]])));
    if (!S.length) S.push({ text: 'No entries in this period.' }); return meta('General Ledger by Head', per);
  }
  if (type === 'ar') { S.push(tbl('Fees receivable', [{ h: 'Client', w: 4 }, money('Total due'), money('0-30 days'), money('31-60'), money('61-90'), money('Over 90'), money('Advance held')], [...b.receivables.map((x) => [x.name, rs(x.due_paise), rs(x.b0), rs(x.b1), rs(x.b2), rs(x.b3), rs(x.advance_paise)]), ['Total', rs0(b.receivable_paise), '', '', '', '', rs0(b.advances_paise)]])); return meta('Fees Receivable — Ageing', asof); }
  if (type === 'rec') { const r = b.rows.filter((x) => x.src === 'payment'); S.push(tbl('Receipts', [{ h: 'Date', w: 2 }, { h: 'Receipt no.', w: 2 }, { h: 'Client', w: 4 }, { h: 'Mode and reference', w: 4 }, money('Amount')], [...r.map((x) => [dmy(x.date), x.ref, x.party, x.narr, rs0(x.paise)]), ['Total', '', '', '', rs0(r.reduce((s, x) => s + x.paise, 0))]])); return meta('Receipts Register', per); }
  if (type === 'cust') { const m = {}; b.rows.filter((x) => x.src === 'payment').forEach((x) => (m[x.party || '(no client)'] = (m[x.party || '(no client)'] || 0) + x.paise)); S.push(tbl('Fees received', [{ h: 'Client', w: 6 }, money('Received (Rs.)')], [...Object.entries(m).sort((a, c) => c[1] - a[1]).map(([k, v]) => [k, rs0(v)]), ['Total', rs0(Object.values(m).reduce((s, v) => s + v, 0))]])); return meta('Client-wise Fees Summary', per); }
  if (type === 'pay') { S.push(tbl('Payments due', [{ h: 'Due date', w: 2 }, { h: 'Payee', w: 4 }, { h: 'For', w: 4 }, money('Amount')], [...b.payables.map((x) => [dmy(x.due_date), x.payee, x.head, rs0(x.amount_paise)]), ['Total', '', '', rs0(b.payable_paise)]])); return meta('Payments Due', asof); }
  if (type === 'exp') { const r = b.rows.filter((x) => x.grp === 'expense' && x.kind === 'out'); S.push(tbl('Expenses', [{ h: 'Date', w: 2 }, { h: 'Head', w: 4 }, { h: 'Party and particulars', w: 6 }, money('Amount')], [...r.map((x) => [dmy(x.date), x.head, [x.party, x.narr].filter(Boolean).join(' — '), rs0(x.paise)]), ['Total', '', '', rs0(r.reduce((s, x) => s + x.paise, 0))]])); return meta('Expense Details', per); }
  if (type === 'hygiene') { S.push(tbl('Findings', [{ h: 'Level', w: 1 }, { h: 'Finding', w: 8 }], b.checks.length ? b.checks.map((c) => [c.level === 'warn' ? 'Check' : 'Note', c.text]) : [['OK', 'No problems found in the books for this period.']])); return meta('Books Health Check', per); }
  if (type === 'tax') return taxSpec(t, b, from, to, opts);
  throw Object.assign(new Error('Unknown report.'), { status: 400 });
}

// Tax-audit working paper. The audit report and the filing are the Chartered Accountant's; this prepares the figures and particulars from the books.
function taxSpec(t, b, from, to, opts) {
  const p = prof(t), fy = fyOf(from), firm = firmName(t), newAct = fy >= 2026, law = !!(opts.law_audit != null ? opts.law_audit : p.law_audit);
  const formName = newAct ? 'Form No. 26 — audit report and statement of particulars under section 63 of the Income-tax Act, 2025 (Rule 47, Income-tax Rules, 2026)' : `Form No. 3${law ? 'CA' : 'CB'} with Form No. 3CD — audit report and statement of particulars under section 44AB of the Income-tax Act, 1961 (Rule 6G)`;
  const part = newAct ? (law ? 'Part C (corresponds to the old Form 3CA)' : 'Part D (corresponds to the old Form 3CB)') : (law ? 'Form 3CA' : 'Form 3CB');
  const cash10k = b.rows.filter((r) => r.kind === 'out' && r.acct === 'cash' && r.paise >= 1000000), gross = b.total_income_paise;
  const dues = b.expense.filter((x) => /statutory|dues|tax|gst|tds/i.test(x.head));
  const S = [];
  S.push({ heading: 'Read this first', text: `This is a working paper prepared from the firm's books for the Chartered Accountant. It is not the audit report and is not filed from the portal. The report is signed by the accountant and furnished on the income tax e-filing portal.\nForm for this period: ${formName}. ${newAct ? 'From the tax year that begins on 1 April 2026 the single Form No. 26 replaces Forms 3CA, 3CB and 3CD.' : 'Forms 3CA, 3CB and 3CD continue for financial years up to 2025-26 (assessment year 2026-27).'}\nBecause the firm\'s accounts are ${law ? '' : 'not '}audited under any other law, the audit report goes in ${part}, with the statement of particulars.\nNote: Form 3CA-3CD is an Income Tax Department form (not an MCA form). Check the clause numbers against the current utility on the e-filing portal before signing.` });
  S.push({ heading: 'Particulars of the assessee', kv: [['Name', firm], ['Address', p.address || 'To be filled (Firm settings, Tax audit details)'], ['PAN', p.pan || 'To be filled'], ['GSTIN (indirect tax registration)', p.gstin || 'To be filled / not registered'], ['Status', p.status], ['Previous year', `${dmy(from)} to ${dmy(to)}`], ['Assessment year', newAct ? 'Not applicable (tax year ' + fyLabel(fy) + ' under the Income-tax Act, 2025)' : `${fy + 1}-${String(fy + 2).slice(2)}`], ['Partners / members and profit shares', p.partners || 'To be filled'], ['Nature of profession', p.practice], ['Method of accounting', p.method], ['Chartered Accountant', [p.ca, p.ca_email, p.ca_phone].filter(Boolean).join(' · ') || 'Not recorded']] });
  S.push({ heading: 'Is a tax audit needed? (for the accountant to confirm)', kv: [['Gross receipts of the profession in the period', 'Rs. ' + rs0(gross)], ['Note', 'For a professional the 1961 Act requires audit where gross receipts exceed Rs. 50 lakh. The 2025 Act\'s section 63 limits should be confirmed from the Act. Presumptive taxation, if opted for, changes this.']] });
  S.push(tbl('Figures from the books (clause-wise)', [{ h: 'Clause', w: 1 }, { h: 'Matter', w: 5 }, { h: 'From the portal', w: 6 }], [
    ['8', 'Section of the Act under which the audit is conducted', newAct ? 'Section 63' : 'Section 44AB(b) (profession)'],
    ['11', 'Books of account maintained', 'Receipts and invoices, cash book, payments, bank statement entries, day book, ledger (see the Audit pack)'],
    ['13', 'Method of accounting', p.method + '. The portal records fees when received and tracks billed but unpaid fees as receivable.'],
    ['18', 'Depreciation', 'Not kept in the portal. Fill from the fixed-asset schedule.'],
    ['21', 'Expenses on which disallowance may arise', `Cash payments of Rs. 10,000 or more on one day, to review under section 40A(3): ${cash10k.length} entry(ies), Rs. ${rs0(cash10k.reduce((s, x) => s + x.paise, 0))}. Personal or club expenses: review the heads below.`],
    ['22', 'Interest under the MSME Development Act', 'Not kept in the portal. Fill from payee dues.'],
    ['23', 'Payments to related persons (partners, relatives)', 'Review payee payments to partners; not separately tagged in the portal.'],
    ['26', 'Section 43B items (statutory dues paid or unpaid)', dues.length ? dues.map((x) => `${x.head}: Rs. ${rs0(x.paise)}`).join('; ') : 'No statutory-dues head recorded. Unpaid payments due at the year end: Rs. ' + rs0(b.payable_paise)],
    ['31', 'Loans, deposits and receipts of Rs. 20,000 or more in cash (sections 269SS, 269T, 269ST)', 'Review the cash entries in the Day Book and the list below.'],
    ['34', 'TDS / TCS compliance', 'Not kept in the portal. Fill from Forms 24Q/26Q and the TRACES statements.'],
    ['40', 'Accounting ratios', `Gross receipts Rs. ${rs0(gross)}; expenses Rs. ${rs0(b.total_expense_paise)}; net profit Rs. ${rs0(b.surplus_paise)}; net profit to gross receipts ${gross ? (b.surplus_paise / gross * 100).toFixed(2) + '%' : 'not applicable'}`],
    ['44', 'GST-wise break-up of expenditure', 'Not kept in the portal. Fill from purchase invoices.'],
  ]));
  S.push(tbl('Annexure A — Profit and Loss (summary)', [{ h: 'Particulars', w: 5 }, money('Rs.')], [...b.income.map((x) => [x.head, rs0(x.paise)]), ['Total income', rs0(b.total_income_paise)], ...b.expense.map((x) => [x.head, rs0(x.paise)]), ['Total expenses', rs0(b.total_expense_paise)], [b.surplus_paise >= 0 ? 'Net profit' : 'Net loss', rs0(Math.abs(b.surplus_paise))]]));
  S.push(tbl('Annexure B — Position at the end of the period', [{ h: 'Particulars', w: 5 }, money('Rs.')], [['Cash in hand', rs0(b.cash_paise)], ['Bank (as per books)', rs0(b.bank_book_paise)], ['Fees receivable', rs0(b.receivable_paise)], ['Advances held for clients', rs0(b.advances_paise)], ['Payments due to others', rs0(b.payable_paise)], ['Capital and accumulated surplus', rs0(b.capital_paise)]]));
  S.push(tbl('Annexure C — Cash payments of Rs. 10,000 or more', [{ h: 'Date', w: 2 }, { h: 'Head', w: 3 }, { h: 'Party and particulars', w: 6 }, money('Rs.')], cash10k.length ? cash10k.map((x) => [dmy(x.date), x.head, [x.party, x.narr].filter(Boolean).join(' — '), rs0(x.paise)]) : [['', 'None', '', '']]));
  if (b.checks.length) S.push(tbl('Open points in the books', [{ h: 'Level', w: 1 }, { h: 'Point', w: 8 }], b.checks.map((c) => [c.level === 'warn' ? 'Check' : 'Note', c.text])));
  return { firm, title: `Tax Audit Working Paper — ${newAct ? 'Form 26' : 'Form 3CA/3CB-3CD'}`, subtitle: `Previous year ${dmy(from)} to ${dmy(to)}`, sections: S };
}

const fname = (type, from, to) => `${(CATALOG.flatMap((g) => g[1]).find((x) => x[0] === type) || [, 'Report'])[1].replace(/[^\w\- ()]/g, '').trim()} ${from} to ${to}`;
const fmtOf = (q) => (q.fmt === 'pdf' ? 'pdf' : 'docx');

module.exports = (app) => {
  app.get('/api/accounts/catalog', BILL, (req, res) => res.json({ groups: CATALOG.map(([g, l]) => ({ group: g, reports: l.map(([k, n, d]) => ({ key: k, name: n, about: d })) })), profile: prof(T(req)) }));
  app.get('/api/accounts/report', BILL, async (req, res) => {
    const type = String(req.query.type || ''); if (!TYPES.includes(type)) return res.status(400).json({ error: 'Unknown report.' });
    const r = rangeOf(req.query), f = fmtOf(req.query);
    try { const s = spec(T(req), type, r.from, r.to, { law_audit: req.query.law === '1' ? true : req.query.law === '0' ? false : null }); audit(T(req), req.user.id, 'acc_report_' + type, 'report', 0, r.from + '..' + r.to, L.ip(req)); X.send(res, await X.build(s, f), f, fname(type, r.from, r.to)); }
    catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not build the report.' }); }
  });
  app.put('/api/accounts/taxaudit/profile', L.need('admin', 'accounts'), (req, res) => {
    const b = req.body || {}, t = T(req);
    for (const k of ['pan', 'gstin', 'address', 'status', 'partners', 'practice', 'method', 'ca_name', 'ca_email', 'ca_phone']) if (b[k] != null) AI.setS(t, 'ta_' + k, L.str(b[k], 600));
    if (b.law_audit != null) AI.setS(t, 'ta_law_audit', b.law_audit ? '1' : '0'); res.json({ ok: true, profile: prof(t) });
  });
  // send now: e-mail (attached) or WhatsApp (private link)
  app.post('/api/accounts/report/send', BILL, async (req, res) => {
    const t = T(req), b = req.body || {}, type = String(b.type || ''); if (!TYPES.includes(type)) return res.status(400).json({ error: 'Unknown report.' });
    const r = rangeOf(b), f = fmtOf(b), firm = firmName(t), name = fname(type, r.from, r.to), note = L.str(b.message, 800);
    try {
      if (b.channel === 'email') {
        const M = require('./aimail'), to = String(b.to || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid e-mail address.' });
        if (!M.mailReady(t)) return res.status(409).json({ error: 'E-mail sending is not set up for your firm.' });
        const buf = await X.build(spec(t, type, r.from, r.to, {}), f);
        await M.sendMail(t, { to, subject: `${name} — ${firm}`, text: `${note ? note + '\n\n' : ''}Please find attached: ${name}.\n\n${firm}`, attachments: [{ filename: name + '.' + f, content: buf }] });
        audit(t, req.user.id, 'acc_report_emailed', 'report', 0, type + ' to ' + to, L.ip(req)); return res.json({ ok: true, sent: 'email' });
      }
      if (b.channel === 'whatsapp') {
        const to = WA.normPhone(b.to); if (!to) return res.status(400).json({ error: 'Enter a valid mobile number.' });
        const tok = crypto.randomBytes(18).toString('hex'); db.prepare("INSERT INTO report_shares(token,tenant_id,type,from_d,to_d,opts,expires_at) VALUES (?,?,?,?,?,?,datetime('now','+14 days'))").run(tok, t, type, r.from, r.to, JSON.stringify({ fmt: f }));
        const link = `${base()}/api/public/report/${tok}.${f}`, text = `${note ? note + '\n' : ''}${name} — ${firm}\nDownload (valid for 14 days): ${link}`;
        audit(t, req.user.id, 'acc_report_whatsapp', 'report', 0, type + ' to ' + to, L.ip(req)); return res.json({ ok: true, sent: 'whatsapp-link', wa_link: `https://wa.me/${to}?text=${encodeURIComponent(text)}` });
      }
      res.status(400).json({ error: 'Choose e-mail or WhatsApp.' });
    } catch (e) { res.status(500).json({ error: String(e.message || 'Could not send.').slice(0, 200) }); }
  });
  app.get('/api/public/report/:file', async (req, res) => {
    const m = /^([0-9a-f]{36})\.(pdf|docx)$/.exec(req.params.file); if (!m) return res.status(404).json({ error: 'Not found.' });
    const s = db.prepare("SELECT * FROM report_shares WHERE token=? AND expires_at>datetime('now')").get(m[1]); if (!s) return res.status(404).json({ error: 'This link has expired or is not valid.' });
    try { X.send(res, await X.build(spec(s.tenant_id, s.type, s.from_d, s.to_d, {}), m[2]), m[2], fname(s.type, s.from_d, s.to_d)); } catch (e) { res.status(500).json({ error: 'Could not build the report.' }); }
  });
};
Object.assign(module.exports, { spec, CATALOG, rangeOf });
