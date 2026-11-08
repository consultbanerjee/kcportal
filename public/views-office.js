'use strict';
let TEAM = null;
async function team() { if (!TEAM) TEAM = (await GET('/api/users')).filter((u) => u.active); return TEAM; }
const teamOpts = async (blank) => [...(blank ? [['', blank]] : []), ...(await team()).map((u) => [u.id, u.name + ' (' + u.role + ')'])];
const clientOpts = async () => (await GET('/api/clients')).map((c) => [c.id, c.name + (c.phone ? ' · ' + c.phone : '')]);
const matterOpts = async (blank) => [['', blank || '— none —'], ...(await GET('/api/matters')).map((m) => [m.id, m.file_no + ' · ' + m.title])];
const searchBar = (ph, val) => `<div class="row noprint" style="margin-bottom:.8rem"><input id="q" placeholder="${ph}" value="${esc(val || '')}" style="flex:1;min-width:180px"></div>`;
function liveSearch(fn) { let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => fn(e.target.value), 250); }); }

/* ===== home ===== */
route(/^\/$/, async () => {
  const d = await GET('/api/dashboard');
  if (isClient()) {
    view(`<h1>Welcome, ${esc(ME.name.split(' ')[0])}</h1>
      <div class="grid"><a class="stat" href="#/matters"><b>${d.matters}</b><span>Open cases</span></a>
      <a class="stat" href="#/letters"><b>${d.unread_letters}</b><span>New letters</span></a>
      <a class="stat" href="#/messages"><b>${d.unread_messages}</b><span>New messages</span></a>
      <a class="stat ${d.due_paise ? 'alert' : ''}" href="#/invoices"><b>${inr(d.due_paise)}</b><span>Fees due</span></a></div>
      <div class="card" style="margin-top:1rem"><h2>Next court dates</h2>${d.next_dates.length ? `<ul class="list">${d.next_dates.map((x) => `<li><a href="#/matter/${x.matter_id}">${esc(x.title)}</a><b>${dt(x.date)}</b></li>`).join('')}</ul>` : '<p class="mute">No upcoming dates recorded.</p>'}</div>
      <div class="card"><div class="row sp"><h2>Consultations</h2><a class="btn sm" href="#/book">Book a call</a></div>${d.appointments.length ? `<ul class="list">${d.appointments.map((a) => `<li><span>${dtm(a.start_at)}</span><span>${sp(a.status)} ${a.meet_link ? `<a href="${esc(a.meet_link)}" target="_blank" rel="noopener">Join</a>` : ''}</span></li>`).join('')}</ul>` : '<p class="mute">None booked.</p>'}</div>`);
    return;
  }
  view(`<div class="row sp"><h1>Good day, ${esc(ME.name.split(' ')[0])}</h1>${can('admin', 'advocate', 'staff', 'telecaller') ? '<button class="btn gold" id="qc">+ Add client</button>' : ''}</div>
    <div class="grid">
    <a class="stat" href="#/matters"><b>${d.open_matters}</b><span>Open matters</span></a>
    <a class="stat" href="#/tasks"><b>${d.my_tasks}</b><span>My tasks</span></a>
    <a class="stat ${d.overdue_tasks ? 'alert' : ''}" href="#/tasks?view=overdue"><b>${d.overdue_tasks}</b><span>Overdue tasks</span></a>
    <a class="stat" href="#/leads"><b>${d.new_leads}</b><span>New leads</span></a>
    <a class="stat" href="#/appointments"><b>${d.appointments_today}</b><span>Calls today</span></a>
    <a class="stat" href="#/messages"><b>${d.unread_messages}</b><span>Client messages</span></a>
    <a class="stat" href="#/letters"><b>${d.drafts_to_approve}</b><span>Letter drafts</span></a></div>
    <div class="card" style="margin-top:1rem"><h2>Court dates — next 7 days</h2>${d.dates.length ? `<ul class="list">${d.dates.map((x) => `<li><span><a href="#/matter/${x.matter_id}">${esc(x.title)}</a><div class="mute">${esc(x.file_no)} · ${esc(x.forum || '')}</div></span><b>${dt(x.date)}</b></li>`).join('')}</ul>` : '<p class="mute">Nothing listed for the coming week.</p>'}</div>`);
  const qc = $('#qc'); if (qc) qc.onclick = () => addClient();
}, {});

/* ===== clients ===== */
route(/^\/clients$/, async () => {
  const draw = async (q) => {
    const rows = await GET('/api/clients?' + qs({ q }));
    $('#res').innerHTML = rows.length ? `<div class="tw"><table><tr><th>Name</th><th>Phone</th><th>Matters</th><th>Portal</th></tr>${rows.map((c) => `<tr><td><a href="#/client/${c.id}">${esc(c.name)}</a></td><td>${esc(c.phone)}</td><td>${c.matters}</td><td>${c.has_login ? pill('active', 'ok') : '—'}</td></tr>`).join('')}</table></div>` : '<p class="mute">No clients found.</p>';
  };
  view(`<div class="row sp"><h1>Clients</h1>${can('admin', 'advocate', 'staff', 'telecaller') ? '<button class="btn" id="add">Add client</button>' : ''}</div>${searchBar('Search name, phone or email')}<div class="card" id="res"></div>`);
  liveSearch(draw); draw('');
  const add = $('#add'); if (add) add.onclick = () => addClient();
}, { office: true });

/* add a client; optionally create the portal login straight away */
function addClient() {
  const canLogin = can('admin', 'advocate', 'staff');
  return ask('New client', [{ name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email', hint: 'Needed if you give the client portal access.' }, { name: 'address', label: 'Address', type: 'textarea' },
    ...(canLogin ? [{ name: 'portal', label: 'Give portal access now (creates a private invitation link)', type: 'checkbox' }] : [])], 'Save', async (v) => {
    if (v.portal && !/^\S+@\S+\.\S+$/.test(v.email)) throw new Error('Enter the client\'s email to give portal access.');
    const r = await POST('/api/clients', v); let link = null;
    if (v.portal) link = (await POST(`/api/clients/${r.id}/login`, { email: v.email })).invite_path;
    location.hash = '#/client/' + r.id;
    if (link) setTimeout(() => show('Portal invitation', `<p>Send this private link to the client. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + link)}"><p class="mute">Share by WhatsApp or email. The client then sets their own password.</p>`), 300);
  });
}

route(/^\/client\/(\d+)$/, async ([id]) => {
  const c = await GET('/api/clients/' + id);
  const showInvite = (p) => show('Portal invitation', `<p>Send this private link to the client. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + p)}"><p class="mute">Share by WhatsApp or email. The client then sets their own password.</p>`);
  view(`<div class="row sp"><h1>${esc(c.name)}</h1><a class="btn ghost sm" href="#/clients">← Clients</a></div>
    <div class="card"><div class="row sp"><div>${esc(c.phone || '—')} · ${esc(c.email || 'no email')}<div class="mute">${esc(c.address || '')}</div></div>
    <div class="row"><button class="btn sm ghost" id="edit">Edit</button>${can('admin', 'advocate', 'staff') ? `<button class="btn sm gold" id="inv">${c.login ? 'Re-send portal link' : 'Give portal access'}</button>` : ''}</div></div>
    ${c.login ? `<p class="mute">Portal login: ${esc(c.login.email)} ${c.login.set_up ? pill('password set', 'ok') : pill('invitation pending', 'warn')}</p>` : ''}</div>
    <div class="card"><div class="row sp"><h2>Matters</h2>${can('admin', 'advocate', 'staff') ? '<button class="btn sm" id="nm">New matter</button>' : ''}</div>
    ${c.matters.length ? `<ul class="list">${c.matters.map((m) => `<li><a href="#/matter/${m.id}">${esc(m.title)}</a><span class="mute">${esc(m.file_no)} ${sp(m.status)}</span></li>`).join('')}</ul>` : '<p class="mute">No matters yet.</p>'}</div>
    ${can('admin', 'advocate', 'accounts') ? `<div class="card"><h2>Account</h2><p>Billed ${inr(c.billed_paise)} · Received ${inr(c.paid_paise)} · <b>Balance ${inr(c.billed_paise - c.paid_paise)}</b></p><a class="btn sm ghost" href="#/billing/reports?client=${c.id}">View ledger</a></div>` : ''}`);
  $('#edit').onclick = () => ask('Edit client', [{ name: 'name', label: 'Name', value: c.name, required: true }, { name: 'phone', label: 'Phone', value: c.phone }, { name: 'email', label: 'Email', value: c.email }, { name: 'address', label: 'Address', type: 'textarea', value: c.address }, { name: 'notes', label: 'Internal notes', type: 'textarea', value: c.notes }], 'Save', async (v) => { await PUT('/api/clients/' + id, v); go(); });
  const inv = $('#inv'); if (inv) inv.onclick = () => ask('Portal access', [{ name: 'email', label: 'Client email (login)', type: 'email', value: c.email, required: true }], 'Create link', async (v) => { const r = await POST(`/api/clients/${id}/login`, v); setTimeout(() => showInvite(r.invite_path), 50); });
  const nm = $('#nm'); if (nm) nm.onclick = () => newMatter(id);
}, { office: true });

async function newMatter(clientId) {
  const fields = [];
  if (!clientId) fields.push({ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), required: true });
  fields.push({ name: 'title', label: 'Matter title', required: true, ph: 'e.g. Ramesh Sharma v. State Bank of India' }, { name: 'forum', label: 'Court / forum' }, { name: 'case_no', label: 'Case number' },
    { name: 'opposite_party', label: 'Opposite party' }, { name: 'stage', label: 'Stage' }, { name: 'assigned_to', label: 'Handled by', type: 'select', options: await teamOpts('— unassigned —') });
  ask('New matter', fields, 'Create', async (v) => { const r = await POST('/api/matters', { ...v, client_id: clientId || v.client_id }); location.hash = '#/matter/' + r.id; });
}

/* ===== matters ===== */
route(/^\/matters$/, async () => {
  const draw = async (q) => {
    const rows = await GET('/api/matters?' + qs({ q }));
    $('#res').innerHTML = rows.length ? `<div class="tw"><table><tr><th>File</th><th>Matter</th>${isClient() ? '' : '<th>Client</th>'}<th>Forum</th><th>Next date</th><th></th></tr>${rows.map((m) => `<tr><td>${esc(m.file_no)}</td><td><a href="#/matter/${m.id}">${esc(m.title)}</a></td>${isClient() ? '' : `<td>${esc(m.client_name)}</td>`}<td>${esc(m.forum || '')}</td><td>${m.next_date ? dt(m.next_date) : '—'}</td><td>${sp(m.status)}</td></tr>`).join('')}</table></div>` : '<p class="mute">No cases found.</p>';
  };
  view(`<div class="row sp"><h1>${isClient() ? 'My cases' : 'Matters'}</h1>${can('admin', 'advocate', 'staff') ? '<button class="btn" id="add">New matter</button>' : ''}</div>${searchBar('Search title, file number or client')}<div class="card" id="res"></div>`);
  liveSearch(draw); draw('');
  const add = $('#add'); if (add) add.onclick = () => newMatter();
});

route(/^\/matter\/(\d+)$/, async ([id]) => {
  const m = await GET('/api/matters/' + id), cli = isClient(), edit = can('admin', 'advocate', 'staff');
  view(`<div class="row sp"><div><h1 style="margin-bottom:0">${esc(m.title)}</h1><div class="mute">${esc(m.file_no)} · ${esc(m.client_name)} · ${sp(m.status)}</div></div>
    <a class="btn ghost sm" href="#/matters">← ${cli ? 'My cases' : 'Matters'}</a></div>
    <div class="card"><div class="row sp"><h2>Case details</h2>${edit ? '<button class="btn sm ghost" id="em">Edit</button>' : ''}</div>
    <p><b>Forum:</b> ${esc(m.forum || '—')}<br><b>Case no.:</b> ${esc(m.case_no || '—')}<br><b>Stage:</b> ${esc(m.stage || '—')}${cli ? '' : `<br><b>Opposite party:</b> ${esc(m.opposite_party || '—')}`}</p>
    ${cli ? (m.client_visible_note ? `<p><b>Update from the office:</b><br>${esc(m.client_visible_note)}</p>` : '') : (m.summary ? `<p><b>Internal summary:</b><br>${esc(m.summary)}</p>` : '')}</div>
    <div class="card"><div class="row sp"><h2>Hearings & dates</h2>${edit ? '<button class="btn sm" id="ah">Add hearing</button>' : ''}</div>
    ${m.hearings.length ? `<div class="tw"><table><tr><th>Date</th><th>Purpose</th><th>Outcome</th><th>Next date</th></tr>${m.hearings.map((h) => `<tr><td>${dt(h.hearing_date)}</td><td>${esc(h.purpose || '')}</td><td>${esc(h.outcome || '')}</td><td><b>${h.next_date ? dt(h.next_date) : '—'}</b></td></tr>`).join('')}</table></div>` : '<p class="mute">No hearings recorded.</p>'}</div>
    <div class="card"><div class="row sp"><h2>Documents</h2><button class="btn sm" id="ud">${cli ? 'Upload a document' : 'Upload'}</button></div>
    ${cli ? '<p class="mute">You can add documents here. For safety, they cannot be changed or removed once uploaded.</p>' : ''}
    ${m.documents.length ? `<ul class="list">${m.documents.map((d) => `<li><span><a href="/api/documents/${d.id}/download">${esc(d.name)}</a><div class="mute">${esc(d.category || '')} · ${dt(d.created_at)} · ${Math.ceil((d.size || 0) / 1024)} KB</div></span>${edit ? `<label class="chk" style="margin:0"><input type="checkbox" data-vis="${d.id}" ${d.client_visible ? 'checked' : ''}> client sees</label>` : ''}</li>`).join('')}</ul>` : '<p class="mute">No documents.</p>'}</div>
    ${m.letters.length ? `<div class="card"><h2>Letters</h2><ul class="list">${m.letters.map((l) => `<li><a href="#/letter/${l.id}">${esc(l.subject)}</a><span class="mute">${esc(l.ref_no || 'draft')}</span></li>`).join('')}</ul></div>` : ''}
    ${m.invoices.length ? `<div class="card"><h2>Fees</h2><ul class="list">${m.invoices.map((i) => `<li><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a><span>${inr(i.total_paise)} ${sp(i.status)}</span></li>`).join('')}</ul></div>` : ''}
    ${cli ? '' : `<div class="card"><div class="row sp"><h2>Tasks</h2><button class="btn sm" id="at">Assign task</button></div>${m.tasks.length ? `<ul class="list">${m.tasks.map((t) => `<li><span>${esc(t.title)}<div class="mute">${esc(t.assignee || '')} · due ${dt(t.due_date)}</div></span>${sp(t.status)}</li>`).join('')}</ul>` : '<p class="mute">No tasks.</p>'}</div>
    <div class="card"><div class="row sp"><h2>File notings</h2><button class="btn sm" id="an">Add noting</button></div>${m.notings.length ? `<ul class="list">${m.notings.map((n) => `<li><span>${esc(n.note)}<div class="mute">${esc(n.user_name || '')} · ${dtm(n.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">No notings.</p>'}</div>`}`);
  const upd = () => go();
  const em = $('#em'); if (em) em.onclick = () => ask('Edit matter', [{ name: 'title', label: 'Title', value: m.title, required: true }, { name: 'forum', label: 'Forum', value: m.forum }, { name: 'case_no', label: 'Case number', value: m.case_no }, { name: 'opposite_party', label: 'Opposite party', value: m.opposite_party }, { name: 'stage', label: 'Stage', value: m.stage }, { name: 'status', label: 'Status', type: 'select', value: m.status, options: ['open', 'on_hold', 'closed'] }, { name: 'summary', label: 'Internal summary', type: 'textarea', value: m.summary }, { name: 'client_visible_note', label: 'Update the client can see', type: 'textarea', value: m.client_visible_note }], 'Save', async (v) => { await PUT('/api/matters/' + id, v); upd(); });
  const ah = $('#ah'); if (ah) ah.onclick = () => ask('Record hearing', [{ name: 'hearing_date', label: 'Hearing date', type: 'date', value: today(), required: true }, { name: 'purpose', label: 'Purpose' }, { name: 'outcome', label: 'Outcome / order' }, { name: 'next_date', label: 'Next date', type: 'date' }], 'Save', async (v) => { await POST(`/api/matters/${id}/hearings`, v); upd(); });
  $('#ud').onclick = () => ask('Upload document', [{ name: 'file', label: 'File', type: 'file', required: true, hint: 'PDF, Word, Excel, JPG/PNG, ZIP — up to 25 MB.' }, ...(cli ? [] : [{ name: 'category', label: 'Category', ph: 'Pleading, Order, Notice…' }, { name: 'client_visible', label: 'Client can see this', type: 'checkbox' }])], 'Upload', async (v) => {
    const fd = new FormData(); fd.append('matter_id', id); fd.append('file', v.file); if (!cli) { fd.append('category', v.category || ''); fd.append('client_visible', v.client_visible ? '1' : '0'); } await POST('/api/documents', fd); toast('Uploaded.'); upd(); });
  $$('[data-vis]').forEach((cb) => (cb.onchange = async () => { try { await PATCH('/api/documents/' + cb.dataset.vis, { client_visible: cb.checked }); toast('Saved.'); } catch (e) { toast(e.message, true); } }));
  const at = $('#at'); if (at) at.onclick = async () => newTask(id);
  const an = $('#an'); if (an) an.onclick = () => ask('File noting', [{ name: 'note', label: 'Noting', type: 'textarea', required: true }], 'Add', async (v) => { await POST(`/api/matters/${id}/notings`, v); upd(); });
});

/* ===== tasks ===== */
async function newTask(matterId) {
  ask('Assign task', [{ name: 'title', label: 'Task', required: true }, { name: 'details', label: 'Details', type: 'textarea' }, { name: 'assigned_to', label: 'Assign to', type: 'select', options: await teamOpts(), value: ME.id },
    { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'priority', label: 'Priority', type: 'select', options: [['normal', 'Normal'], ['high', 'High']] }], 'Assign',
    async (v) => { await POST('/api/tasks', { ...v, matter_id: matterId || null }); go(); });
}
route(/^\/tasks$/, async (_, p) => {
  const vw = p.get('view') || 'mine';
  const rows = await GET('/api/tasks?view=' + vw);
  view(`<div class="row sp"><h1>Tasks</h1><button class="btn" id="add">Assign task</button></div>
    <div class="tabs">${[['mine', 'Mine'], ['assigned', 'Assigned by me'], ['overdue', 'Overdue'], ['all', 'All']].map(([k, l]) => `<a href="#/tasks?view=${k}" class="${vw === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="card">${rows.length ? `<ul class="list">${rows.map((t) => `<li><span><b>${esc(t.title)}</b> ${t.priority === 'high' ? pill('high', 'bad') : ''}<div class="mute">${esc(t.assignee || '')}${t.file_no ? ' · ' + esc(t.file_no) : ''} · due ${dt(t.due_date)}${t.assigner ? ' · by ' + esc(t.assigner) : ''}</div>${t.details ? `<div>${esc(t.details)}</div>` : ''}</span>
      <select data-t="${t.id}" style="width:auto">${['todo', 'doing', 'review', 'done'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></li>`).join('')}</ul>` : '<p class="mute">Nothing here.</p>'}</div>`);
  $('#add').onclick = () => newTask();
  $$('[data-t]').forEach((s) => (s.onchange = async () => { try { await PATCH('/api/tasks/' + s.dataset.t, { status: s.value }); toast('Updated.'); } catch (e) { toast(e.message, true); go(); } }));
}, { office: true });

/* ===== letters (eOffice outward) ===== */
route(/^\/letters$/, async () => {
  const rows = await GET('/api/letters');
  view(`<div class="row sp"><h1>Letters</h1>${can('admin', 'advocate', 'staff') ? '<button class="btn" id="add">Draft letter</button>' : ''}</div>
    <div class="card">${rows.length ? `<ul class="list">${rows.map((l) => `<li><span><a href="#/letter/${l.id}">${esc(l.subject)}</a><div class="mute">${isClient() ? dt(l.sent_at) : 'To ' + esc(l.to_name) + (l.file_no ? ' · ' + esc(l.file_no) : '')}</div></span><span>${isClient() ? (l.read_at ? '' : pill('new', 'warn')) : `${esc(l.ref_no || '')} ${sp(l.status)} ${l.read_at ? pill('read', 'ok') : ''}`}</span></li>`).join('')}</ul>` : '<p class="mute">No letters.</p>'}</div>`);
  const add = $('#add'); if (add) add.onclick = async () => ask('Draft letter', [{ name: 'to_name', label: 'To', required: true }, { name: 'subject', label: 'Subject', required: true }, { name: 'matter_id', label: 'Matter', type: 'select', options: await matterOpts() }, { name: 'body', label: 'Letter', type: 'textarea', required: true }, { name: 'client_visible', label: 'Make visible to the client when sent', type: 'checkbox' }], 'Save draft', async (v) => { const r = await POST('/api/letters', v); location.hash = '#/letter/' + r.id; }, true);
});
route(/^\/letter\/(\d+)$/, async ([id]) => {
  const [l, T] = await Promise.all([GET('/api/letters/' + id), getTpl()]);
  view(`<div class="row sp noprint"><a class="btn ghost sm" href="#/letters">← Letters</a><div class="row">
    ${!isClient() && l.status === 'draft' ? `<button class="btn ghost sm" id="ed">Edit</button>${can('admin', 'advocate') ? '<button class="btn gold sm" id="send">Approve & number</button>' : '<span class="mute">Waiting for advocate approval</span>'}<button class="btn red sm" id="del">Delete</button>` : ''}
    <button class="btn sm" data-print>Print</button></div></div>
    ${sheetFor(T, `<div class="lref"><span>Ref. No. ${esc(l.ref_no || 'DRAFT')}</span><span>Date: ${dt(l.sent_at || l.created_at)}</span></div><p>To,<br><b>${esc(l.to_name)}</b></p><p><b>Subject: ${esc(l.subject)}</b></p><div class="lbody">${esc(l.body)}</div>${signBlock(T.settings)}`)}`);
  const s = $('#send'); if (s) s.onclick = async () => { if (!sure('Approve this letter and issue its reference number? It cannot be edited afterwards.')) return; const r = await POST(`/api/letters/${id}/send`); toast('Issued ' + r.ref_no); go(); };
  const d = $('#del'); if (d) d.onclick = async () => { if (sure('Delete this draft?')) { await DEL('/api/letters/' + id); location.hash = '#/letters'; } };
  const e = $('#ed'); if (e) e.onclick = () => ask('Edit draft', [{ name: 'to_name', label: 'To', value: l.to_name, required: true }, { name: 'subject', label: 'Subject', value: l.subject, required: true }, { name: 'body', label: 'Letter', type: 'textarea', value: l.body, required: true }, { name: 'client_visible', label: 'Visible to client when sent', type: 'checkbox', value: l.client_visible }], 'Save', async (v) => { await PUT('/api/letters/' + id, v); go(); }, true);
});

/* ===== inward register ===== */
route(/^\/dak$/, async () => {
  const rows = await GET('/api/dak');
  view(`<div class="row sp"><h1>Inward register</h1><button class="btn" id="add">Log inward</button></div>
    <div class="card">${rows.length ? `<div class="tw"><table><tr><th>No.</th><th>Date</th><th>From</th><th>Subject</th><th>Action by</th><th></th></tr>${rows.map((d) => `<tr><td>${esc(d.ref_no)}</td><td>${dt(d.received_on)}</td><td>${esc(d.from_name)}</td><td>${esc(d.subject)}${d.file_no ? `<div class="mute">${esc(d.file_no)}</div>` : ''}</td><td>${esc(d.assignee || '—')}</td><td>${d.status === 'open' ? `<button class="btn sm ghost" data-done="${d.id}">Mark actioned</button>` : pill('actioned', 'ok')}</td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing logged.</p>'}</div>`);
  $('#add').onclick = async () => ask('Log inward correspondence', [{ name: 'from_name', label: 'Received from', required: true }, { name: 'subject', label: 'Subject', required: true }, { name: 'received_on', label: 'Date received', type: 'date', value: today() }, { name: 'matter_id', label: 'Matter', type: 'select', options: await matterOpts() }, { name: 'assigned_to', label: 'For action by', type: 'select', options: await teamOpts('— nobody —') }], 'Log', async (v) => { const r = await POST('/api/dak', v); toast('Entered as ' + r.ref_no); go(); });
  $$('[data-done]').forEach((b) => (b.onclick = async () => { await PATCH('/api/dak/' + b.dataset.done, { status: 'actioned' }); go(); }));
}, { roles: ['admin', 'advocate', 'staff'] });

/* ===== messages ===== */
route(/^\/messages$/, async (_, p) => {
  const cid = p.get('client');
  const thread = async (clientId) => {
    const rows = await GET('/api/messages' + (clientId ? '?client_id=' + clientId : ''));
    return `<div class="card">${rows.length ? rows.map((m) => `<div class="msg ${m.from_user === ME.id ? 'me' : ''}"><small>${esc(m.from_name)} · ${dtm(m.created_at)}</small>${esc(m.body)}</div>`).join('') : '<p class="mute">No messages yet.</p>'}
      <form id="mf" class="row" style="margin-top:1rem;flex-wrap:nowrap"><input name="b" placeholder="Write a message…" required><button class="btn">Send</button></form></div>`;
  };
  const wire = (clientId) => { $('#mf').onsubmit = async (e) => { e.preventDefault(); try { await POST('/api/messages', { body: e.target.b.value, client_id: clientId }); go(); } catch (x) { toast(x.message, true); } }; };
  if (isClient()) { view(`<h1>Messages</h1><p class="mute">Write to the office about your case. For anything urgent, please also call.</p>${await thread()}`); wire(); return; }
  if (cid) { view(`<div class="row sp"><h1>Conversation</h1><a class="btn ghost sm" href="#/messages">← All</a></div>${await thread(cid)}`); wire(cid); return; }
  const rows = await GET('/api/messages');
  view(`<h1>Client messages</h1><div class="card">${rows.length ? `<ul class="list">${rows.map((r) => `<li><a href="#/messages?client=${r.client_id}">${esc(r.name)}</a>${r.unread ? pill(r.unread + ' new', 'warn') : ''}</li>`).join('')}</ul>` : '<p class="mute">No messages yet.</p>'}</div>`);
});

/* ===== leads (CRM) ===== */
const STAGES = ['new', 'contacted', 'callback', 'booked', 'won', 'lost'];
route(/^\/leads$/, async (_, p) => {
  const st = p.get('stage') || '';
  const rows = await GET('/api/leads' + (st ? '?stage=' + st : ''));
  view(`<div class="row sp"><h1>Leads</h1><button class="btn" id="add">Add lead</button></div>
    <div class="tabs"><a href="#/leads" class="${st ? '' : 'on'}">All</a>${STAGES.map((s) => `<a href="#/leads?stage=${s}" class="${st === s ? 'on' : ''}">${s}</a>`).join('')}</div>
    <div class="card">${rows.length ? `<ul class="list">${rows.map((l) => `<li><span><a href="#/lead/${l.id}">${esc(l.name)}</a> <span class="mute">${esc(l.phone || l.email || '')}</span><div class="mute">${esc((l.issue || '').slice(0, 90))} · ${esc(l.source || '')}</div>${l.callback_at ? `<div class="mute">Call back: ${dtm(l.callback_at)}</div>` : ''}</span>${sp(l.stage)}</li>`).join('')}</ul>` : '<p class="mute">No leads in this view.</p>'}</div>`);
  $('#add').onclick = () => ask('New lead', [{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'source', label: 'Source', ph: 'Call, WhatsApp, referral…' }, { name: 'issue', label: 'Legal issue', type: 'textarea' }], 'Save', async (v) => { const r = await POST('/api/leads', v); location.hash = '#/lead/' + r.id; });
}, { roles: ['admin', 'advocate', 'staff', 'telecaller'] });
route(/^\/lead\/(\d+)$/, async ([id]) => {
  const l = await GET('/api/leads/' + id);
  view(`<div class="row sp"><h1>${esc(l.name)}</h1><a class="btn ghost sm" href="#/leads">← Leads</a></div>
    <div class="card"><p>${l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : ''} ${esc(l.email || '')}<br>${esc(l.issue || '')}</p><p>${sp(l.stage)} <span class="mute">${esc(l.source || '')}</span></p>
    <div class="row"><select id="stg" style="width:auto">${STAGES.map((s) => `<option ${s === l.stage ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn sm" id="log">Log call</button>
    ${can('admin', 'advocate', 'staff') ? (l.client_id ? `<a class="btn sm gold" href="#/client/${l.client_id}">Open client</a>` : '<button class="btn sm gold" id="cv">Convert to client</button>') : ''}</div></div>
    <div class="card"><h2>Call log</h2>${l.notes.length ? `<ul class="list">${l.notes.map((n) => `<li><span>${n.outcome ? pill(n.outcome.replace(/_/g, ' ')) : ''} ${esc(n.note || '')}<div class="mute">${esc(n.user_name || '')} · ${dtm(n.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">No calls logged.</p>'}</div>`);
  $('#stg').onchange = async (e) => { const body = { stage: e.target.value }; if (body.stage === 'lost') { body.lost_reason = prompt('Reason for losing this lead?') || ''; } await PATCH('/api/leads/' + id, body); toast('Updated.'); go(); };
  $('#log').onclick = () => ask('Log call', [{ name: 'outcome', label: 'Outcome', type: 'select', options: [['answered', 'Spoke to them'], ['no_answer', 'No answer'], ['busy', 'Busy / call later'], ['wrong_number', 'Wrong number'], ['not_interested', 'Not interested']] }, { name: 'note', label: 'Notes', type: 'textarea' }, { name: 'callback_at', label: 'Call back at', type: 'datetime-local' }], 'Save', async (v) => { await POST(`/api/leads/${id}/notes`, v); go(); });
  const cv = $('#cv'); if (cv) cv.onclick = async () => { const r = await POST(`/api/leads/${id}/convert`); location.hash = '#/client/' + r.client_id; };
}, { roles: ['admin', 'advocate', 'staff', 'telecaller'] });

/* ===== appointments (office) ===== */
route(/^\/appointments$/, async () => {
  const rows = await GET('/api/appointments');
  view(`<h1>Online consultations</h1><div class="card">${rows.length ? `<div class="tw"><table><tr><th>When</th><th>Who</th><th>Type</th><th>Fee</th><th>Status</th><th></th></tr>${rows.map((a) => `<tr><td>${dtm(a.start_at)}</td><td>${esc(a.name)}<div class="mute">${esc(a.phone || '')}</div><div class="mute">${esc((a.issue || '').slice(0, 80))}</div></td><td>${esc(a.type_name)}<div class="mute">${esc(a.advocate)}</div></td><td>${inr(a.fee_paise)}</td><td>${sp(a.status)}</td>
      <td>${a.status === 'confirmed' ? `<a class="btn sm" href="${esc(a.meet_link)}" target="_blank" rel="noopener">Join</a>` : ''}${a.status === 'awaiting_payment' && can('admin', 'advocate', 'staff', 'accounts') ? `<button class="btn sm gold" data-cf="${a.id}">Confirm payment</button> <span class="mute">${esc(a.pay_ref)}</span>` : ''}${['confirmed', 'awaiting_payment'].includes(a.status) ? ` <button class="btn sm ghost" data-cx="${a.id}">Cancel</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="mute">No consultations booked.</p>'}</div>
    <p class="mute">A booking is confirmed — and the video link released — only after payment is recorded.</p>`);
  $$('[data-cf]').forEach((b) => (b.onclick = () => ask('Confirm payment received', [{ name: 'reference', label: 'UPI / bank reference', required: true }, { name: 'mode', label: 'Mode', type: 'select', options: ['upi', 'bank', 'cash', 'card'] }], 'Confirm', async (v) => { await POST(`/api/appointments/${b.dataset.cf}/confirm`, v); go(); })));
  $$('[data-cx]').forEach((b) => (b.onclick = async () => { if (sure('Cancel this consultation? Any refund must be handled separately.')) { await POST(`/api/appointments/${b.dataset.cx}/cancel`); go(); } }));
}, { office: true });

/* ===== judgments ===== */
route(/^\/judgments$/, async () => {
  const src = await GET('/api/judgments/sources');
  const draw = async (q) => {
    const rows = await GET('/api/judgments?' + qs({ q }));
    $('#res').innerHTML = rows.length ? `<ul class="list">${rows.map((j) => `<li><span><a href="#" data-j="${j.id}">${esc(j.title)}</a><div class="mute">${esc(j.court)} · ${esc(j.case_no || '')} ${j.decided_on ? '· ' + dt(j.decided_on) : ''} ${j.citation ? '· ' + esc(j.citation) : ''}</div>${j.snippet ? `<div>${esc(j.snippet)}</div>` : ''}</span>${j.subject ? pill(j.subject) : ''}</li>`).join('')}</ul>` : '<p class="mute">Nothing matched. Add judgments below or search the court sites.</p>';
  };
  view(`<div class="row sp"><h1>Judgments</h1><button class="btn" id="add">Add judgment</button></div>${searchBar('Search words, case number, judge, subject…')}
    <div class="card" id="res"></div><div class="card"><h2>Search the courts directly</h2><ul class="list">${src.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><span class="mute">opens the official site</span></li>`).join('')}</ul></div>`);
  liveSearch(draw); draw('');
  $('#res').onclick = async (e) => { const a = e.target.closest('[data-j]'); if (!a) return; e.preventDefault(); const j = await GET('/api/judgments/' + a.dataset.j);
    const m = show(j.title, `<p class="mute">${esc(j.court)} · ${esc(j.case_no || '')} ${j.decided_on ? '· ' + dt(j.decided_on) : ''}<br>Judge: ${esc(j.judge || '—')} · ${esc(j.citation || '')}</p><div class="paper"><pre>${esc(j.summary || 'No summary entered.')}</pre></div>${j.source_url ? `<p><a href="${esc(j.source_url)}" target="_blank" rel="noopener">Open original source</a></p>` : ''}${can('admin') ? '<button class="btn red sm" id="jd">Delete</button>' : ''}`, true);
    const jd = $('#jd', m.el); if (jd) jd.onclick = async () => { if (sure('Delete this judgment?')) { await DEL('/api/judgments/' + j.id); m.close(); draw($('#q').value); } }; };
  $('#add').onclick = () => ask('Add judgment', [{ name: 'court', label: 'Court', required: true, ph: 'Supreme Court of India' }, { name: 'title', label: 'Case title', required: true, ph: 'A v. B' }, { name: 'case_no', label: 'Case number' }, { name: 'judge', label: 'Judge(s)' }, { name: 'decided_on', label: 'Date of judgment', type: 'date' }, { name: 'citation', label: 'Citation' }, { name: 'subject', label: 'Subject' }, { name: 'summary', label: 'Headnote / key holdings / notes', type: 'textarea' }, { name: 'source_url', label: 'Link to the official judgment', type: 'url' }], 'Save', async (v) => { await POST('/api/judgments', v); toast('Saved.'); draw($('#q').value); }, true);
}, { roles: ['admin', 'advocate', 'staff'] });

/* ===== team & settings (admin) ===== */
route(/^\/team$/, async () => {
  const [users, audit] = await Promise.all([GET('/api/users'), GET('/api/audit')]);
  view(`<div class="row sp"><h1>Team</h1><button class="btn" id="add">Add team member</button></div>
    <div class="card"><ul class="list">${users.map((u) => `<li><span><b>${esc(u.name)}</b> <span class="mute">${esc(u.email)}</span><div>${pill(u.role)} ${u.active ? '' : pill('disabled', 'bad')}</div></span><span class="row"><button class="btn sm ghost" data-inv="${u.id}">Invite link</button>${u.id !== ME.id ? `<button class="btn sm ghost" data-tg="${u.id}" data-a="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</span></li>`).join('')}</ul></div>
    <div class="card"><h2>Recent activity</h2><div class="tw"><table><tr><th>When</th><th>Action</th><th>Detail</th></tr>${audit.slice(0, 60).map((a) => `<tr><td>${dtm(a.created_at)}</td><td>${esc(a.action.replace(/_/g, ' '))}</td><td>${esc(a.detail || '')}</td></tr>`).join('')}</table></div></div>`);
  const link = (p) => show('Invitation link', `<p>Send this private link to the person. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + p)}">`);
  $('#add').onclick = () => ask('Add team member', [{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'role', label: 'Role', type: 'select', options: [['advocate', 'Advocate'], ['staff', 'Office staff'], ['telecaller', 'Telecaller'], ['accounts', 'Accounts']] }], 'Create', async (v) => { const r = await POST('/api/users', v); TEAM = null; setTimeout(() => link(r.invite_path), 50); go(); });
  $$('[data-inv]').forEach((b) => (b.onclick = async () => link((await POST(`/api/users/${b.dataset.inv}/invite`)).invite_path)));
  $$('[data-tg]').forEach((b) => (b.onclick = async () => { await PATCH('/api/users/' + b.dataset.tg, { active: b.dataset.a === '1' ? 1 : 0 }); TEAM = null; go(); }));
}, { roles: ['admin'] });

route(/^\/settings$/, async () => {
  const [types, av, fees] = await Promise.all([GET('/api/consult-types'), GET('/api/availability'), GET('/api/consult-fees')]);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const advs = (await team()).filter((u) => ['admin', 'advocate'].includes(u.role));
  view(`<h1>Settings</h1>
    <div class="card"><div class="row sp"><h2>Consultation types & default fees</h2><button class="btn sm" id="ct">Add type</button></div><ul class="list">${types.map((t) => `<li><span>${esc(t.name)} <span class="mute">${t.minutes} min</span></span><span class="row">${inr(t.fee_paise)} ${t.active ? '' : pill('off', 'bad')}<button class="btn sm ghost" data-et="${t.id}">Edit</button></span></li>`).join('')}</ul></div>
    <div class="card"><h2>Fee for each advocate</h2><p class="mute">Each advocate can charge a different fee. Leave a box blank to use the default fee shown above. Saved when you leave the box.</p>
    <div class="tw"><table><tr><th>Advocate</th>${types.map((t) => `<th class="n">${esc(t.name)}<br><span class="mute">default ${inr(t.fee_paise)}</span></th>`).join('')}</tr>
    ${advs.map((a) => `<tr><td>${esc(a.name)}</td>${types.map((t) => { const f = fees.find((x) => x.user_id === a.id && x.consult_type_id === t.id); return `<td class="n"><input type="number" min="0" step="1" style="width:110px" data-fee data-u="${a.id}" data-t="${t.id}" value="${f ? f.fee_paise / 100 : ''}" placeholder="${t.fee_paise / 100}"></td>`; }).join('')}</tr>`).join('')}</table></div></div>
    <div class="card"><h2>Import from Zoho Books</h2><p class="mute">One-time import of your old clients, invoices and receipts from the file KC-LEGAL-zoho-import.json. Safe to repeat: records already imported are skipped. Original Zoho numbers (INV-0000xx) are kept.</p>
    <p><input type="file" id="zf" accept=".json,application/json"> <button class="btn" id="zi">Import</button></p></div>
    <div class="card"><h2>Weekly availability for online consultations</h2><p class="mute">Times are India time. One line per slot: <code>Mon 10:00-13:00</code>. Leave blank for no availability.</p>
    ${advs.map((a) => { const mine = av.filter((x) => x.user_id === a.id).map((x) => `${days[x.weekday]} ${x.start_time}-${x.end_time}`).join('\n'); return `<label>${esc(a.name)}</label><textarea data-av="${a.id}">${esc(mine)}</textarea>`; }).join('')}
    <p><button class="btn" id="sv">Save availability</button></p></div>`);
  $$('[data-fee]').forEach((i) => (i.onchange = async () => { try { await PUT('/api/consult-fees', { user_id: +i.dataset.u, consult_type_id: +i.dataset.t, fee: i.value }); toast('Fee saved.'); } catch (e) { toast(e.message, true); } }));
  $('#zi').onclick = async () => { const f = $('#zf').files[0]; if (!f) return toast('Choose the import file first.', true); try { const r = await POST('/api/admin/import-zoho', JSON.parse(await f.text())); toast(`Imported ${r.clients} clients, ${r.invoices} invoices, ${r.payments} receipts (${r.skipped} skipped).`); } catch (e) { toast(e.message, true); } };
  $('#ct').onclick = () => ask('New consultation type', [{ name: 'name', label: 'Name', required: true }, { name: 'minutes', label: 'Minutes', type: 'number', value: 30, required: true }, { name: 'fee', label: 'Fee (₹)', type: 'number', value: 1000, required: true }], 'Add', async (v) => { await POST('/api/consult-types', v); go(); });
  $$('[data-et]').forEach((b) => (b.onclick = () => { const t = types.find((x) => x.id == b.dataset.et); ask('Edit type', [{ name: 'name', label: 'Name', value: t.name }, { name: 'minutes', label: 'Minutes', type: 'number', value: t.minutes }, { name: 'fee', label: 'Fee (₹)', type: 'number', value: t.fee_paise / 100 }, { name: 'active', label: 'Offer this type', type: 'checkbox', value: t.active }], 'Save', async (v) => { await PATCH('/api/consult-types/' + t.id, v); go(); }); }));
  $('#sv').onclick = async () => {
    try {
      for (const ta of $$('[data-av]')) {
        const slots = ta.value.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const m = s.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+(\d{1,2}:\d\d)\s*-\s*(\d{1,2}:\d\d)$/i); if (!m) throw new Error('Cannot read: "' + s + '"'); const pd = (x) => x.padStart(5, '0'); return { weekday: days.findIndex((d) => d.toLowerCase() === m[1].slice(0, 3).toLowerCase()), start_time: pd(m[2]), end_time: pd(m[3]) }; });
        await PUT('/api/availability', { user_id: +ta.dataset.av, slots });
      }
      toast('Availability saved.');
    } catch (e) { toast(e.message, true); }
  };
}, { roles: ['admin'] });

/* ===== Document design (letter pad template) — firm admin ===== */
route(/^\/template$/, async () => {
  if (ME.role !== 'admin') { view('<p class="mute">Only the firm administrator can change the document design.</p>'); return; }
  let T = await getTpl(true);
  const F = (k, label, o = {}) => `<label>${label}</label>${o.area ? `<textarea name="${k}" rows="3">` : `<input name="${k}" type="${o.type || 'text'}" ${o.type === 'number' ? 'min="0" max="120"' : ''} value="`}${o.area ? esc(T.settings[k] || '') + '</textarea>' : esc(T.settings[k] ?? '') + '">'}`;
  const sample = () => {
    const S = T.settings;
    return sheetFor(T, `<div class="dochead"><h1>${esc(S.invoice_title)}</h1><div class="meta"><div><span>Invoice no.</span><b>INV/0001/2026</b></div><div><span>Date</span><b>${dt(new Date().toISOString().slice(0, 10))}</b></div></div></div>
      <div class="billto"><span>BILL TO</span><b>Sample Client</b><div>Kolkata</div></div>
      <table class="itab"><tr><th>#</th><th>Description</th><th class="n">Amount</th></tr><tr><td>1</td><td>Professional fees</td><td class="n">${inr(1500000)}</td></tr></table>
      <table class="ttab"><tr class="due"><td>Amount due</td><td class="n">${inr(1500000)}</td></tr></table>
      <p class="words"><span>In words:</span> ${inWords(1500000)}</p>
      ${S.payment_details ? `<div class="paybox"><b>Payment details</b><div>${esc(S.payment_details).replace(/\n/g, '<br>')}</div></div>` : ''}
      ${S.invoice_footer ? `<p class="inote">${esc(S.invoice_footer)}</p>` : ''}${signBlock(S)}`);
  };
  view(`<h1>Document design</h1><p class="mute">This letter pad is used for every invoice, receipt and letter your firm prints.</p>
    <div class="tplgrid"><div class="card"><form id="tf">
      <h3>Letterhead image</h3><p class="mute">Upload a full-page A4 JPG or PNG (max 4 MB) with your logo, header and footer. Or leave it empty and a text header is printed.</p>
      <div class="row"><input type="file" id="lhf" accept="image/jpeg,image/png"><button type="button" class="btn sm ghost" id="lhd" ${T.has_letterhead ? '' : 'hidden'}>Remove image</button></div>
      <h3>Header (used when there is no image)</h3>${F('header_name', 'Firm name')}${F('tagline', 'Tagline')}${F('address', 'Address', { area: 1 })}${F('phone', 'Phone')}${F('email', 'Email')}${F('website', 'Website')}
      <h3>Colours &amp; font</h3><div class="row"><div><label>Main</label><input name="primary" type="color" value="${T.settings.primary}"></div><div><label>Accent</label><input name="accent" type="color" value="${T.settings.accent}"></div><div><label>Title</label><input name="title_color" type="color" value="${T.settings.title_color}"></div></div>
      <label>Font</label><select name="font"><option value="sans" ${T.settings.font === 'sans' ? 'selected' : ''}>Modern (sans-serif)</option><option value="serif" ${T.settings.font === 'serif' ? 'selected' : ''}>Classic (serif)</option></select>
      <h3>Margins (mm)</h3><div class="row"><div>${F('top_mm', 'Top', { type: 'number' })}</div><div>${F('bottom_mm', 'Bottom', { type: 'number' })}</div><div>${F('side_mm', 'Sides', { type: 'number' })}</div></div>
      <h3>Wording</h3>${F('invoice_title', 'Invoice title')}${F('receipt_title', 'Receipt title')}${F('signatory_name', 'Signatory name')}${F('signatory_title', 'Signatory designation')}${F('payment_details', 'Payment details (bank / UPI)', { area: 1 })}${F('invoice_footer', 'Invoice footer note', { area: 1 })}
      <p class="err" hidden></p><div style="margin-top:1rem"><button class="btn gold" style="width:100%">Save design</button></div></form></div>
      <div class="tplprev" id="pv"></div></div>`);
  const form = $('#tf'), pv = $('#pv');
  const read = () => { const o = {}; new FormData(form).forEach((v, k) => { if (k !== 'file') o[k] = ['top_mm', 'bottom_mm', 'side_mm'].includes(k) ? Number(v) : v; }); return o; };
  const paint = () => { T = { ...T, settings: { ...T.settings, ...read() } }; pv.innerHTML = sample(); const sh = $('.sheet', pv); const z = Math.min(1, (pv.clientWidth - 16) / sh.offsetWidth); sh.style.zoom = z > 0 ? z : 1; };
  form.addEventListener('input', paint); paint();
  form.onsubmit = async (e) => {
    e.preventDefault(); const err = $('.err', form); err.hidden = true;
    try { await PUT('/api/template', read()); T = await getTpl(true); paint(); toast('Design saved'); } catch (ex) { err.hidden = false; err.textContent = ex.message; }
  };
  $('#lhf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { await POST('/api/template/letterhead', fd); T = await getTpl(true); toast('Letterhead uploaded'); go(); } catch (ex) { toast(ex.message, true); } };
  $('#lhd').onclick = async () => { if (!sure('Remove the letterhead image?')) return; await DEL('/api/template/letterhead'); await getTpl(true); go(); };
});

/* ===== Super Admin: firms ===== */
route(/^\/firms$/, async () => {
  const firms = await GET('/api/platform/firms');
  view(`<div class="row sp"><h1>Firms</h1><button class="btn" id="nf">Add firm</button></div>
    <p class="mute">Each firm has its own administrator, team, clients and document design. You create the firm and its administrator; the administrator does the rest.</p>
    ${firms.map((f) => `<div class="card"><div class="row sp"><h2>${esc(f.name)} ${f.active ? '' : pill('disabled', 'bad')}</h2><button class="btn sm ghost" data-tg="${f.id}" data-a="${f.active ? 0 : 1}">${f.active ? 'Disable firm' : 'Enable firm'}</button></div>
      <p class="mute">Booking link: <code>${esc(location.origin)}/#/book?firm=${esc(f.slug)}</code> · ${f.team} team · ${f.clients} clients</p>
      <ul class="list">${f.admins.map((a) => `<li><span><b>${esc(a.name)}</b> <span class="mute">${esc(a.email)}</span> ${a.joined ? '' : pill('invited')}</span><span class="row"><button class="btn sm ghost" data-inv="${a.id}">Invite link</button></span></li>`).join('')}</ul></div>`).join('')}`);
  const link = (p) => show('Invitation link', `<p>Send this private link to the administrator. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + p)}">`);
  $('#nf').onclick = () => ask('Add firm', [{ name: 'name', label: 'Firm name', required: true }, { name: 'prefix', label: 'Number prefix (e.g. KC)', required: true }, { name: 'slug', label: 'Short web name (optional)' }, { name: 'admin_name', label: 'Administrator name', required: true }, { name: 'admin_email', label: 'Administrator email', type: 'email', required: true }], 'Create', async (v) => { const r = await POST('/api/platform/firms', v); setTimeout(() => link(r.invite_path), 50); go(); });
  $$('[data-inv]').forEach((b) => (b.onclick = async () => link((await POST(`/api/platform/admins/${b.dataset.inv}/invite`)).invite_path)));
  $$('[data-tg]').forEach((b) => (b.onclick = async () => { if (b.dataset.a === '0' && !sure('Disable this firm? Nobody in it can sign in until you enable it again.')) return; await PATCH('/api/platform/firms/' + b.dataset.tg, { active: b.dataset.a === '1' }); go(); }));
});
route(/^\/account$/, async () => {
  view(`<h1>Account</h1><div class="card"><p><b>${esc(ME.name)}</b><br><span class="mute">${esc(ME.email)} · Super Admin</span></p><p class="mute">Change your password from the sign-in page using “Forgot password”, or ask the server owner.</p></div>`);
});
