route(/^\/invoices$/, async () => {
  const [inv, pay] = await Promise.all([GET('/api/invoices'), GET('/api/my/payments')]);
  const due = inv.reduce((s, i) => s + i.total_paise - i.paid_paise, 0);
  view(`<h1>Fees</h1><div class="card"><div class="mute">Outstanding</div><b style="font:700 1.8rem Georgia">${inr(Math.max(0, due))}</b></div>
    <div class="card"><h2>Invoices</h2>${inv.length ? `<ul class="list">${inv.map((i) => `<li><span><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a><div class="mute">${dt(i.inv_date)}</div></span><span>${inr(i.total_paise)} ${sp(i.status)}</span></li>`).join('')}</ul>` : '<p class="mute">No invoices.</p>'}</div>
    <div class="card"><h2>Receipts</h2>${pay.length ? `<ul class="list">${pay.map((p) => `<li><a href="#/receipt/${p.id}">${esc(p.rec_no)}</a><span>${inr(p.amount_paise)} · ${dt(p.pay_date)}</span></li>`).join('')}</ul>` : '<p class="mute">No receipts.</p>'}</div>`);
}, { client: true });

route(/^\/invoice\/(\d+)$/, async ([id]) => {
  const [i, T] = await Promise.all([GET('/api/invoices/' + id), getTpl()]), S = T.settings, billing = can('admin', 'advocate', 'accounts');
  view(`<div class="row sp noprint"><a class="btn ghost sm" href="#/" data-back>← Back</a><div class="row">
    ${billing && i.status === 'draft' ? '<button class="btn gold sm" id="iss">Issue to client</button>' : ''}
    ${billing && ['sent', 'part_paid'].includes(i.status) ? '<button class="btn sm" id="rcv">Record payment</button>' : ''}
    ${billing && ['draft', 'sent'].includes(i.status) ? '<button class="btn red sm" id="cxl">Cancel</button>' : ''}<button class="btn sm" data-print>Print</button></div></div>
    ${sheetFor(T, `<div class="dochead"><h1>${esc(S.invoice_title)}</h1><div class="meta"><div><span>Invoice No.</span><b>${esc(i.inv_no)}</b></div><div><span>Date</span><b>${dt(i.inv_date)}</b></div>${i.due_date ? `<div><span>Due date</span><b>${dt(i.due_date)}</b></div>` : ''}<div><span>Status</span><b>${esc(String(i.status).replace('_', ' ').toUpperCase())}</b></div></div></div>
    <div class="billto"><span>BILLED TO</span><b>${esc(i.client_name)}</b>${i.client_address ? `<div>${esc(i.client_address)}</div>` : ''}</div>
    <table class="itab"><tr><th>#</th><th>Description</th><th class="n">Qty</th><th class="n">Rate (₹)</th><th class="n">Amount (₹)</th></tr>${i.items.map((x, k) => `<tr><td>${k + 1}</td><td>${esc(x.description)}</td><td class="n">${x.qty}</td><td class="n">${inr(x.rate_paise).slice(1)}</td><td class="n">${inr(Math.round(x.qty * x.rate_paise)).slice(1)}</td></tr>`).join('')}</table>
    <table class="ttab"><tr><td>Total</td><td class="n">${inr(i.total_paise)}</td></tr>${i.paid_paise ? `<tr><td>Received</td><td class="n">− ${inr(i.paid_paise)}</td></tr>` : ''}<tr class="due"><td>${i.paid_paise ? 'Balance due' : 'Amount due'}</td><td class="n">${inr(i.total_paise - i.paid_paise)}</td></tr></table>
    <p class="words"><span>Amount in words:</span> ${inWords(i.total_paise - i.paid_paise)}</p>
    ${i.notes ? `<p class="inote">${esc(i.notes)}</p>` : ''}
    ${i.payments.length ? `<p class="inote"><b>Receipts:</b> ${i.payments.map((p) => `${esc(p.rec_no)} (${inr(p.amount_paise)}, ${dt(p.pay_date)})`).join('; ')}</p>` : ''}
    ${S.payment_details ? `<div class="paybox"><b>Payment details</b><div>${esc(S.payment_details).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${S.invoice_footer ? `<p class="inote">${esc(S.invoice_footer)}</p>` : ''}
    ${signBlock(S)}`)}`);
  const act = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
  act('#iss', async () => { await POST(`/api/invoices/${id}/issue`); go(); });
  act('#cxl', async () => { if (sure('Cancel this invoice?')) { await POST(`/api/invoices/${id}/cancel`); go(); } });
  act('#rcv', () => recordPaymentModal(i.client_id, i.id, i.total_paise - i.paid_paise));
});

route(/^\/receipt\/(\d+)$/, async ([id]) => {
  const [p, T] = await Promise.all([GET('/api/payments/' + id), getTpl()]), S = T.settings;
  view(`<div class="row sp noprint"><a class="btn ghost sm" href="#/" data-back>← Back</a><button class="btn sm" data-print>Print</button></div>
    ${sheetFor(T, `<div class="dochead"><h1>${esc(S.receipt_title)}</h1><div class="meta"><div><span>Receipt No.</span><b>${esc(p.rec_no)}</b></div><div><span>Date</span><b>${dt(p.pay_date)}</b></div></div></div>
    <p class="rtext">Received with thanks from <b>${esc(p.client_name)}</b> the sum of <b>${inr(p.amount_paise)}</b> (${inWords(p.amount_paise)}) by ${esc(p.mode)}${p.reference ? ` (ref. ${esc(p.reference)})` : ''}${p.inv_no ? ` against invoice ${esc(p.inv_no)}` : ''}.</p>${p.notes ? `<p class="inote">${esc(p.notes)}</p>` : ''}
    ${signBlock(S)}`)}`);
});

async function recordPaymentModal(clientId, invoiceId, amountPaise) {
  const f = [];
  if (!clientId) f.push({ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), required: true });
  f.push({ name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', value: amountPaise ? amountPaise / 100 : '', required: true }, { name: 'mode', label: 'Mode', type: 'select', options: ['upi', 'bank', 'cash', 'cheque', 'card'] },
    { name: 'pay_date', label: 'Date', type: 'date', value: today() }, { name: 'reference', label: 'Reference (UTR / cheque no.)' }, { name: 'notes', label: 'Note' });
  ask('Record payment', f, 'Save & issue receipt', async (v) => { const r = await POST('/api/payments', { ...v, client_id: clientId || v.client_id, invoice_id: invoiceId || null }); toast('Receipt ' + r.rec_no); go(); });
}

/* ===== billing hub (office) ===== */
const BTABS = [['invoices', 'Invoices'], ['payments', 'Receipts'], ['cash', 'Cash book'], ['bank', 'Bank'], ['reports', 'Reports']];
route(/^\/billing(?:\/(\w+))?$/, async ([tab = 'invoices'], p) => {
  const head = `<h1>Billing</h1><div class="tabs">${BTABS.map(([k, l]) => `<a href="#/billing/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (tab === 'invoices') {
    const rows = await GET('/api/invoices');
    view(`${head}<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} invoices</span><button class="btn" id="add">New invoice</button></div><div class="card"><div class="tw"><table><tr><th>No.</th><th>Client</th><th>Date</th><th class="n">Total</th><th class="n">Received</th><th></th></tr>${rows.map((i) => `<tr><td><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a></td><td>${esc(i.client_name)}</td><td>${dt(i.inv_date)}</td><td class="n">${inr(i.total_paise)}</td><td class="n">${inr(i.paid_paise)}</td><td>${sp(i.status)}</td></tr>`).join('')}</table></div></div>`);
    $('#add').onclick = async () => ask('New invoice', [{ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), required: true }, { name: 'matter_id', label: 'Matter', type: 'select', options: await matterOpts() }, { name: 'inv_date', label: 'Date', type: 'date', value: today() }, { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'lines', label: 'Items — one per line: Description | Qty | Rate (₹)', type: 'textarea', required: true, ph: 'Professional fee — hearing | 1 | 15000\nDrafting of reply | 1 | 5000' }, { name: 'notes', label: 'Notes on invoice' }], 'Create draft', async (v) => {
      const items = v.lines.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const [d, q, r] = s.split('|').map((x) => x.trim()); if (!d || !(+r > 0)) throw new Error('Check this line: ' + s); return { description: d, qty: +q || 1, rate: +r }; });
      const r = await POST('/api/invoices', { ...v, items, matter_id: v.matter_id || null }); location.hash = '#/invoice/' + r.id; }, true);
  } else if (tab === 'payments') {
    const rows = await GET('/api/payments');
    view(`${head}<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} receipts</span><button class="btn" id="add">Record payment</button></div><div class="card"><div class="tw"><table><tr><th>Receipt</th><th>Client</th><th>Date</th><th>Mode</th><th class="n">Amount</th></tr>${rows.map((p) => `<tr><td><a href="#/receipt/${p.id}">${esc(p.rec_no)}</a></td><td>${esc(p.client_name)}</td><td>${dt(p.pay_date)}</td><td>${esc(p.mode)}</td><td class="n">${inr(p.amount_paise)}</td></tr>`).join('')}</table></div></div>`);
    $('#add').onclick = () => recordPaymentModal();
  } else if (tab === 'cash') {
    const from = p.get('from') || today().slice(0, 8) + '01', to = p.get('to') || today();
    const c = await GET(`/api/cash?from=${from}&to=${to}`);
    view(`${head}<form class="row noprint" id="rf" style="margin-bottom:.8rem"><input type="date" name="from" value="${from}" style="width:auto"><input type="date" name="to" value="${to}" style="width:auto"><button class="btn ghost">Show</button><button type="button" class="btn" id="add">New entry</button></form>
      <div class="card"><div class="tw"><table><tr><th>Date</th><th>Head</th><th>Narration</th><th class="n">Receipt</th><th class="n">Payment</th><th class="n">Balance</th></tr>
      <tr><td colspan="5"><b>Opening balance</b></td><td class="n"><b>${inr(c.opening_paise)}</b></td></tr>
      ${c.rows.map((r) => `<tr><td>${dt(r.entry_date)}</td><td>${esc(r.head)}</td><td>${esc(r.narration || '')}</td><td class="n">${r.kind === 'in' ? inr(r.amount_paise) : ''}</td><td class="n">${r.kind === 'out' ? inr(r.amount_paise) : ''}</td><td class="n">${inr(r.balance_paise)}</td></tr>`).join('')}
      <tr><td colspan="5"><b>Closing balance</b></td><td class="n"><b>${inr(c.closing_paise)}</b></td></tr></table></div></div>`);
    $('#rf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/billing/cash?from=${e.target.from.value}&to=${e.target.to.value}`; };
    $('#add').onclick = () => ask('Cash entry', [{ name: 'kind', label: 'Type', type: 'select', options: [['out', 'Payment (cash out)'], ['in', 'Receipt (cash in)']] }, { name: 'head', label: 'Head', required: true, ph: 'Stationery, Court fees, Travel…' }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true }, { name: 'entry_date', label: 'Date', type: 'date', value: today() }, { name: 'narration', label: 'Narration' }], 'Save', async (v) => { await POST('/api/cash', v); go(); });
  } else if (tab === 'bank') {
    const st = p.get('status') || '';
    const rows = await GET('/api/bank' + (st ? '?status=' + st : ''));
    view(`${head}<div class="card noprint"><b>Import bank statement</b><p class="mute">Download the statement as CSV from net-banking (columns like Date, Narration, Debit, Credit, Balance). Receipts are matched to clients automatically; you confirm each one.</p><input type="file" id="bf" accept=".csv,text/csv"></div>
      <div class="tabs">${[['', 'All'], ['suggested', 'Suggested'], ['unmatched', 'Unmatched'], ['matched', 'Matched'], ['ignored', 'Ignored']].map(([k, l]) => `<a href="#/billing/bank?status=${k}" class="${st === k ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div class="card"><div class="tw"><table><tr><th>Date</th><th>Narration</th><th class="n">Debit</th><th class="n">Credit</th><th></th></tr>${rows.map((b) => `<tr><td>${dt(b.txn_date)}</td><td>${esc(b.narration || '')}<div class="mute">${esc(b.ref || '')}</div></td><td class="n">${b.debit_paise ? inr(b.debit_paise) : ''}</td><td class="n">${b.credit_paise ? inr(b.credit_paise) : ''}</td>
      <td>${sp(b.status)}${b.client_name ? `<div class="mute">${esc(b.client_name)}</div>` : ''}${b.credit_paise && b.status !== 'matched' && b.status !== 'ignored' ? `<button class="btn sm gold" data-m="${b.id}">Match</button> ` : ''}${b.status !== 'matched' && b.status !== 'ignored' ? `<button class="btn sm ghost" data-ig="${b.id}">Ignore</button>` : ''}</td></tr>`).join('')}</table></div></div>`);
    $('#bf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const r = await POST('/api/bank/import', { csv: await f.text() }); toast(`${r.added} new, ${r.duplicates} already there${r.unreadable ? ', ' + r.unreadable + ' unreadable' : ''}.`); go(); } catch (x) { toast(x.message, true); } };
    $$('[data-ig]').forEach((b) => (b.onclick = async () => { await POST(`/api/bank/${b.dataset.ig}/ignore`); go(); }));
    $$('[data-m]').forEach((b) => (b.onclick = async () => {
      const t = rows.find((x) => x.id == b.dataset.m), invs = (await GET('/api/invoices')).filter((i) => ['sent', 'part_paid'].includes(i.status));
      ask(`Match ${inr(t.credit_paise)} received on ${dt(t.txn_date)}`, [{ name: 'client_id', label: 'Client', type: 'select', value: t.matched_client_id || '', options: [['', '— choose —'], ...(await clientOpts())], required: true },
        { name: 'invoice_id', label: 'Against invoice (optional)', type: 'select', options: [['', 'On account (no invoice)'], ...invs.map((i) => [i.id, `${i.inv_no} · ${i.client_name} · due ${inr(i.total_paise - i.paid_paise)}`])] }], 'Match & issue receipt', async (v) => { const r = await POST(`/api/bank/${t.id}/match`, { client_id: v.client_id, invoice_id: v.invoice_id || null }); toast('Receipt ' + r.rec_no); go(); }, true);
    }));
  } else if (tab === 'reports') {
    const clients = await GET('/api/clients'), cid = p.get('client'), from = p.get('from') || `${new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0)}-04-01`, to = p.get('to') || today();
    const [out, fin] = await Promise.all([GET('/api/reports/outstanding'), GET(`/api/reports/final?from=${from}&to=${to}`)]);
    const led = cid ? await GET('/api/reports/ledger?client_id=' + cid) : null;
    view(`${head}
      <div class="card"><h2>Client ledger</h2><select id="lc"><option value="">Choose a client…</option>${clients.map((c) => `<option value="${c.id}" ${cid == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${led ? `<div class="tw" style="margin-top:.8rem"><table><tr><th>Date</th><th>Particulars</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Balance</th></tr>${led.rows.map((r) => `<tr><td>${dt(r.date)}</td><td>${esc(r.particulars)}</td><td class="n">${r.debit_paise ? inr(r.debit_paise) : ''}</td><td class="n">${r.credit_paise ? inr(r.credit_paise) : ''}</td><td class="n">${inr(r.balance_paise)}</td></tr>`).join('')}<tr><td colspan="4"><b>Closing balance</b></td><td class="n"><b>${inr(led.balance_paise)}</b></td></tr></table></div><button class="btn sm noprint" data-print>Print</button>` : ''}</div>
      <div class="card"><h2>Outstanding fees</h2>${out.length ? `<div class="tw"><table><tr><th>Client</th><th>Phone</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Due</th></tr>${out.map((o) => `<tr><td><a href="#/billing/reports?client=${o.id}">${esc(o.name)}</a></td><td>${esc(o.phone || '')}</td><td class="n">${inr(o.billed_paise)}</td><td class="n">${inr(o.paid_paise)}</td><td class="n"><b>${inr(o.due_paise)}</b></td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing outstanding.</p>'}</div>
      <div class="card"><h2>Income & expenditure with position</h2><form class="row noprint" id="ff"><input type="date" name="from" value="${from}" style="width:auto"><input type="date" name="to" value="${to}" style="width:auto"><button class="btn ghost">Show</button></form>
      <div class="tw"><table><tr><th colspan="2">Income (fees received)</th></tr>${fin.income.map((x) => `<tr><td>${esc(x.mode)}</td><td class="n">${inr(x.paise)}</td></tr>`).join('')}<tr><td><b>Total income</b></td><td class="n"><b>${inr(fin.total_income_paise)}</b></td></tr>
      <tr><th colspan="2">Expenditure</th></tr>${fin.expenses.map((x) => `<tr><td>${esc(x.head)}</td><td class="n">${inr(x.paise)}</td></tr>`).join('')}<tr><td><b>Total expenditure</b></td><td class="n"><b>${inr(fin.total_expense_paise)}</b></td></tr>
      <tr><td><b>Surplus / (deficit)</b></td><td class="n"><b>${inr(fin.surplus_paise)}</b></td></tr>
      <tr><th colspan="2">Position at ${dt(fin.to)}</th></tr><tr><td>Cash in hand</td><td class="n">${inr(fin.cash_balance_paise)}</td></tr><tr><td>Bank balance (last statement)</td><td class="n">${fin.bank_balance_paise == null ? '—' : inr(fin.bank_balance_paise)}</td></tr><tr><td>Fees receivable</td><td class="n">${inr(fin.receivables_paise)}</td></tr></table></div>
      <p class="mute">Prepared on a cash basis from recorded receipts, the cash book and imported bank statements. Your chartered accountant will finalise statutory accounts.</p><button class="btn sm noprint" data-print>Print</button></div>`);
    $('#lc').onchange = (e) => (location.hash = '#/billing/reports' + (e.target.value ? '?client=' + e.target.value : ''));
    $('#ff').onsubmit = (e) => { e.preventDefault(); location.hash = `#/billing/reports?from=${e.target.from.value}&to=${e.target.to.value}`; };
  } else view('<div class="card">Unknown section.</div>');
}, { roles: ['admin', 'advocate', 'accounts'] });
