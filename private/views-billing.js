route(/^\/invoices$/, async () => {
  const [inv, pay] = await Promise.all([GET('/api/invoices'), GET('/api/my/payments')]);
  const due = inv.reduce((s, i) => s + i.total_paise - i.paid_paise, 0);
  view(`<h1>Fees</h1><div class="card"><div class="mute">Outstanding</div><b style="font:700 14px Georgia">${inr(Math.max(0, due))}</b></div>
    <div class="card"><h2>Invoices</h2>${inv.length ? `<ul class="list">${inv.map((i) => `<li><span><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a><div class="mute">${dt(i.inv_date)}</div></span><span>${inr(i.total_paise)} ${sp(i.status)}</span></li>`).join('')}</ul>` : '<p class="mute">No invoices.</p>'}</div>
    <div class="card"><h2>Receipts</h2>${pay.length ? `<ul class="list">${pay.map((p) => `<li><a href="#/receipt/${p.id}">${esc(p.rec_no)}</a><span>${inr(p.amount_paise)} · ${dt(p.pay_date)}</span></li>`).join('')}</ul>` : '<p class="mute">No receipts.</p>'}</div>`);
}, { client: true });


const itemsToLines = (items) => (items || []).map((x) => `${String(x.description).replace(/\n/g, ' // ')} | ${x.qty} | ${(x.rate_paise / 100).toFixed(2).replace(/\.00$/, '')}`).join('\n');
const linesToItems = (txt) => String(txt || '').split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const [d, q, r] = s.split('|').map((x) => x.trim()); if (!d || !(+r > 0)) throw new Error('Check this line: ' + s); return { description: d.replace(/\s*\/\/\s*/g, '\n'), qty: +q || 1, rate: +r }; });
const LINES_LABEL = 'Items — one per line: Description | Qty | Rate (₹)   (use // for a new line inside a description)';
const UNIT_OPTS = [['week', 'week(s)'], ['month', 'month(s)'], ['quarter', 'quarter(s)'], ['year', 'year(s)'], ['day', 'day(s)']];

// Clone: the New-invoice form, pre-filled from an existing invoice, for quick editing
async function cloneInvoice(i) {
  ask('Clone invoice ' + i.inv_no, [{ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), value: i.client_id, required: true }, { name: 'inv_date', label: 'Date', type: 'date', value: today() }, { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'subject', label: 'Subject (printed on the invoice)', value: i.subject || '' },
    { name: 'lines', label: LINES_LABEL, type: 'textarea', required: true, value: itemsToLines(i.items) }, { name: 'notes', label: 'Notes on invoice', value: i.notes || '' }], 'Create draft copy', async (v) => {
    const r = await POST('/api/invoices', { ...v, items: linesToItems(v.lines), matter_id: i.matter_id || null }); toast('Copy created as ' + r.inv_no); location.hash = '#/invoice/' + r.id; }, true);
}
// Recurring-invoice form (new, from an invoice, or edit)
async function recurringForm(p, onDone) {
  const nextMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); })();
  ask(p.id ? 'Edit recurring invoice' : 'New recurring invoice', [{ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), value: p.client_id, required: true }, { name: 'name', label: 'Profile name (for you)', value: p.name || '' },
    { name: 'subject', label: 'Subject (printed on each invoice)', value: p.subject || '' }, { name: 'lines', label: LINES_LABEL, type: 'textarea', required: true, value: itemsToLines(p.items) },
    { name: 'every_n', label: 'Repeat every', type: 'number', value: p.every_n || 1 }, { name: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTS, value: p.unit || 'month' },
    { name: 'next_date', label: 'First / next invoice date', type: 'date', value: p.next_date || nextMonth, required: true }, { name: 'end_date', label: 'Stop after (optional)', type: 'date', value: p.end_date || '' },
    { name: 'due_days', label: 'Due in how many days (0 = on receipt)', type: 'number', value: p.due_days ?? 0 }, { name: 'notes', label: 'Notes on invoice', value: p.notes || '' },
    { name: 'auto_send', label: 'Send each invoice to the client automatically (otherwise it is kept as a draft for you to review)', type: 'checkbox', value: p.auto_send },
    { name: 'send_email', label: 'Send by e-mail', type: 'checkbox', value: p.id ? p.send_email : 1 }, { name: 'send_whatsapp', label: 'Send by WhatsApp (only works when the WhatsApp Business API is connected)', type: 'checkbox', value: p.send_whatsapp }], p.id ? 'Save' : 'Schedule', async (v) => {
    const body = { ...v, items: linesToItems(v.lines), matter_id: p.matter_id || null };
    if (p.id) await PUT('/api/recurring/' + p.id, body); else await POST('/api/recurring', body);
    toast('Recurring invoice saved'); if (onDone) onDone(); }, true);
}
// Send by e-mail / WhatsApp
async function sendInvoiceModal(i) {
  const info = await GET(`/api/invoices/${i.id}/send-info`);
  ask('Send invoice ' + i.inv_no, [
    { name: 'email', label: 'E-mail' + (info.email ? ' to the client' : ' (no e-mail address on the client page)') + (info.email_ready ? '' : ' — mailbox not set up yet'), type: 'checkbox', value: !!(info.email && info.email_ready) },
    { name: 'to', label: 'E-mail address', value: info.email || '', hint: 'Change this to send to a different address.' },
    { name: 'whatsapp', label: 'WhatsApp' + (info.phone ? ' to ' + info.phone : ' (no mobile number on the client page)') + (info.wa_api ? '' : ' — opens WhatsApp for you to press Send'), type: 'checkbox', value: !!info.phone },
    { name: 'message', label: 'Short message to add (optional)', type: 'textarea' }], 'Send', async (v) => {
    if (!v.email && !v.whatsapp) throw new Error('Choose e-mail or WhatsApp.');
    const r = await POST(`/api/invoices/${i.id}/send`, v);
    if (r.failed && r.failed.length) toast(r.failed.join(' · '), true);
    if (r.sent && r.sent.length) toast('Sent by ' + r.sent.join(' and ') + '.');
    if (r.wa_link) show('WhatsApp is ready', `<p>Press the button, check the message in WhatsApp and tap Send.</p><p><a class="btn gold" target="_blank" rel="noopener" href="${esc(r.wa_link)}" style="display:block;text-align:center">Open WhatsApp</a></p>`);
    else go(); }, true);
}

// up to four titled payment items (Bank Details, PAN, UPI ...). Old firms that only filled bank details / PAN still print them.
const payItems = (S) => {
  let a = [1, 2, 3, 4].map((n) => ({ t: String(S['pay' + n + '_title'] || '').trim(), x: String(S['pay' + n + '_text'] || '').trim() })).filter((p) => p.x);
  if (!a.length) a = [{ t: 'Bank Details', x: String(S.payment_details || '').trim() }, { t: 'PAN', x: String(S.pan || '').trim() }].filter((p) => p.x);
  return a;
};
function invoiceSheet(i, S, T) {
  const lines = (t) => esc(t).replace(/\n/g, '<br>');
  const terms = (() => { if (!i.due_date || i.due_date <= i.inv_date) return 'Due on Receipt'; const n = Math.round((new Date(i.due_date) - new Date(i.inv_date)) / 864e5); return 'Due in ' + n + ' day' + (n === 1 ? '' : 's'); })();
  const due = i.total_paise - i.paid_paise, closed = ['draft', 'cancelled'].includes(i.status);
  const tc = String(S.invoice_terms || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const stamp = { paid: 'PAID', cancelled: 'CANCELLED', draft: 'DRAFT' }[i.status] || '';
  return `<div class="vi">
    <div class="vi-title"><h1>${esc(S.invoice_title)}</h1>${stamp ? `<span class="vi-stamp">${stamp}</span>` : ''}</div>
    <div class="vi-box vi-meta"><div><p><span>Invoice No.</span>: <b>${esc(i.inv_no)}</b></p><p><span>Invoice Date</span>: <b>${dt(i.inv_date)}</b></p></div><div><p><span>Terms</span>: <b>${terms}</b></p><p><span>Due Date</span>: <b>${dt(i.due_date || i.inv_date)}</b></p></div></div>
    <div class="vi-bar">Bill To</div>
    <div class="vi-box vi-bill"><b>${esc(i.client_name)}</b>${i.client_address ? `<div>${lines(i.client_address)}</div>` : ''}</div>
    ${i.subject ? `<div class="vi-box vi-sub"><span>Subject :</span> <b>${esc(i.subject)}</b></div>` : ''}
    <table class="vi-items"><tr><th class="c">#</th><th>Item &amp; Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr>${i.items.map((x, k) => { const [h, ...r] = String(x.description).split('\n'); return `<tr><td class="c">${k + 1}</td><td><b>${esc(h)}</b>${r.length ? `<div class="d">${lines(r.join('\n'))}</div>` : ''}</td><td class="n">${Number(x.qty).toFixed(2)}</td><td class="n">${inr(x.rate_paise).slice(1)}</td><td class="n">${inr(Math.round(x.qty * x.rate_paise)).slice(1)}</td></tr>`; }).join('')}</table>
    <div class="vi-tot"><div class="w"><span>Total In Words</span><em>${inWords(i.total_paise).replace(/^Rupees/, 'Indian Rupee')}</em></div>
      <table><tr><td>Sub Total</td><td class="n">${inr(i.total_paise).slice(1)}</td></tr><tr class="t"><td>Total</td><td class="n">${inr(i.total_paise)}</td></tr>${i.paid_paise ? `<tr><td>Payment Received</td><td class="n">(−) ${inr(i.paid_paise)}</td></tr>` : ''}${closed ? '' : `<tr class="due"><td>Balance Due</td><td class="n">${inr(due)}</td></tr>`}</table></div>
    ${i.notes || payItems(S).length || S.invoice_footer || i.payments.length || (T && T.has_qr) ? `<div class="vi-notes${T && T.has_qr ? ' hasqr' : ''}"><div class="nl">${payItems(S).length ? '<div class="pis">' : ''}${payItems(S).map((p) => `<div class="pi">${p.t ? `<u>${esc(p.t.toUpperCase())}</u><br>` : ''}${lines(p.x.replace(/(IFSC[^\n(]*?)\s*\(([^)\n]+)\)/i, '$1\nBranch: $2'))}</div>`).join('')}${payItems(S).length ? '</div>' : ''}${i.notes ? `<p>${lines(i.notes)}</p>` : ''}${S.invoice_footer ? `<p class="ft">${esc(S.invoice_footer)}</p>` : ''}</div>${T && T.has_qr ? `<div class="vi-qr"><img src="${tplUrl(T, 'qr')}" alt="">${S.qr_caption ? `<div>${esc(S.qr_caption)}</div>` : ''}</div>` : ''}<div class="vi-sign"><div class="gap">${T && T.has_signature ? `<img src="${tplUrl(T, 'signature')}" alt="">` : ''}</div><div>Authorised Signatory</div></div>${i.payments.length ? `<p class="ft"><b>Receipts:</b> ${i.payments.map((p) => `${esc(p.rec_no)} (${inr(p.amount_paise)}, ${dt(p.pay_date)})`).join('; ')}</p>` : ''}</div>` : `<div class="vi-sign"><div class="gap">${T && T.has_signature ? `<img src="${tplUrl(T, 'signature')}" alt="">` : ''}</div><div>Authorised Signatory</div></div>`}
    ${tc.length ? `<div class="vi-terms"><span>Terms &amp; Conditions</span><ol>${tc.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
  </div>`;
}

route(/^\/invoice\/(\d+)$/, async ([id]) => {
  const [i, T] = await Promise.all([GET('/api/invoices/' + id), getTpl()]), S = T.settings, billing = can('admin', 'advocate', 'accounts');
  view(`<div class="row sp noprint"><a class="btn ghost sm" href="#/" data-back>← Back</a><div class="row">
    ${billing && i.status === 'draft' ? '<button class="btn gold sm" id="iss">Issue to client</button>' : ''}
    ${billing && ['sent', 'part_paid'].includes(i.status) ? '<button class="btn sm" id="rcv">Record payment</button><button class="btn sm ghost" id="rmd">Send reminder with pay link</button>' : ''}
    ${billing && ['draft', 'sent'].includes(i.status) ? '<button class="btn red sm" id="cxl">Cancel</button>' : ''}${billing && i.status !== 'cancelled' ? '<button class="btn sm gold" id="snd">Send</button>' : ''}${billing ? '<button class="btn sm ghost" id="cln">Clone</button><button class="btn sm ghost" id="rcr">Make recurring</button>' : ''}${billing && i.share_token ? '<button class="btn sm ghost" id="cpl">Copy link</button>' : ''}<button class="btn sm" data-print>Print</button></div></div>
    ${sheetFor(T, invoiceSheet(i, S, T))}`);
  const act = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
  act('#iss', async () => { await POST(`/api/invoices/${id}/issue`); go(); });
  act('#cxl', async () => { if (sure('Cancel this invoice?')) { await POST(`/api/invoices/${id}/cancel`); go(); } });
  act('#rmd', async () => { try { const r = await POST(`/api/invoices/${id}/remind`); toast('Reminder sent by ' + r.sent.join(' and ') + '.'); } catch (x) { toast(x.message, true); } });
  act('#rcv', () => recordPaymentModal(i.client_id, i.id, i.total_paise - i.paid_paise));
  act('#snd', () => sendInvoiceModal(i));
  act('#cln', () => cloneInvoice(i));
  act('#rcr', () => recurringForm({ client_id: i.client_id, subject: i.subject, notes: i.notes, items: i.items, matter_id: i.matter_id }, () => { location.hash = '#/accounts/recurring'; }));
  act('#cpl', async () => { try { await navigator.clipboard.writeText(`${location.origin}/#/inv/${i.share_token}`); toast('Invoice link copied'); } catch (e) { toast(`${location.origin}/#/inv/${i.share_token}`); } });
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
const BTABS = [['invoices', 'Invoices'], ['recurring', 'Recurring'], ['payments', 'Receipts'], ['payouts', 'Payments'], ['sched', 'Scheduled payments'], ['payees', 'Payees'], ['ledgers', 'Ledgers'], ['cash', 'Cash book'], ['bank', 'Bank reconciliation'], ['reports', 'Reports'], ['audit', 'Audit pack'], ['heads', 'Heads']];
route(/^\/(?:billing|accounts)(?:\/(\w+))?$/, async ([tab = 'invoices'], p) => {
  const head = `<h1>Accounts</h1><div class="tabs">${BTABS.map(([k, l]) => `<a href="#/accounts/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (tab === 'invoices') {
    const sk = invSortKey(), rowsHtml = (list) => list.map((i) => `<tr><td><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a></td><td>${esc(i.client_name)}</td><td>${dt(i.inv_date)}</td><td class="n">${inr(i.total_paise)}</td><td class="n">${inr(i.paid_paise)}</td><td>${sp(i.status)}</td></tr>`).join('');
    const rows = await GET('/api/invoices');
    view(`${head}<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} invoices</span><span class="row" style="gap:.5rem">${invSortSel(sk)}<button class="btn" id="add">New invoice</button></span></div><div class="card"><div class="tw"><table><tr><th>No.</th><th>Client</th><th>Date</th><th class="n">Total</th><th class="n">Received</th><th></th></tr>${rowsHtml(sortInv(rows, sk))}</table></div></div>`);
    
    $('#invsort').onchange = (e) => { invSortSave(e.target.value); const tb = document.querySelector('.card table'); const hdr = tb.rows[0].outerHTML; tb.innerHTML = '<tbody>' + hdr + rowsHtml(sortInv(rows, e.target.value)) + '</tbody>'; };
    $('#add').onclick = async () => ask('New invoice', [{ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), required: true }, { name: 'matter_id', label: 'Matter', type: 'select', options: await matterOpts() }, { name: 'inv_date', label: 'Date', type: 'date', value: today() }, { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'subject', label: 'Subject (printed on the invoice)' },
      { name: 'lines', label: 'Items — one per line: Description | Qty | Rate (₹)', type: 'textarea', required: true, ph: 'Professional fee — hearing | 1 | 15000\nDrafting of reply | 1 | 5000' }, { name: 'notes', label: 'Notes on invoice' }], 'Create draft', async (v) => {
      const items = v.lines.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const [d, q, r] = s.split('|').map((x) => x.trim()); if (!d || !(+r > 0)) throw new Error('Check this line: ' + s); return { description: d, qty: +q || 1, rate: +r }; });
      const r = await POST('/api/invoices', { ...v, items, matter_id: v.matter_id || null }); location.hash = '#/invoice/' + r.id; }, true);
  } else if (tab === 'recurring') {
    const rows = await GET('/api/recurring'), unitTxt = (p) => `every ${p.every_n > 1 ? p.every_n + ' ' : ''}${p.unit}${p.every_n > 1 ? 's' : ''}`;
    view(`${head}<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} recurring invoice${rows.length === 1 ? '' : 's'} — created automatically on the date; sent to the client too if you tick "send automatically".</span><button class="btn" id="add">New recurring invoice</button></div>
      <div class="card"><div class="tw">${rows.length ? `<table><tr><th>Client</th><th>What</th><th>Repeats</th><th>Next invoice</th><th class="n">Amount</th><th>Sending</th><th>Status</th><th></th></tr>${rows.map((p) => `<tr><td>${esc(p.client_name || '')}</td><td>${esc(p.name || p.subject || (p.items[0] && p.items[0].description.split('\n')[0]) || '')}</td><td>${unitTxt(p)}</td><td>${dt(p.next_date)}</td><td class="n">${inr(p.items.reduce((a, x) => a + Math.round(x.qty * x.rate_paise), 0))}</td><td>${p.auto_send ? ['email', 'whatsapp'].filter((c) => p['send_' + c]).join(' + ') || 'auto' : 'draft for review'}</td><td>${sp(p.status)}${p.last_error ? `<div class="err" style="font-size:10px">${esc(p.last_error)}</div>` : ''}</td><td class="row" style="gap:.3rem"><button class="btn sm ghost" data-ed="${p.id}">Edit</button><button class="btn sm ghost" data-run="${p.id}">Create now</button><button class="btn sm ghost" data-tg="${p.id}">${p.status === 'active' ? 'Pause' : 'Resume'}</button><button class="btn sm red" data-del="${p.id}">Delete</button></td></tr>`).join('')}</table>` : '<p class="mute">No recurring invoices yet. Open any invoice and press "Make recurring", or use the button above.</p>'}</div></div>`);
    const by = (id) => rows.find((p) => String(p.id) === String(id));
    $('#add').onclick = () => recurringForm({}, go);
    document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => recurringForm(by(b.dataset.ed), go)));
    document.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = async () => { await POST(`/api/recurring/${b.dataset.tg}/toggle`); go(); }));
    document.querySelectorAll('[data-run]').forEach((b) => (b.onclick = async () => { if (!sure('Create the next invoice from this profile right now (as a draft)?')) return; try { const r = await POST(`/api/recurring/${b.dataset.run}/run`); toast('Created ' + r.inv_no); location.hash = '#/invoice/' + r.id; } catch (e) { toast(e.message, true); } }));
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!sure('Delete this recurring invoice? Invoices already created are kept.')) return; await DEL('/api/recurring/' + b.dataset.del); go(); }));
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
    $('#rf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/accounts/cash?from=${e.target.from.value}&to=${e.target.to.value}`; };
    $('#add').onclick = () => ask('Cash entry', [{ name: 'kind', label: 'Type', type: 'select', options: [['out', 'Payment (cash out)'], ['in', 'Receipt (cash in)']] }, { name: 'head', label: 'Head', required: true, ph: 'Stationery, Court fees, Travel…' }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true }, { name: 'entry_date', label: 'Date', type: 'date', value: today() }, { name: 'narration', label: 'Narration' }], 'Save', async (v) => { await POST('/api/cash', v); go(); });
  } else if (tab === 'bank') {
    const st = p.get('status') || '', canEdit = can('admin', 'accounts');
    const [rows, sum, imps, errs] = await Promise.all([GET('/api/bank' + (st && st !== 'posted' ? '?status=' + st : '')), GET('/api/bank/summary'), GET('/api/bank/imports'), GET('/api/bank/errors')]);
    const list = st === 'posted' ? rows.filter((x) => ['matched', 'tagged'].includes(x.status)) : rows, busy = imps.find((i) => i.status === 'processing');
    const TABS = [['', 'All'], ['unmatched', `Needs review${sum.unmatched ? ' (' + sum.unmatched + ')' : ''}`], ['suggested', `Suggested${sum.suggested ? ' (' + sum.suggested + ')' : ''}`], ['posted', 'Posted'], ['ignored', 'Ignored']];
    view(`${head}
      ${canEdit ? `<div class="card noprint"><b>Import bank statement</b><p class="mute">Upload the statement as <b>PDF</b> (read by AI, pages are sent to the AI service) or <b>CSV</b>. Entries are sorted automatically to your clients and payees; anything unclear is left for you. Nothing is lost if you stop midway — the list stays exactly as you left it.</p>
        <input type="file" id="bf" accept=".pdf,.csv,application/pdf,text/csv"> <button class="btn sm ghost" id="addln" type="button">Add a missed line</button> ${sum.ai ? '<button class="btn sm ghost" id="aiall" type="button">Sort remaining with AI</button>' : ''}
        ${busy ? `<p class="mute" id="prog">Reading ${esc(busy.filename || '')}: page ${busy.pages_done} of ${busy.pages_total || '…'} ${busy.message ? '— ' + esc(busy.message) : ''}</p>` : ''}
        ${imps[0] && imps[0].status === 'failed' ? `<p class="err">${esc(imps[0].message || '')}</p>` : ''}</div>` : ''}
      ${errs.length ? `<div class="card" style="border-left:4px solid #b7791f"><h2>Needs correction (${errs.length})</h2><p class="mute">These lines could not be read properly. Fix them below, or dismiss. They stay here until you do.</p><div class="tw"><table><tr><th>As read</th><th>Why</th><th></th></tr>${errs.map((e) => `<tr><td>${esc(e.raw)}</td><td class="mute">${esc(e.reason || '')}</td><td>${canEdit ? `<button class="btn sm gold" data-ef="${e.id}">Correct</button> <button class="btn sm ghost" data-ed="${e.id}">Dismiss</button>` : ''}</td></tr>`).join('')}</table></div></div>` : ''}
      <div class="tabs">${TABS.map(([k, l]) => `<a href="#/accounts/bank?status=${k}" class="${st === k ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${canEdit ? `<div class="row noprint" style="margin:.5rem 0;gap:.4rem;flex-wrap:wrap"><span class="mute" id="selc">0 selected</span><button class="btn sm" data-b="assign">Assign party / head…</button><button class="btn sm gold" data-b="confirm">Confirm selected</button><button class="btn sm ghost" data-b="ignore">Ignore</button><button class="btn sm ghost" data-b="reopen">Reopen</button>${sum.ai ? '<button class="btn sm ghost" data-b="ai">Re-sort with AI</button>' : ''}</div>` : ''}
      <div class="card"><div class="tw"><table><tr>${canEdit ? '<th><input type="checkbox" id="all"></th>' : ''}<th>Date</th><th>Narration</th><th class="n">Debit</th><th class="n">Credit</th><th>Party / head</th><th></th></tr>${list.map((b) => `<tr>${canEdit ? `<td><input type="checkbox" class="sel" value="${b.id}"></td>` : ''}<td>${dt(b.txn_date)}</td><td>${esc(b.narration || '')}<div class="mute">${esc(b.ref || '')}${b.remark ? ' · ' + esc(b.remark) : ''}</div></td><td class="n">${b.debit_paise ? inr(b.debit_paise) : ''}</td><td class="n">${b.credit_paise ? inr(b.credit_paise) : ''}</td>
      <td>${b.party_name ? `<b>${esc(b.party_name)}</b> <span class="mute">${esc(b.party_kind || '')}${b.by_ai ? ' · AI' : ''}</span>` : '<span class="mute">—</span>'}${b.head ? `<div class="mute">${esc(b.head)}</div>` : ''}</td>
      <td>${sp(b.status)}${canEdit && !['matched', 'tagged'].includes(b.status) ? ` <button class="btn sm ghost" data-ed1="${b.id}" title="Edit">✎</button>` : ''}${canEdit && b.credit_paise && !['matched', 'ignored', 'tagged'].includes(b.status) ? ` <button class="btn sm gold" data-m="${b.id}">Match to invoice</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="7" class="mute">No entries.</td></tr>`}</table></div></div>`);
    if (busy) setTimeout(() => { if (location.hash.includes('/accounts/bank')) go(); }, 3000);
    $$('[data-ig]').forEach((b) => (b.onclick = async () => { await POST(`/api/bank/${b.dataset.ig}/ignore`); go(); }));
    if (canEdit) {
      const up = async (f) => { const fd = new FormData(); fd.append('file', f); const r = await fetch('/api/bank/import-pdf', { method: 'POST', body: fd, headers: { 'X-Requested-With': 'kcportal' } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Upload failed.'); return j; };
      $('#bf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try {
        if (/\.pdf$/i.test(f.name)) { await up(f); toast('Statement uploaded — reading it now. You can leave this page; it continues.'); } else { const r = await POST('/api/bank/import', { csv: await f.text() }); toast(`${r.added} new, ${r.duplicates} already there${r.unreadable ? ', ' + r.unreadable + ' need correction' : ''}.`); } go(); } catch (x) { toast(x.message, true); } };
      const sel = () => $$('.sel:checked').map((x) => +x.value), upd = () => { $('#selc').textContent = sel().length + ' selected'; };
      $$('.sel').forEach((x) => (x.onchange = upd)); if ($('#all')) $('#all').onchange = (e) => { $$('.sel').forEach((x) => (x.checked = e.target.checked)); upd(); };
      const lines = ['clients', 'payees'], [cl, pe] = await Promise.all([clientOpts(), GET('/api/payees')]);
      const partyFields = (t) => [{ name: 'client_id', label: 'Client (fees received from)', type: 'select', value: t && t.party_kind === 'client' ? t.party_id : '', options: [['', '— none —'], ...cl] },
        { name: 'payee_id', label: 'Payee (money paid to)', type: 'select', value: t && t.party_kind === 'payee' ? t.party_id : '', options: [['', '— none —'], ...pe.filter((x) => x.active).map((x) => [x.id, `${x.name} (${x.kind})`])] },
        { name: 'name', label: 'Or type any other name', value: t && t.party_kind === 'other' ? t.party_name : '', ph: 'e.g. R K Traders' }, { name: 'head', label: 'Head of account (optional)', value: (t && t.head) || '', ph: 'Fees received / Salary / Stationery' }, { name: 'remark', label: 'Remark (optional)', value: (t && t.remark) || '' },
        { name: 'alias', label: 'Text to look for in future narrations (to remember this)', ph: 'e.g. RK TRADERS', value: '' }, { name: 'remember', label: 'Remember for future statements', type: 'checkbox' }];
      const body = (v) => { const o = { head: v.head, remark: v.remark, remember: !!v.remember, alias: v.alias }; if (v.client_id) Object.assign(o, { party_kind: 'client', party_id: v.client_id }); else if (v.payee_id) Object.assign(o, { party_kind: 'payee', party_id: v.payee_id }); else if (v.name) Object.assign(o, { party_kind: 'other', party_name: v.name }); return o; };
      $$('[data-b]').forEach((b) => (b.onclick = async () => { const ids = sel(); if (!ids.length) return toast('Tick the entries first.', true); const a = b.dataset.b;
        try { if (a === 'assign') return ask(`Assign ${ids.length} entr${ids.length > 1 ? 'ies' : 'y'}`, partyFields(null), 'Save', async (v) => { const r = await POST('/api/bank/bulk', { action: 'assign', ids, ...body(v) }); toast(r.changed + ' updated.'); go(); });
          const r = await POST('/api/bank/bulk', { action: a, ids }); toast(a === 'confirm' ? `${r.confirmed} posted${r.skipped ? ', ' + r.skipped + ' need a client / payee first' : ''}.` : a === 'ai' ? `${r.sorted} sorted.` : `${r.changed} updated.`); go(); } catch (x) { toast(x.message, true); } }));
      if ($('#aiall')) $('#aiall').onclick = async () => { try { toast('Sorting…'); const ids = rows.filter((x) => x.status === 'unmatched').map((x) => x.id); if (!ids.length) return toast('Nothing left to sort.'); const r = await POST('/api/bank/bulk', { action: 'ai', ids }); toast(r.sorted + ' sorted.'); go(); } catch (x) { toast(x.message, true); } };
      $$('[data-ed1]').forEach((b) => (b.onclick = () => { const t = rows.find((x) => x.id == b.dataset.ed1);
        ask('Edit entry', [{ name: 'date', label: 'Date', type: 'date', value: t.txn_date }, { name: 'narration', label: 'Narration', value: t.narration || '' }, { name: 'debit', label: 'Debit (₹)', type: 'number', step: '0.01', value: t.debit_paise ? t.debit_paise / 100 : '' }, { name: 'credit', label: 'Credit (₹)', type: 'number', step: '0.01', value: t.credit_paise ? t.credit_paise / 100 : '' }, ...partyFields(t)], 'Save', async (v) => { await PUT('/api/bank/' + t.id, { date: v.date, narration: v.narration, debit: v.debit || 0, credit: v.credit || 0, ...body(v) }); go(); }, true); }));
      $('#addln').onclick = () => ask('Add a missed line', [{ name: 'date', label: 'Date', type: 'date', value: today(), required: true }, { name: 'narration', label: 'Narration', required: true }, { name: 'debit', label: 'Debit (₹)', type: 'number', step: '0.01' }, { name: 'credit', label: 'Credit (₹)', type: 'number', step: '0.01' }], 'Add', async (v) => { await POST('/api/bank/entry', v); go(); });
      $$('[data-ef]').forEach((b) => (b.onclick = () => { const e = errs.find((x) => x.id == b.dataset.ef); ask('Correct this line', [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'narration', label: 'Narration', value: e.raw }, { name: 'debit', label: 'Debit (₹)', type: 'number', step: '0.01' }, { name: 'credit', label: 'Credit (₹)', type: 'number', step: '0.01' }], 'Save entry', async (v) => { await POST(`/api/bank/errors/${e.id}/fix`, v); go(); }); }));
      $$('[data-ed]').forEach((b) => (b.onclick = async () => { await POST(`/api/bank/errors/${b.dataset.ed}/dismiss`); go(); }));
    }
    $$('[data-m]').forEach((b) => (b.onclick = async () => {
      const t = rows.find((x) => x.id == b.dataset.m), invs = (await GET('/api/invoices')).filter((i) => ['sent', 'part_paid'].includes(i.status));
      ask(`Match ${inr(t.credit_paise)} received on ${dt(t.txn_date)}`, [{ name: 'client_id', label: 'Client', type: 'select', value: t.matched_client_id || '', options: [['', '— choose —'], ...(await clientOpts())], required: true },
        { name: 'invoice_id', label: 'Against invoice (optional)', type: 'select', options: [['', 'On account (no invoice)'], ...invs.map((i) => [i.id, `${i.inv_no} · ${i.client_name} · due ${inr(i.total_paise - i.paid_paise)}`])] }], 'Match & issue receipt', async (v) => { const r = await POST(`/api/bank/${t.id}/match`, { client_id: v.client_id, invoice_id: v.invoice_id || null }); toast('Receipt ' + r.rec_no + ' issued.'); go(); });
    }));
  } else if (['payouts', 'sched', 'payees'].includes(tab)) {
    const [pays, scheds, payees, paid] = await Promise.all([GET('/api/payee-payments?status=due'), GET('/api/pay-schedules'), GET('/api/payees'), GET('/api/payee-payments?status=paid')]);
    const KIND = { advocate: 'Advocate', staff: 'Staff', client: 'Client', other: 'Other' }, canPay = can('admin', 'accounts');
    const active = payees.filter((x) => x.active);
    view(`${head}<div class="row sp" style="margin-bottom:.8rem"><span class="mute">Scheduled payments to advocates, staff, clients or anyone else. Nothing is paid automatically — each due payment waits here until you pay it and record the reference.</span>
      ${canPay ? `<span class="row">${tab === 'payees' ? '<button class="btn" id="np">Add payee</button>' : ''}${tab === 'payouts' ? '<button class="btn" id="op">One-off payment</button>' : ''}${tab === 'sched' ? '<button class="btn" id="ns">Schedule a payment</button>' : ''}</span>` : ''}</div>
      ${tab === 'payouts' ? `<div class="card"><h2>Due &amp; overdue</h2>${pays.length ? `<div class="tw"><table><tr><th>Due</th><th>Payee</th><th>For</th><th class="n">Amount</th><th></th></tr>${pays.map((x) => `<tr><td>${dt(x.due_date)}${x.overdue ? ' <span class="pill bad">overdue</span>' : ''}</td><td>${esc(x.payee)} <span class="mute">${KIND[x.kind]}${x.upi_id ? ' · ' + esc(x.upi_id) : ''}</span></td><td>${esc(x.head)}</td><td class="n">${inr(x.amount_paise)}</td>
        <td>${canPay ? `${x.upi_link ? `<a class="btn sm ghost" href="${esc(x.upi_link)}">Open in Google Pay</a> ` : ''}<button class="btn sm gold" data-pay="${x.id}">Mark paid</button> <button class="btn sm ghost" data-skip="${x.id}">Skip</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing due.</p>'}</div>` : ''}
      ${tab === 'sched' ? `<div class="card"><h2>Schedules</h2>${scheds.length ? `<div class="tw"><table><tr><th>Payee</th><th>For</th><th class="n">Amount</th><th>Repeats</th><th>Next due</th><th>Until</th><th></th></tr>${scheds.map((x) => `<tr><td>${esc(x.payee)}</td><td>${esc(x.head)}</td><td class="n">${inr(x.amount_paise)}</td><td>${esc(x.frequency)}</td><td>${x.active ? dt(x.next_due) : '<span class="mute">finished / stopped</span>'}</td><td>${x.end_date ? dt(x.end_date) : '—'}</td>
        <td>${canPay ? `<button class="btn sm ghost" data-st="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? 'Stop' : 'Resume'}</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="mute">No schedules yet.</p>'}</div>` : ''}
      ${tab === 'payees' ? `<div class="card"><h2>Payees</h2>${payees.length ? `<div class="tw"><table><tr><th>Name</th><th>Type</th><th>UPI ID</th><th>Phone</th></tr>${payees.map((x) => `<tr class="${x.active ? '' : 'mute'}"><td>${esc(x.name)}</td><td>${KIND[x.kind]}</td><td>${esc(x.upi_id || '—')}</td><td>${esc(x.phone || '—')}</td></tr>`).join('')}</table></div>` : '<p class="mute">No payees yet.</p>'}</div>` : ''}
      ${tab === 'payouts' ? `<div class="card"><h2>Recently paid</h2>${paid.length ? `<div class="tw"><table><tr><th>Paid on</th><th>Payee</th><th>For</th><th>Mode / ref</th><th class="n">Amount</th></tr>${paid.slice(0, 40).map((x) => `<tr><td>${dt(x.paid_on)}</td><td>${esc(x.payee)}</td><td>${esc(x.head)}</td><td>${esc(x.mode)} ${esc(x.reference || '')}</td><td class="n">${inr(x.amount_paise)}</td></tr>`).join('')}</table></div>` : '<p class="mute">No payouts recorded.</p>'}</div>` : ''}`);
    if (canPay) {
      $$('[data-pay]').forEach((b) => (b.onclick = () => ask('Record payment made', [{ name: 'mode', label: 'Paid by', type: 'select', options: ['upi', 'bank', 'cheque', 'cash'] }, { name: 'reference', label: 'UPI ref / UTR / cheque no. (not needed for cash)' }, { name: 'paid_on', label: 'Paid on', type: 'date', value: today() }], 'Save', async (v) => { await POST(`/api/payee-payments/${b.dataset.pay}/pay`, v); go(); })));
      $$('[data-skip]').forEach((b) => (b.onclick = () => ask('Skip this payment', [{ name: 'reason', label: 'Reason' }], 'Skip', async (v) => { await POST(`/api/payee-payments/${b.dataset.skip}/skip`, v); go(); })));
      $$('[data-st]').forEach((b) => (b.onclick = async () => { await PUT('/api/pay-schedules/' + b.dataset.st, { active: b.dataset.on === '1' }); go(); }));
      const po = () => active.map((x) => [x.id, `${x.name} (${KIND[x.kind]})`]);
      if ($('#np')) $('#np').onclick = async () => { const src = await GET('/api/payee-sources'); const f = { kind: 'other' };
        ask('Add payee', [{ name: 'kind', label: 'Payee is a', type: 'select', options: [['advocate', 'Advocate'], ['staff', 'Staff member'], ['client', 'Client'], ['other', 'Other person / vendor']] },
          { name: 'user_id', label: 'If advocate / staff — pick from team', type: 'select', options: [['', '— not from team —'], ...src.team.map((u) => [u.id, `${u.name} (${u.role})`])] },
          { name: 'client_id', label: 'If client — pick client', type: 'select', options: [['', '— not a client —'], ...src.clients.map((c) => [c.id, c.name])] },
          { name: 'name', label: 'Name (filled automatically when picked above)' }, { name: 'upi_id', label: 'UPI ID (for Google Pay)', ph: 'name@okhdfcbank' }, { name: 'phone', label: 'Phone' }, { name: 'bank_details', label: 'Bank details (A/c no., IFSC) — optional' }], 'Add',
          async (v) => { await POST('/api/payees', { ...v, user_id: v.user_id || null, client_id: v.client_id || null }); go(); }, true); };
      if ($('#ns')) $('#ns').onclick = () => { if (!active.length) return toast('Add a payee first.', true);
        ask('Schedule a payment', [{ name: 'payee_id', label: 'Payee', type: 'select', options: po(), required: true }, { name: 'head', label: 'Purpose (e.g. Salary, Retainer, Refund, Rent)', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true },
          { name: 'frequency', label: 'Repeats', type: 'select', options: [['monthly', 'Every month'], ['weekly', 'Every week'], ['quarterly', 'Every quarter'], ['yearly', 'Every year'], ['once', 'Once only']] }, { name: 'next_due', label: 'First due date', type: 'date', value: today(), required: true }, { name: 'end_date', label: 'Last date (optional)', type: 'date' },
          { name: 'mode', label: 'Usual mode', type: 'select', options: ['bank', 'upi', 'cash', 'cheque'] }, { name: 'narration', label: 'Note' }], 'Schedule', async (v) => { await POST('/api/pay-schedules', v); go(); }, true); };
      if ($('#op')) $('#op').onclick = () => { if (!active.length) return toast('Add a payee first.', true);
        ask('One-off payment', [{ name: 'payee_id', label: 'Payee', type: 'select', options: po(), required: true }, { name: 'head', label: 'Purpose', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true }, { name: 'due_date', label: 'Pay on', type: 'date', value: today() }], 'Add to due list', async (v) => { await POST('/api/payee-payments', v); go(); }); };
    }
  } else if (tab === 'ledgers') {
    const [clients, payees] = await Promise.all([GET('/api/clients'), GET('/api/payees')]), kind = p.get('kind') || 'client', id = p.get('id') || '';
    const opts = kind === 'client' ? clients.map((c) => [c.id, c.name]) : payees.map((x) => [x.id, x.name]);
    let body = '<p class="mute">Choose a ledger above.</p>';
    if (id && kind === 'client') { const a = await GET(`/api/clients/${id}/accounts`);
      body = `<div class="card"><h2>${esc(a.client.name)} — client ledger</h2><div class="tw"><table><tr><th>Date</th><th>Particulars</th><th class="n">Debit (billed)</th><th class="n">Credit (received)</th><th class="n">Balance</th></tr>${a.statement.map((r) => `<tr><td>${dt(r.date)}</td><td>${esc(r.particulars)}</td><td class="n">${r.debit_paise ? inr(r.debit_paise) : ''}</td><td class="n">${r.credit_paise ? inr(r.credit_paise) : ''}</td><td class="n">${inr(r.balance_paise)}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">No entries.</td></tr>'}</table></div><p>Closing balance receivable: <b>${inr(a.balance_paise)}</b> · Expenses recoverable: <b>${inr(a.recoverable_paise)}</b></p></div>`; }
    if (id && kind === 'payee') { const a = await GET(`/api/ledger/payee/${id}`);
      body = `<div class="card"><h2>${esc(a.payee.name)} — payee ledger</h2><div class="tw"><table><tr><th>Date</th><th>For</th><th>Status</th><th>Mode / ref</th><th class="n">Amount</th></tr>${a.rows.map((r) => `<tr><td>${dt(r.paid_on || r.due_date)}</td><td>${esc(r.head)}</td><td>${esc(r.status)}</td><td>${esc((r.mode || '') + ' ' + (r.reference || ''))}</td><td class="n">${inr(r.amount_paise)}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">No entries.</td></tr>'}</table></div><p>Total paid: <b>${inr(a.paid_paise)}</b> · Still due: <b>${inr(a.due_paise)}</b></p></div>`; }
    if (kind === 'head') { const a = await GET('/api/ledger/heads'); body = `<div class="card"><h2>Head-wise ledger (cash book and payouts)</h2><div class="tw"><table><tr><th>Head</th><th class="n">Received</th><th class="n">Paid</th></tr>${a.map((r) => `<tr><td>${esc(r.head)}</td><td class="n">${inr(r.in_paise)}</td><td class="n">${inr(r.out_paise)}</td></tr>`).join('') || '<tr><td colspan="3" class="mute">No entries.</td></tr>'}</table></div></div>`; }
    view(`${head}<form class="row noprint" id="lf" style="margin-bottom:.8rem"><label class="mute">Ledger of</label><select name="kind"><option value="client" ${kind === 'client' ? 'selected' : ''}>Client</option><option value="payee" ${kind === 'payee' ? 'selected' : ''}>Payee</option><option value="head" ${kind === 'head' ? 'selected' : ''}>Heads of account</option></select>
      ${kind !== 'head' ? `<select name="id"><option value="">— choose —</option>${opts.map(([v, l]) => `<option value="${v}" ${String(v) === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}<button class="btn ghost">Show</button>${id || kind === 'head' ? '<button type="button" class="btn sm" data-print>Print</button>' : ''}</form>${body}`);
    $('#lf').onsubmit = (e) => { e.preventDefault(); const f = e.target; location.hash = `#/accounts/ledgers?kind=${f.kind.value}${f.id ? '&id=' + f.id.value : ''}`; };
    $('#lf').kind.onchange = () => { location.hash = `#/accounts/ledgers?kind=${$('#lf').kind.value}`; };
  } else if (tab === 'reports' || tab === 'audit' || tab === 'heads') { await accTab(tab, head, p);
  } else view('<div class="card">Unknown section.</div>');
}, { roles: ['admin', 'advocate', 'accounts'] });
