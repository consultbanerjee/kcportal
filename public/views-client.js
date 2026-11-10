'use strict';
/* ===== Client page: one place for everything about a client. Every tab reads/writes the firm's main books (Billing, Cash book, Drafts, Files). ===== */
route(/^\/client\/(\d+)$/, async ([id], p) => {
  const c = await GET('/api/clients/' + id);
  const bill = can('admin', 'advocate', 'accounts'), files = can('admin', 'advocate', 'staff', 'accounts'), draft = can('admin', 'advocate', 'staff');
  const tabs = [['overview', 'Overview']];
  if (draft) tabs.push(['cases', 'Cases'], ['tasks', 'Tasks']);
  if (files) tabs.push(['files', 'Files']);
  if (draft) tabs.push(['register', 'In-Out'], ['letters', 'Letters']);
  if (bill) tabs.push(['invoices', 'Invoices'], ['payments', 'Receipts'], ['expenses', 'Expenses'], ['cash', 'Cash entries'], ['accounts', 'Accounts']);
  if (draft) tabs.push(['drafts', 'Drafts'], ['chat', 'Messages'], ['whatsapp', 'WhatsApp'], ['activity', 'Activity']);
  let tab = p.get('tab') || 'overview'; if (!tabs.some((t) => t[0] === tab)) tab = 'overview';
  const bal = c.billed_paise - c.paid_paise;
  view(`<div class="row sp"><div><h1 style="margin-bottom:.1rem">${esc(c.name)}</h1><div class="mute">${esc(c.phone || '—')} · ${esc(c.email || 'no email')}${c.reference ? ' · Reference: <b>' + esc(c.reference) + '</b>' : ''}</div></div><a class="btn ghost sm" href="#/clients">← Clients</a></div>
    ${bill ? `<div class="chead" style="margin:.6rem 0 .8rem"><div class="chip"><b>${inr(c.billed_paise)}</b><span>Billed</span></div><div class="chip"><b>${inr(c.paid_paise)}</b><span>Received</span></div><div class="chip"><b style="color:${bal > 0 ? 'var(--bad)' : 'var(--ok)'}">${inr(bal)}</b><span>${bal < 0 ? 'Advance / credit' : 'Balance due'}</span></div></div>` : ''}
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/client/${id}?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div><div id="tab"></div>`);
  const T = $('#tab'), reload = () => go();
  const matterSel = [['', '— none —'], ...c.matters.map((m) => [m.id, m.file_no + ' · ' + m.title])];

  if (tab === 'overview') {
    const showInvite = (pth) => show('Portal invitation', `<p>Send this private link to the client. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + pth)}"><p class="mute">Share by WhatsApp or email. The client then sets their own password.</p>`);
    T.innerHTML = `<div class="card"><div class="row sp"><div>${esc(c.phone || '—')} · ${esc(c.email || 'no email')}<div class="mute">${esc(c.address || '')}</div>${c.reference ? `<div class="mute">Reference: <b>${esc(c.reference)}</b></div>` : ''}${c.notes && !isClient() ? `<div class="mute" style="margin-top:.4rem">${esc(c.notes)}</div>` : ''}</div>
      <div class="row"><button class="btn sm ghost" id="edit">Edit</button>${can('admin', 'advocate', 'staff') ? `<button class="btn sm gold" id="inv">${c.login ? 'Re-send portal link' : 'Give portal access'}</button>` : ''}</div></div>
      ${c.login ? `<p class="mute">Portal login: ${esc(c.login.email)} ${c.login.set_up ? pill('password set', 'ok') : pill('invitation pending', 'warn')}</p>` : ''}</div>
      ${can('admin', 'advocate') ? `<div class="card noprint"><h2>Client portal access</h2>
        <div class="row sp" style="margin:.4rem 0"><span><b>Portal sign-in</b><div class="mute">${c.portal_blocked ? 'BLOCKED — the client cannot sign in or see anything.' : 'Allowed — the client can sign in to the portal.'}</div></span><button class="btn sm ${c.portal_blocked ? 'gold' : 'ghost'}" id="tp">${c.portal_blocked ? 'Allow access' : 'Block access'}</button></div>
        <div class="row sp" style="margin:.4rem 0"><span><b>Document sharing</b><div class="mute">${c.share_blocked ? 'OFF — the client cannot see documents you shared (the Shared folder is hidden).' : 'On — the client sees what is in the Shared folder.'}</div></span><button class="btn sm ${c.share_blocked ? 'gold' : 'ghost'}" id="ts">${c.share_blocked ? 'Turn sharing on' : 'Turn sharing off'}</button></div>
        <div class="row sp" style="margin:.4rem 0"><span><b>Payment reminders</b><div class="mute">${c.no_reminders ? 'OFF — no automatic payment reminders are sent to this client.' : 'On — unpaid invoices get the automatic reminders set in Settings.'}</div></span><button class="btn sm ${c.no_reminders ? 'gold' : 'ghost'}" id="tr">${c.no_reminders ? 'Turn reminders on' : 'Turn reminders off'}</button></div>
        ${can('admin') ? '<p class="mute" style="margin:.6rem 0 0">To close the portal for every client at once, use <a href="#/settings">Settings</a>.</p>' : ''}</div>` : ''}
      <div class="card"><div class="row sp"><h2>Cases</h2>${can('admin', 'advocate', 'staff') ? '<button class="btn sm" id="nm">New case</button>' : ''}</div>
      ${c.matters.length ? `<ul class="list">${c.matters.map((m) => `<li><a href="#/matter/${m.id}">${esc(m.title)}</a><span class="mute">${esc(m.file_no)} ${sp(m.status)}</span></li>`).join('')}</ul>` : '<p class="mute">No cases yet.</p>'}</div>`;
    $('#edit').onclick = async () => ask('Edit client', [{ name: 'name', label: 'Name', value: c.name, required: true }, { name: 'reference', label: 'Reference (through whom the client came)', value: c.reference || '', list: await refList(), hint: 'Changing this moves the client\'s folder in Google Drive to the new Reference folder.' }, { name: 'phone', label: 'Phone', value: c.phone }, { name: 'email', label: 'Email', value: c.email }, { name: 'address', label: 'Address', type: 'textarea', value: c.address }, { name: 'notes', label: 'Internal notes', type: 'textarea', value: c.notes }], 'Save', async (v) => { await PUT('/api/clients/' + id, v); reload(); });
    const inv = $('#inv'); if (inv) inv.onclick = () => ask('Portal access', [{ name: 'email', label: 'Client email (login)', type: 'email', value: c.email, required: true }], 'Create link', async (v) => { const r = await POST(`/api/clients/${id}/login`, v); setTimeout(() => showInvite(r.invite_path), 50); });
    const nm = $('#nm'); if (nm) nm.onclick = () => newMatter(id);
    const tog = (btn, key, now, msg) => { if (btn) btn.onclick = async () => { if (!now && !sure(msg)) return; try { await PUT(`/api/clients/${id}/access`, { [key]: !now }); reload(); } catch (e) { toast(e.message, true); } }; };
    tog($('#tp'), 'portal_blocked', !!c.portal_blocked, 'Block this client from the portal? They will be shut out immediately (their data is not touched).');
    tog($('#tr'), 'no_reminders', !!c.no_reminders, '');
    tog($('#ts'), 'share_blocked', !!c.share_blocked, 'Turn off document sharing for this client? They will no longer see anything you have shared.');
  }

  else if (tab === 'cases') {
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${c.matters.length} case${c.matters.length === 1 ? '' : 's'}</span>${can('admin', 'advocate', 'staff') ? '<button class="btn" id="nm">New case</button>' : ''}</div>
      <div class="card">${c.matters.length ? `<div class="tw"><table><tr><th>File</th><th>Case</th><th>Forum</th><th>Status</th></tr>${c.matters.map((m) => `<tr><td>${esc(m.file_no)}</td><td><a href="#/matter/${m.id}">${esc(m.title)}</a></td><td>${esc(m.forum || '—')}</td><td>${sp(m.status)}</td></tr>`).join('')}</table></div>` : '<p class="mute">No cases yet.</p>'}</div>`;
    const nm = $('#nm'); if (nm) nm.onclick = () => newMatter(id);
  }

  else if (tab === 'tasks') {
    const rows = await GET('/api/tasks?view=all&client_id=' + id);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">Tasks on this client's cases</span><button class="btn" id="at">Assign task</button></div>
      <div class="card">${rows.length ? `<ul class="list">${rows.map((t) => `<li><span><b>${esc(t.title)}</b> ${t.priority === 'high' ? pill('high', 'bad') : ''}<div class="mute">${esc(t.assignee || '')}${t.file_no ? ' · ' + esc(t.file_no) : ''} · due ${dt(t.due_date)}</div>${t.details ? `<div>${esc(t.details)}</div>` : ''}</span>
        <select data-t="${t.id}" style="width:auto">${['todo', 'doing', 'review', 'done'].map((x) => `<option ${x === t.status ? 'selected' : ''}>${x}</option>`).join('')}</select></li>`).join('')}</ul>` : '<p class="mute">No tasks yet.</p>'}</div>`;
    $('#at').onclick = async () => {
      if (!c.matters.length) { toast('Create a case for this client first; tasks are attached to a case.', true); return; }
      ask('Assign task for ' + c.name, [{ name: 'matter_id', label: 'Case', type: 'select', options: matterSel.slice(1), required: true }, { name: 'title', label: 'Task', required: true }, { name: 'details', label: 'Details', type: 'textarea' },
        { name: 'assigned_to', label: 'Assign to', type: 'select', options: await teamOpts(), value: ME.id }, { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'priority', label: 'Priority', type: 'select', options: [['normal', 'Normal'], ['high', 'High']] }], 'Assign', async (v) => { await POST('/api/tasks', v); reload(); });
    };
    $$('[data-t]').forEach((x) => (x.onchange = async () => { try { await PATCH('/api/tasks/' + x.dataset.t, { status: x.value }); toast('Updated.'); } catch (e) { toast(e.message, true); reload(); } }));
  }

  else if (tab === 'register') {
    const rows = await GET('/api/register?client_id=' + id), t = regTable(rows, false);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">Inward and outward letters / communications for this client</span><span class="row"><button class="btn" id="ai">+ Inward</button><button class="btn" id="ao">+ Outward</button></span></div><div class="card" id="rt">${t.html}</div>`;
    $('#ai').onclick = () => regForm('in', null, +id, reload); $('#ao').onclick = () => regForm('out', null, +id, reload);
    regWire($('#rt'), rows, reload);
  }

  else if (tab === 'letters') {
    const rows = await GET('/api/letters?client_id=' + id);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} letter${rows.length === 1 ? '' : 's'} (drafted in the portal)</span><button class="btn" id="al">Draft letter</button></div>
      <div class="card">${rows.length ? `<ul class="list">${rows.map((l) => `<li><span><a href="#/letter/${l.id}">${esc(l.subject)}</a><div class="mute">${esc(l.ref_no || '')} · to ${esc(l.to_name)}${l.file_no ? ' · ' + esc(l.file_no) : ''}</div></span>${sp(l.status)}</li>`).join('')}</ul>` : '<p class="mute">No letters yet.</p>'}</div>`;
    $('#al').onclick = () => ask('Draft letter for ' + c.name, [{ name: 'to_name', label: 'To', required: true, value: c.name }, { name: 'subject', label: 'Subject', required: true }, { name: 'matter_id', label: 'Case', type: 'select', options: matterSel }, { name: 'body', label: 'Letter', type: 'textarea', required: true }, { name: 'client_visible', label: 'Make visible to the client when sent', type: 'checkbox' }], 'Save draft', async (v) => { const r = await POST('/api/letters', { ...v, client_id: id }); location.hash = '#/letter/' + r.id; }, true);
  }

  else if (tab === 'files') {
    T.innerHTML = '<p class="mute noprint">Everything for this client in one place. <b>Shared</b> is the folder the client sees in their portal — put a document there (or Copy/Move it there) to share it;  <b>Uploaded</b> holds incoming papers (including what the client sends), <b>Drafts</b> your drafts, <b>Judgements</b> orders and judgements, and <b>Final</b> the scanned copies of what was filed in court. ' + (can('admin') ? '<a href="#/storage">Storage settings</a>' : '') + '</p><div id="fx"></div>';
    explorer($('#fx'), { client: +id, scopeName: c.name, cli: false });
  }

  else if (tab === 'invoices') {
    const rows = await GET('/api/invoices?client_id=' + id);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} invoice${rows.length === 1 ? '' : 's'}</span><button class="btn" id="add">New invoice</button></div>
      <div class="card"><div class="tw">${rows.length ? `<table><tr><th>No.</th><th>Date</th><th>Status</th><th class="n">Total</th><th class="n">Received</th><th class="n">Due</th></tr>${rows.map((i) => `<tr><td><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a></td><td>${dt(i.inv_date)}</td><td>${sp(i.status)}</td><td class="n">${inr(i.total_paise)}</td><td class="n">${inr(i.paid_paise)}</td><td class="n">${['draft', 'cancelled'].includes(i.status) ? '' : inr(i.total_paise - i.paid_paise)}</td></tr>`).join('')}</table>` : '<p class="mute">No invoices yet.</p>'}</div></div>`;
    $('#add').onclick = () => ask('New invoice for ' + c.name, [{ name: 'matter_id', label: 'Matter', type: 'select', options: matterSel }, { name: 'inv_date', label: 'Date', type: 'date', value: today() }, { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'lines', label: 'Items — one per line: Description | Qty | Rate (₹)', type: 'textarea', required: true, ph: 'Professional fee — hearing | 1 | 15000\nDrafting of reply | 1 | 5000' }, { name: 'notes', label: 'Notes on invoice' }], 'Create draft', async (v) => {
      const items = v.lines.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const [d, q, r] = s.split('|').map((x) => x.trim()); if (!d || !(+r > 0)) throw new Error('Check this line: ' + s); return { description: d, qty: +q || 1, rate: +r }; });
      const r = await POST('/api/invoices', { ...v, client_id: id, items, matter_id: v.matter_id || null }); location.hash = '#/invoice/' + r.id; }, true);
  }

  else if (tab === 'payments') {
    const rows = await GET('/api/payments?client_id=' + id);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">${rows.length} receipt${rows.length === 1 ? '' : 's'}</span><button class="btn" id="add">Record payment</button></div>
      <div class="card"><div class="tw">${rows.length ? `<table><tr><th>Receipt</th><th>Date</th><th>Mode</th><th>Against</th><th class="n">Amount</th></tr>${rows.map((x) => `<tr><td><a href="#/receipt/${x.id}">${esc(x.rec_no)}</a></td><td>${dt(x.pay_date)}</td><td>${esc(x.mode)}</td><td>${esc(x.inv_no || 'On account')}</td><td class="n">${inr(x.amount_paise)}</td></tr>`).join('')}</table>` : '<p class="mute">No receipts yet.</p>'}</div></div>`;
    $('#add').onclick = () => recordPaymentModal(+id);
  }

  else if (tab === 'expenses') {
    const r = await GET('/api/expenses?client_id=' + id);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">Spent for this client: <b>${inr(r.total_paise)}</b> · Recoverable from client: <b>${inr(r.recoverable_paise)}</b></span><button class="btn" id="add">Add expense</button></div>
      <div class="card"><div class="tw">${r.rows.length ? `<table><tr><th>Date</th><th>Head</th><th>Paid by</th><th>Matter</th><th>Recoverable</th><th class="n">Amount</th><th></th></tr>${r.rows.map((x) => `<tr><td>${dt(x.exp_date)}</td><td>${esc(x.head)}<div class="mute">${esc(x.narration || '')}</div></td><td>${{ cash: 'Cash', bank: 'Bank', other: 'Other' }[x.mode]}</td><td>${esc(x.file_no || '')}</td><td>${x.reimbursable ? 'Yes' : '—'}</td><td class="n">${inr(x.amount_paise)}</td><td>${can('admin', 'accounts') ? `<button class="btn sm ghost" data-del="${x.id}">Delete</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="mute">No expenses recorded. Court fees, stamp duty, photocopies, travel and similar costs for this client go here.</p>'}</div></div>
      <p class="mute">Cash expenses also appear in the Cash book. Bank expenses are matched from your bank statement. “Other” expenses (paid personally or by another route) flow into the final accounts report.</p>`;
    $('#add').onclick = () => ask('Add expense for ' + c.name, [{ name: 'exp_date', label: 'Date', type: 'date', value: today() }, { name: 'head', label: 'Head', required: true, ph: 'Court fees, Stamp duty, Travel, Photocopy…' }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true },
      { name: 'mode', label: 'Paid from', type: 'select', options: [['cash', 'Cash in hand (adds a cash-book entry)'], ['bank', 'Bank account'], ['other', 'Other / paid personally']] }, { name: 'matter_id', label: 'Matter', type: 'select', options: matterSel },
      { name: 'reimbursable', label: 'To be recovered from the client', type: 'checkbox' }, { name: 'narration', label: 'Note' }], 'Save', async (v) => { await POST('/api/expenses', { ...v, client_id: id, matter_id: v.matter_id || null }); toast('Saved.'); reload(); });
    $$('[data-del]').forEach((b) => (b.onclick = async () => { if (sure('Delete this expense? Its cash-book entry (if any) is removed too.')) { await DEL('/api/expenses/' + b.dataset.del); reload(); } }));
  }

  else if (tab === 'cash') {
    const r = await GET('/api/cash?client_id=' + id);
    T.innerHTML = `<div class="row sp" style="margin-bottom:.8rem"><span class="mute">Cash entries linked to this client</span><button class="btn" id="add">New cash entry</button></div>
      <div class="card"><div class="tw">${r.rows.length ? `<table><tr><th>Date</th><th>Head</th><th>Narration</th><th class="n">Received</th><th class="n">Paid</th><th class="n">Net</th></tr>${r.rows.map((x) => `<tr><td>${dt(x.entry_date)}</td><td>${esc(x.head)}</td><td>${esc(x.narration || '')}</td><td class="n">${x.kind === 'in' ? inr(x.amount_paise) : ''}</td><td class="n">${x.kind === 'out' ? inr(x.amount_paise) : ''}</td><td class="n">${inr(x.balance_paise)}</td></tr>`).join('')}</table>` : '<p class="mute">No cash entries for this client.</p>'}</div></div>`;
    $('#add').onclick = () => ask('Cash entry for ' + c.name, [{ name: 'kind', label: 'Type', type: 'select', options: [['in', 'Cash received'], ['out', 'Cash paid']] }, { name: 'head', label: 'Head', required: true, ph: 'Fees in cash, Court fees, Travel…' }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true }, { name: 'entry_date', label: 'Date', type: 'date', value: today() }, { name: 'narration', label: 'Narration' }],
      'Save', async (v) => { await POST('/api/cash', { ...v, client_id: id }); toast('Saved.'); reload(); });
  }

  else if (tab === 'accounts') {
    const a = await GET(`/api/clients/${id}/accounts`);
    const part = (rows) => (rows.length ? rows.map((x) => `<tr><td>${dt(x.date)}</td><td>${esc(x.particulars)}</td><td class="n">${inr(x.amount_paise)}</td></tr>`).join('') : '<tr><td colspan="3" class="mute">Nil</td></tr>');
    T.innerHTML = `<div class="row sp noprint" style="margin-bottom:.8rem"><span class="mute">Statement and receipts &amp; payments for ${esc(c.name)}</span><button class="btn sm" data-print>Print</button></div>
      <div class="card"><h2>Statement of account</h2><div class="tw">${a.statement.length ? `<table><tr><th>Date</th><th>Particulars</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Balance</th></tr>${a.statement.map((r) => `<tr><td>${dt(r.date)}</td><td>${esc(r.particulars)}</td><td class="n">${r.debit_paise ? inr(r.debit_paise) : ''}</td><td class="n">${r.credit_paise ? inr(r.credit_paise) : ''}</td><td class="n">${inr(r.balance_paise)}</td></tr>`).join('')}<tr><td colspan="4"><b>Balance ${a.balance_paise < 0 ? '(credit)' : 'due'}</b></td><td class="n"><b>${inr(a.balance_paise)}</b></td></tr></table>` : '<p class="mute">No billing yet.</p>'}</div>
      ${a.advance_paise ? `<p class="mute">Of the receipts, ${inr(a.advance_paise)} is on account (not yet set against an invoice).</p>` : ''}</div>
      <div class="grid2"><div class="card"><h2>Receipts</h2><div class="tw"><table><tr><th>Date</th><th>Particulars</th><th class="n">Amount</th></tr>${part(a.receipts)}<tr><td colspan="2"><b>Total received</b></td><td class="n"><b>${inr(a.receipts_paise)}</b></td></tr></table></div></div>
      <div class="card"><h2>Payments</h2><div class="tw"><table><tr><th>Date</th><th>Particulars</th><th class="n">Amount</th></tr>${part(a.payments)}<tr><td colspan="2"><b>Total paid</b></td><td class="n"><b>${inr(a.payments_paise)}</b></td></tr></table></div></div></div>
      <div class="card"><p>Net received less paid for this client: <b>${inr(a.net_paise)}</b>${a.recoverable_paise ? ` · Expenses still recoverable from the client: <b>${inr(a.recoverable_paise)}</b>` : ''}</p>
      <p class="mute">These figures come from the same records as Billing and the Cash book, so they always agree with the firm's main accounts.</p></div>`;
  }

  else if (tab === 'drafts') {
    const d = await GET(`/api/clients/${id}/drafts`);
    T.innerHTML = `<div class="row" style="margin-bottom:.8rem">${FEAT.drafting ? `<a class="btn gold" href="#/draft?client=${id}">New AI draft</a>` : ''}<button class="btn" id="nl">New letter</button></div>
      ${FEAT.drafting ? `<div class="card"><h2>AI drafts</h2>${d.ai.length ? `<ul class="list">${d.ai.map((x) => `<li><span><a href="#/draft/${x.id}"><b>${esc(x.title)}</b></a><div class="mute">${esc(x.kind.replace(/_/g, ' '))} · ${esc(x.by)} · ${dtm(x.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">No AI drafts for this client yet.</p>'}</div>` : ''}
      <div class="card"><h2>Letters</h2>${d.letters.length ? `<ul class="list">${d.letters.map((x) => `<li><a href="#/letter/${x.id}">${esc(x.subject)}</a><span class="mute">${esc(x.ref_no || 'draft')} ${sp(x.status)}</span></li>`).join('')}</ul>` : '<p class="mute">No letters for this client yet.</p>'}</div>`;
    $('#nl').onclick = () => ask('Draft letter to ' + c.name, [{ name: 'to_name', label: 'To', value: c.name, required: true }, { name: 'subject', label: 'Subject', required: true }, { name: 'matter_id', label: 'Matter', type: 'select', options: matterSel }, { name: 'body', label: 'Letter', type: 'textarea', required: true }, { name: 'client_visible', label: 'Show to client once approved', type: 'checkbox' }],
      'Save draft', async (v) => { const r = await POST('/api/letters', { ...v, client_id: id, matter_id: v.matter_id || null }); location.hash = '#/letter/' + r.id; }, true);
  }
  else if (tab === 'chat') {
    const rows = await GET('/api/messages?client_id=' + id);
    T.innerHTML = `<div class="row sp noprint" style="margin-bottom:.8rem"><span class="mute">Conversation with ${esc(c.name)} — ${rows.length} message${rows.length === 1 ? '' : 's'}</span>${can('admin') ? '<button class="btn sm" data-print>Print / Save as PDF</button>' : ''}</div>
      <div class="printhead"><h2 style="margin:0">${esc(FIRM)}</h2><div>Chat record — ${esc(c.name)}</div><div class="mute">Printed ${dtm(new Date().toISOString())} by ${esc(ME.name)}</div><hr></div>
      <div class="card">${rows.length ? rows.map((m) => `<div class="msg ${m.from_user === ME.id ? 'me' : ''}"><small>${esc(m.from_name)} · ${dtm(m.created_at)}</small>${esc(m.body)}</div>`).join('') : '<p class="mute">No messages yet.</p>'}
      <form id="mf" class="row noprint" style="margin-top:1rem;flex-wrap:nowrap"><input name="b" placeholder="Write a message…" required><button class="btn">Send</button></form></div>`;
    $('#mf').onsubmit = async (e) => { e.preventDefault(); try { await POST('/api/messages', { body: e.target.b.value, client_id: +id }); reload(); } catch (x) { toast(x.message, true); } };
  }

  else if (tab === 'whatsapp') {
    const w = await GET(`/api/clients/${id}/whatsapp`);
    const ic = { queued: '…', opened: '↗', sent: '✓', delivered: '✓✓', read: '✓✓', received: '', failed: '⚠' };
    T.innerHTML = `<div class="card"><div class="row sp"><span><b>${esc(w.phone || 'No mobile number')}</b> ${w.number ? '' : pill('add a valid mobile number', 'warn')}<div class="mute">${w.configured ? 'Sent through the firm\'s WhatsApp Business number.' : 'WhatsApp Business is not set up yet (Settings → WhatsApp): messages open in WhatsApp on your phone/computer for you to send.'}</div></span>
        <label class="chk"><input type="checkbox" id="oo" ${w.optout ? 'checked' : ''}> Client does not want WhatsApp</label></div></div>
      <div class="card">${w.messages.length ? w.messages.map((m) => `<div class="msg ${m.direction === 'out' ? 'me' : ''}"><small>${m.direction === 'out' ? 'Sent' : 'Client'} · ${dtm(m.created_at.replace(' ', 'T') + 'Z')} ${m.template ? '· template' : ''} <b>${ic[m.status] || ''}</b> ${m.status === 'failed' ? esc(m.error || '') : esc(m.status)}</small>${esc(m.body)}</div>`).join('') : '<p class="mute">No WhatsApp messages yet.</p>'}</div>
      ${w.optout ? '<p class="err">This client opted out. No messages can be sent.</p>' : `<div class="card noprint"><h2>Send a message</h2>
        <label>Message type</label><select id="wt">${w.templates.map((t) => `<option value="${esc(t.name)}">${esc(t.label || t.name)}</option>`).join('')}<option value="">Free text (client wrote to us in the last 24 hours)</option></select>
        <div id="wv"></div><label id="wl" hidden>Message</label><textarea id="wx" rows="3" maxlength="1500" hidden></textarea>
        <p class="mute" id="wp"></p><div class="row"><button class="btn" id="ws" ${w.number ? '' : 'disabled'}>${w.configured ? 'Send WhatsApp' : 'Open in WhatsApp'}</button></div></div>`}`;
    $('#oo').onchange = async (e) => { await PUT(`/api/clients/${id}/whatsapp-consent`, { optout: e.target.checked }); reload(); };
    const sel = $('#wt'); if (sel) {
      const defaults = (n, i) => ({ 'Client name': c.name, Firm: FIRM }[n] || '');
      const draw = () => { const t = w.templates.find((x) => x.name === sel.value); $('#wv').innerHTML = t ? (t.vars || []).map((v, i) => `<label>${esc(v)}</label><input data-v="${i}" value="${esc(defaults(v))}">`).join('') : ''; $('#wx').hidden = $('#wl').hidden = !!t; $('#wp').textContent = t ? 'Template: ' + t.text : (w.window_open ? 'The client wrote recently, so free text is allowed.' : (w.configured ? 'Free text is blocked: the client has not written in the last 24 hours. Use a template.' : '')); };
      sel.onchange = draw; draw();
      $('#ws').onclick = async () => {
        try { const t = w.templates.find((x) => x.name === sel.value);
          const r = await POST(`/api/clients/${id}/whatsapp`, t ? { template: t.name, vars: $$('[data-v]').map((i) => i.value) } : { text: $('#wx').value });
          if (r.link) window.open(r.link, '_blank', 'noopener'); else toast('Sent.'); reload(); } catch (e) { toast(e.message, true); }
      };
    }
  }

  else if (tab === 'activity') {
    const from = p.get('from') || '', to = p.get('to') || '', a = await GET(`/api/clients/${id}/activity?from=${from}&to=${to}`);
    T.innerHTML = `<div class="row sp noprint" style="margin-bottom:.8rem"><form id="af" class="row"><label class="mute">From</label><input type="date" name="f" value="${esc(from)}"><label class="mute">To</label><input type="date" name="t" value="${esc(to)}"><button class="btn sm ghost">Filter</button></form>${can('admin') ? '<button class="btn sm" data-print>Print / Save as PDF</button>' : ''}</div>
      <div class="printhead"><h2 style="margin:0">${esc(FIRM)}</h2><div>Portal activity — ${esc(c.name)}${from || to ? ` (${esc(from || 'start')} to ${esc(to || 'today')})` : ''}</div><div class="mute">Printed ${dtm(new Date().toISOString())} by ${esc(ME.name)}</div><hr></div>
      <div class="card"><div class="tw">${a.rows.length ? `<table><tr><th>When</th><th>What the client did</th><th>Details</th><th>From (IP)</th></tr>${a.rows.map((r) => `<tr><td>${dtm(r.at.replace(' ', 'T') + 'Z')}</td><td>${esc(r.what)}</td><td>${esc(r.detail)}</td><td class="mute">${esc(r.ip)}</td></tr>`).join('')}</table>` : '<p class="mute">Nothing recorded for this client yet. Activity starts being recorded once the client signs in.</p>'}</div></div>`;
    $('#af').onsubmit = (e) => { e.preventDefault(); location.hash = `#/client/${id}?tab=activity&from=${e.target.f.value}&to=${e.target.t.value}`; };
  }

  // only the Admin may print or save the chat / activity record: for everyone else those screens print blank
  if ((tab === 'chat' || tab === 'activity') && !can('admin')) T.classList.add('noprint');
  $$('[data-print]').forEach((b) => (b.onclick = () => window.print()));
}, { office: true });
