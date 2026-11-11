'use strict';
/* ===== Accounts: reports, audit pack for the Chartered Accountant, heads ===== */
const accFYs = () => { const n = new Date(), y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return [y, y - 1, y - 2, y - 3]; };
const accN = (p) => (p === 0 || p == null ? '' : inr(p));
const accCsv = (rows, name) => {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const out = [['Date', 'Voucher', 'Account', 'Head', 'Party', 'Particulars', 'Receipt', 'Payment'], ...rows.map((x) => [x.date, x.ref, x.acct, x.head, x.party, x.narr, x.kind === 'in' ? x.paise / 100 : '', x.kind === 'out' ? x.paise / 100 : ''])].map((r) => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + out], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const accQ = (p) => { const fy = p.get('fy'), f = p.get('from'), t = p.get('to'); return f && t ? `from=${f}&to=${t}` : `fy=${fy || accFYs()[0]}`; };
const accPeriodBar = (p, tab) => `<form class="row noprint" id="pf" style="margin-bottom:.8rem;gap:.5rem;flex-wrap:wrap"><label class="mute">Financial year</label><select name="fy">${accFYs().map((y) => `<option value="${y}" ${String(p.get('fy') || accFYs()[0]) === String(y) && !p.get('from') ? 'selected' : ''}>${y}-${String(y + 1).slice(2)}</option>`).join('')}</select>
  <span class="mute">or dates</span><input type="date" name="from" value="${p.get('from') || ''}" style="width:auto"><input type="date" name="to" value="${p.get('to') || ''}" style="width:auto"><button class="btn ghost sm">Show</button></form>`;
const accBind = (tab) => { const f = $('#pf'); if (f) f.onsubmit = (e) => { e.preventDefault(); const v = e.target; location.hash = `#/accounts/${tab}?` + (v.from.value && v.to.value ? `from=${v.from.value}&to=${v.to.value}` : `fy=${v.fy.value}`); }; };

function accIE(B) {
  return `<table><tr><th colspan="2">Income (fees and other receipts)</th></tr>${B.income.map((x) => `<tr><td>${esc(x.head)}</td><td class="n">${inr(x.paise)}</td></tr>`).join('') || '<tr><td colspan="2" class="mute">None</td></tr>'}
    <tr><td><b>Total income</b></td><td class="n"><b>${inr(B.total_income_paise)}</b></td></tr>
    <tr><th colspan="2">Expenditure</th></tr>${B.expense.map((x) => `<tr><td>${esc(x.head)}</td><td class="n">${inr(x.paise)}</td></tr>`).join('') || '<tr><td colspan="2" class="mute">None</td></tr>'}
    <tr><td><b>Total expenditure</b></td><td class="n"><b>${inr(B.total_expense_paise)}</b></td></tr>
    <tr><td><b>${B.surplus_paise >= 0 ? 'Surplus' : 'Deficit'} for the period</b></td><td class="n"><b>${inr(Math.abs(B.surplus_paise))}</b></td></tr></table>`;
}
const accSOA = (B) => `<table><tr><th colspan="2">Position as on ${dt(B.to)}</th></tr>
  <tr><td>Cash in hand</td><td class="n">${inr(B.cash_paise)}</td></tr><tr><td>Bank (as per books)</td><td class="n">${inr(B.bank_book_paise)}</td></tr><tr><td>Fees receivable from clients</td><td class="n">${inr(B.receivable_paise)}</td></tr>
  <tr><td><b>Total assets</b></td><td class="n"><b>${inr(B.assets_paise)}</b></td></tr>
  <tr><td>Advances held for clients</td><td class="n">${inr(B.advances_paise)}</td></tr><tr><td>Payments due to others</td><td class="n">${inr(B.payable_paise)}</td></tr>
  <tr><td><b>Total liabilities</b></td><td class="n"><b>${inr(B.liabilities_paise)}</b></td></tr><tr><td><b>Net worth (capital and accumulated surplus)</b></td><td class="n"><b>${inr(B.capital_paise)}</b></td></tr></table>`;
const accMonths = (B) => { const hd = (m) => `<th class="n">${m}</th>`, row = (x) => `<tr><td>${esc(x.head)}</td>${B.months.map((m) => `<td class="n">${accN(x.m[m] || 0)}</td>`).join('')}<td class="n"><b>${inr(Object.values(x.m).reduce((s, v) => s + v, 0))}</b></td></tr>`;
  return B.months.length ? `<div class="tw"><table><tr><th>Head</th>${B.months.map(hd).join('')}<th class="n">Total</th></tr><tr><td colspan="${B.months.length + 2}"><b>Income</b></td></tr>${B.income_m.map(row).join('')}<tr><td colspan="${B.months.length + 2}"><b>Expenditure</b></td></tr>${B.expense_m.map(row).join('')}</table></div>` : '<p class="mute">No entries in this period.</p>'; };
const accRecv = (B) => B.receivables.length ? `<div class="tw"><table><tr><th>Client</th><th class="n">Total due</th><th class="n">0–30 days</th><th class="n">31–60</th><th class="n">61–90</th><th class="n">Over 90</th><th class="n">Advance held</th></tr>${B.receivables.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${accN(x.due_paise)}</td><td class="n">${accN(x.b0)}</td><td class="n">${accN(x.b1)}</td><td class="n">${accN(x.b2)}</td><td class="n">${accN(x.b3)}</td><td class="n">${accN(x.advance_paise)}</td></tr>`).join('')}
  <tr><td><b>Total</b></td><td class="n"><b>${inr(B.receivable_paise)}</b></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"><b>${inr(B.advances_paise)}</b></td></tr></table></div>` : '<p class="mute">Nothing receivable.</p>';
const accPay = (B) => B.payables.length ? `<div class="tw"><table><tr><th>Due</th><th>Payee</th><th>For</th><th class="n">Amount</th></tr>${B.payables.map((x) => `<tr><td>${dt(x.due_date)}</td><td>${esc(x.payee)}</td><td>${esc(x.head)}</td><td class="n">${inr(x.amount_paise)}</td></tr>`).join('')}<tr><td colspan="3"><b>Total</b></td><td class="n"><b>${inr(B.payable_paise)}</b></td></tr></table></div>` : '<p class="mute">Nothing due.</p>';
const accTrial = (B) => `<div class="tw"><table><tr><th>Account</th><th class="n">Debit</th><th class="n">Credit</th></tr>${B.trial.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${accN(x.dr)}</td><td class="n">${accN(x.cr)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="n"><b>${inr(B.trial.reduce((s, x) => s + x.dr, 0))}</b></td><td class="n"><b>${inr(B.trial.reduce((s, x) => s + x.cr, 0))}</b></td></tr></table></div>`;
const accDay = (rows) => rows.length ? `<div class="tw"><table><tr><th>Date</th><th>Voucher</th><th>A/c</th><th>Head</th><th>Party / particulars</th><th class="n">Receipt</th><th class="n">Payment</th></tr>${rows.map((x) => `<tr><td>${dt(x.date)}</td><td>${esc(x.ref)}</td><td>${x.acct === 'cash' ? 'Cash' : 'Bank'}</td><td>${esc(x.head)}</td><td>${esc([x.party, x.narr].filter(Boolean).join(' — '))}</td><td class="n">${x.kind === 'in' ? inr(x.paise) : ''}</td><td class="n">${x.kind === 'out' ? inr(x.paise) : ''}</td></tr>`).join('')}</table></div>` : '<p class="mute">No entries in this period.</p>';

async function accTab(tab, head, p) {
  if (tab === 'heads') return accHeads(head);
  const B = await GET('/api/books?' + accQ(p)), q = accQ(p);
  if (tab === 'audit') {
    const warn = B.checks.filter((c) => c.level === 'warn');
    return view(`${head}${accPeriodBar(p, 'audit')}<div class="card"><h2>Audit pack for the Chartered Accountant</h2>
      <p class="mute">Period ${dt(B.from)} to ${dt(B.to)}. The pack contains: income and expenditure, statement of affairs, trial balance, month-wise heads, receipts and payments registers, day book, fees receivable, payments due, bank reconciliation statement, a management certificate and a blank format of the audit report for your chartered accountant to complete. Everything is produced from the entries already in the portal.</p>
      ${B.checks.length ? `<h3>Before you hand it over</h3><ul class="list">${B.checks.map((c) => `<li><span>${c.level === 'warn' ? pill('check', 'bad') : pill('note')} ${esc(c.text)}</span><a class="btn sm ghost" href="${c.href}">Open</a></li>`).join('')}</ul>` : '<p>✔ Nothing needs attention.</p>'}
      ${warn.length ? '<p class="mute">Items marked “check” are worth fixing first, but you can still produce the pack.</p>' : ''}
      <div class="row" style="margin-top:.8rem"><a class="btn gold" href="#/auditpack?${q}">Open audit pack (print or save as PDF)</a><a class="btn ghost" href="/api/books/export.xlsx?${q}">Download Excel workbook</a></div></div>`), accBind('audit');
  }
  const cl = await GET('/api/clients'), cid = p.get('client'), led = cid ? await GET('/api/reports/ledger?client_id=' + cid) : null;
  view(`${head}${accPeriodBar(p, 'reports')}
    <div class="grid"><div class="stat"><b>${inr(B.total_income_paise)}</b><span>Income</span></div><div class="stat"><b>${inr(B.total_expense_paise)}</b><span>Expenditure</span></div><div class="stat ${B.surplus_paise < 0 ? 'alert' : ''}"><b>${inr(B.surplus_paise)}</b><span>${B.surplus_paise < 0 ? 'Deficit' : 'Surplus'}</span></div>
      <div class="stat"><b>${inr(B.cash_paise)}</b><span>Cash in hand</span></div><div class="stat"><b>${inr(B.bank_book_paise)}</b><span>Bank (books)</span></div><div class="stat"><b>${inr(B.receivable_paise)}</b><span>Fees receivable</span></div></div>
    ${B.checks.length ? `<div class="card"><h2>Needs a look</h2><ul class="list">${B.checks.map((c) => `<li><span>${c.level === 'warn' ? pill('check', 'bad') : pill('note')} ${esc(c.text)}</span><a class="btn sm ghost" href="${c.href}">Open</a></li>`).join('')}</ul></div>` : ''}
    <div class="row noprint" style="margin:.6rem 0"><button class="btn sm" data-print>Print</button><a class="btn sm ghost" href="/api/books/export.xlsx?${q}">Excel</a><button class="btn sm ghost" id="csv">Day book as CSV</button></div>
    <div class="card"><h2>Income and expenditure</h2><div class="tw">${accIE(B)}</div><p class="mute">Prepared on a receipts-and-payments basis from receipts, the cash book, payee payments and posted bank entries. Heads are assigned automatically from the wording; change them under Heads.</p></div>
    <div class="card"><h2>Statement of affairs</h2><div class="tw">${accSOA(B)}</div></div>
    <div class="card"><h2>Month by month</h2>${accMonths(B)}</div>
    <div class="card"><h2>Fees receivable (ageing)</h2>${accRecv(B)}</div>
    <div class="card"><h2>Payments due</h2>${accPay(B)}</div>
    <div class="card"><h2>Trial balance</h2>${accTrial(B)}</div>
    <div class="card"><h2>Day book</h2>${accDay(B.rows)}</div>
    <div class="card noprint"><h2>Client ledger</h2><select id="lc"><option value="">Choose a client…</option>${cl.map((c) => `<option value="${c.id}" ${cid == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${led ? `<div class="tw" style="margin-top:.8rem"><table><tr><th>Date</th><th>Particulars</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Balance</th></tr>${led.rows.map((r) => `<tr><td>${dt(r.date)}</td><td>${esc(r.particulars)}</td><td class="n">${accN(r.debit_paise)}</td><td class="n">${accN(r.credit_paise)}</td><td class="n">${inr(r.balance_paise)}</td></tr>`).join('')}</table></div>` : ''}</div>`);
  accBind('reports'); $('#csv').onclick = () => accCsv(B.rows, `daybook-${B.from}-to-${B.to}.csv`);
  $('#lc').onchange = (e) => { location.hash = `#/accounts/reports?${q}` + (e.target.value ? '&client=' + e.target.value : ''); };
}

async function accHeads(head) {
  const D = await GET('/api/books/heads'), g = (k) => D.heads.filter((h) => h.grp === k);
  const tbl = (list) => `<div class="tw"><table><tr><th>Head</th><th>Words that put an entry under this head</th><th></th></tr>${list.map((h) => `<tr><td>${esc(h.name)} ${h.sys ? '' : pill('yours')}</td><td class="mute">${esc(h.keywords || '—')}</td><td><button class="btn sm ghost" data-ed="${h.id}">Edit words</button>${h.sys ? '' : ` <button class="btn sm ghost" data-rm="${h.id}">Delete</button>`}</td></tr>`).join('')}</table></div>`;
  view(`${head}<div class="card"><h2>Opening balances</h2><p class="mute">Enter the cash and bank balance you had when you started using the portal. Do this once. It keeps the balances in your reports equal to your records.</p>
    <form id="of" class="row" style="gap:.6rem;align-items:end"><div><label>Cash in hand (₹)</label><input name="cash" type="number" step="0.01" value="${D.opening.cash / 100}"></div><div><label>Bank balance (₹)</label><input name="bank" type="number" step="0.01" value="${D.opening.bank / 100}"></div><button class="btn">Save</button></form></div>
    <div class="card"><div class="row sp"><h2>Heads of account</h2><button class="btn" id="nh">Add a head</button></div><p class="mute">You never pick a head while entering data. The portal reads the wording (for example “Airtel bill” goes to phone and internet). If an entry lands in the wrong head, add the word here.</p>
      <h3>Income</h3>${tbl(g('income'))}<h3>Expenditure</h3>${tbl(g('expense'))}</div>`);
  $('#of').onsubmit = async (e) => { e.preventDefault(); try { await PUT('/api/books/opening', { cash: e.target.cash.value, bank: e.target.bank.value }); toast('Saved'); } catch (ex) { toast(ex.message, true); } };
  $('#nh').onclick = () => ask('Add a head', [{ name: 'name', label: 'Head name', required: true }, { name: 'grp', label: 'Type', type: 'select', options: [['expense', 'Expenditure'], ['income', 'Income']] }, { name: 'keywords', label: 'Words that belong here (comma separated)', ph: 'e.g. diary, calendar, gift' }], 'Add', async (v) => { await POST('/api/books/heads', v); go(); });
  $$('[data-ed]').forEach((b) => (b.onclick = () => { const h = D.heads.find((x) => String(x.id) === b.dataset.ed); ask('Words for ' + h.name, [{ name: 'keywords', label: 'Comma separated words', type: 'textarea', value: h.keywords || '' }], 'Save', async (v) => { await PUT('/api/books/heads/' + h.id, v); go(); }); }));
  $$('[data-rm]').forEach((b) => (b.onclick = async () => { if (sure('Delete this head? Entries will be re-classified automatically.')) { await DEL('/api/books/heads/' + b.dataset.rm); go(); } }));
}

/* ===== printable audit pack ===== */
route(/^\/auditpack$/, async (_, p) => {
  const [B, T] = await Promise.all([GET('/api/books?' + accQ(p)), getTpl()]);
  const S = T.settings || {}, firm = S.header_name || FIRM, sec = (n, t, html) => `<section class="pk" style="page-break-before:always"><h2>${n}. ${t}</h2>${html}</section>`;
  const rc = B.rows.filter((x) => x.kind === 'in'), pm = B.rows.filter((x) => x.kind === 'out'), sum = (a) => a.reduce((s, x) => s + x.paise, 0);
  const dif = B.bank_stmt_paise == null ? null : B.bank_stmt_paise - B.bank_book_paise;
  const bankRec = `<table><tr><td>Balance as per books (opening bank balance plus receipts less payments through bank)</td><td class="n">${inr(B.bank_book_paise)}</td></tr>
    <tr><td>Balance as per the latest bank statement imported ${B.bank_stmt_date ? '(' + dt(B.bank_stmt_date) + ')' : ''}</td><td class="n">${B.bank_stmt_paise == null ? 'not available' : inr(B.bank_stmt_paise)}</td></tr>
    <tr><td>Difference</td><td class="n">${dif == null ? '—' : inr(dif)}</td></tr>
    <tr><td>Statement entries not yet posted: ${B.unposted.n} (credits ${inr(B.unposted.cr)}, debits ${inr(B.unposted.dr)})</td><td class="n"></td></tr></table>
    <p class="mute">Any difference should be explained by the unposted statement entries, cheques not yet cleared, or an unrecorded opening balance.</p>`;
  view(`<div class="row noprint sp"><a class="btn ghost sm" href="#/accounts/audit">← Back</a><button class="btn" data-print>Print or save as PDF</button></div>
    <div class="paper" style="max-width:210mm;margin:0 auto;background:#fff;padding:14mm;font-size:10.5pt">
    <section class="pk" style="text-align:center;padding-top:30mm"><h1 style="margin:0">${esc(firm)}</h1><p>${esc(S.address || '')}</p><h2 style="margin-top:20mm">ACCOUNTS FOR AUDIT</h2><h3>For the period ${dt(B.from)} to ${dt(B.to)}</h3><p>(Financial year ${B.fy}–${String(B.fy + 1).slice(2)})</p>
      <p style="margin-top:20mm">Prepared from the firm's records on a receipts-and-payments basis.<br>Submitted to the Chartered Accountant for audit and finalisation.</p>
      <table style="margin:18mm auto 0;text-align:left;max-width:120mm"><tr><td>1.</td><td>Income and expenditure</td></tr><tr><td>2.</td><td>Statement of affairs</td></tr><tr><td>3.</td><td>Trial balance</td></tr><tr><td>4.</td><td>Heads month by month</td></tr><tr><td>5.</td><td>Receipts register</td></tr><tr><td>6.</td><td>Payments register</td></tr><tr><td>7.</td><td>Fees receivable</td></tr><tr><td>8.</td><td>Payments due</td></tr><tr><td>9.</td><td>Bank reconciliation</td></tr><tr><td>10.</td><td>Management certificate</td></tr><tr><td>11.</td><td>Format of audit report</td></tr></table></section>
    ${sec(1, 'Income and expenditure', `<div class="tw">${accIE(B)}</div>`)}${sec(2, 'Statement of affairs', `<div class="tw">${accSOA(B)}</div>`)}${sec(3, 'Trial balance', accTrial(B))}${sec(4, 'Heads month by month', accMonths(B))}
    ${sec(5, 'Receipts register', accDay(rc) + `<p><b>Total receipts: ${inr(sum(rc))}</b></p>`)}${sec(6, 'Payments register', accDay(pm) + `<p><b>Total payments: ${inr(sum(pm))}</b></p>`)}
    ${sec(7, 'Fees receivable', accRecv(B))}${sec(8, 'Payments due', accPay(B))}${sec(9, 'Bank reconciliation', bankRec)}
    ${sec(10, 'Management certificate', `<p>I/We certify that the accompanying statements have been prepared from the books and records of <b>${esc(firm)}</b> for the period ${dt(B.from)} to ${dt(B.to)}, that all receipts and payments known to us have been recorded, and that the bank statements, vouchers and registers are available for the auditor's examination.</p>
      <p style="margin-top:28mm">Place: ____________________ &nbsp;&nbsp; Date: ____________________</p><p style="margin-top:22mm;text-align:right">Proprietor / Partner<br>${esc(S.signatory_name || '')}</p>`)}
    ${sec(11, 'Format of audit report (to be completed and signed by the Chartered Accountant)', `<p class="mute">This is a blank outline only. The opinion, wording, any qualification and the UDIN are the Chartered Accountant's own.</p>
      <h3 style="text-align:center">INDEPENDENT AUDITOR'S REPORT</h3><p>To the Proprietor / Partners of ${esc(firm)}</p>
      <p><b>Opinion.</b> [To be written by the auditor.]</p><p><b>Basis for opinion.</b> [Standards followed and independence confirmation.]</p><p><b>Responsibilities of management.</b> [Preparation of the statements and internal control.]</p><p><b>Auditor's responsibilities.</b> [Scope of the audit.]</p><p><b>Other matters / observations.</b> [If any.]</p>
      <p style="margin-top:20mm">For ____________________<br>Chartered Accountants<br>Firm Registration No. ____________<br><br>(Name) ____________________ Partner / Proprietor<br>Membership No. ____________ &nbsp; UDIN ____________________<br>Place: ____________ &nbsp; Date: ____________</p>`)}
    </div>`);
}, { roles: ['admin', 'advocate', 'accounts'] });
