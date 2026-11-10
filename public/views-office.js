'use strict';
let TEAM = null;
async function team() { if (!TEAM) TEAM = (await GET('/api/users')).filter((u) => u.active); return TEAM; }
const teamOpts = async (blank) => [...(blank ? [['', blank]] : []), ...(await team()).map((u) => [u.id, u.name + ' (' + u.role + ')'])];
const refList = async () => { try { return (await GET('/api/references')).map((r) => r.name); } catch (e) { return []; } };
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
    <a class="stat" href="#/matters"><b>${d.open_matters}</b><span>Open cases</span></a>
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
    $('#res').innerHTML = rows.length ? `<div class="tw"><table><tr><th>Name</th><th>Reference</th><th>Phone</th><th>Cases</th><th>Portal login</th><th>Portal access</th></tr>${rows.map((c) => `<tr><td><a href="#/client/${c.id}">${esc(c.name)}</a></td><td>${esc(c.reference || '—')}</td><td>${esc(c.phone)}</td><td>${c.matters}</td><td>${c.has_login ? pill('active', 'ok') : '—'}</td><td><label class="chk" style="margin:0;white-space:nowrap"><input type="checkbox" class="acc" data-id="${c.id}" ${c.portal_blocked ? '' : 'checked'} ${['admin', 'advocate'].includes(ME.role) ? '' : 'disabled'}> <span class="accl">${c.portal_blocked ? 'Blocked' : 'Allowed'}</span></label></td></tr>`).join('')}</table></div>` : '<p class="mute">No clients found.</p>';
    document.querySelectorAll('#res .acc').forEach((el) => { el.onchange = async () => { const on = el.checked; try { await PUT(`/api/clients/${el.dataset.id}/access`, { portal_blocked: !on }); el.parentNode.querySelector('.accl').textContent = on ? 'Allowed' : 'Blocked'; toast(on ? 'Portal access allowed.' : 'Portal access blocked.'); } catch (x) { el.checked = !on; toast(x.message, true); } }; });
  };
  view(`<div class="row sp"><h1>Clients</h1>${can('admin', 'advocate', 'staff', 'telecaller') ? '<button class="btn" id="add">Add client</button>' : ''}</div>${searchBar('Search name, phone, email or reference')}<div class="card" id="res"></div>`);
  liveSearch(draw); draw('');
  const add = $('#add'); if (add) add.onclick = () => addClient();
}, { office: true });

/* add a client; optionally create the portal login straight away */
async function addClient() {
  const canLogin = can('admin', 'advocate', 'staff'), refs = await refList();
  return ask('New client', [{ name: 'name', label: 'Full name', required: true }, { name: 'reference', label: 'Reference (through whom the client came)', list: refs, hint: 'Optional. Pick an existing name or type a new one. The client\'s Drive folder is kept under this name.' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email', hint: 'Needed if you give the client portal access.' }, { name: 'address', label: 'Address', type: 'textarea' },
    ...(canLogin ? [{ name: 'portal', label: 'Give portal access now (creates a private invitation link)', type: 'checkbox' }] : [])], 'Save', async (v) => {
    if (v.portal && !/^\S+@\S+\.\S+$/.test(v.email)) throw new Error('Enter the client\'s email to give portal access.');
    const r = await POST('/api/clients', v); let link = null;
    if (v.portal) link = (await POST(`/api/clients/${r.id}/login`, { email: v.email })).invite_path;
    location.hash = '#/client/' + r.id;
    if (link) setTimeout(() => show('Portal invitation', `<p>Send this private link to the client. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + link)}"><p class="mute">Share by WhatsApp or email. The client then sets their own password.</p>`), 300);
  });
}

async function newMatter(clientId) {
  const fields = [];
  if (!clientId) fields.push({ name: 'client_id', label: 'Client', type: 'select', options: await clientOpts(), required: true });
  fields.push({ name: 'title', label: 'Case title', required: true, ph: 'e.g. Ramesh Sharma v. State Bank of India' }, { name: 'forum', label: 'Court / forum' }, { name: 'case_no', label: 'Case number' },
    { name: 'opposite_party', label: 'Opposite party' }, { name: 'stage', label: 'Stage' }, { name: 'assigned_to', label: 'Handled by', type: 'select', options: await teamOpts('— unassigned —') });
  ask('New case', fields, 'Create', async (v) => { const r = await POST('/api/matters', { ...v, client_id: clientId || v.client_id }); location.hash = '#/matter/' + r.id; });
}

/* ===== matters ===== */
route(/^\/matters$/, async () => {
  const draw = async (q) => {
    const rows = await GET('/api/matters?' + qs({ q }));
    $('#res').innerHTML = rows.length ? `<div class="tw"><table><tr><th>File</th><th>Case</th>${isClient() ? '' : '<th>Client</th>'}<th>Forum</th><th>Next date</th><th></th></tr>${rows.map((m) => `<tr><td>${esc(m.file_no)}</td><td><a href="#/matter/${m.id}">${esc(m.title)}</a></td>${isClient() ? '' : `<td>${esc(m.client_name)}</td>`}<td>${esc(m.forum || '')}</td><td>${m.next_date ? dt(m.next_date) : '—'}</td><td>${sp(m.status)}</td></tr>`).join('')}</table></div>` : '<p class="mute">No cases found.</p>';
  };
  view(`<div class="row sp"><h1>${isClient() ? 'My cases' : 'Cases'}</h1>${can('admin', 'advocate', 'staff') ? '<button class="btn" id="add">New case</button>' : ''}</div>${searchBar('Search title, file number or client')}<div class="card" id="res"></div>`);
  liveSearch(draw); draw('');
  const add = $('#add'); if (add) add.onclick = () => newMatter();
});

route(/^\/matter\/(\d+)$/, async ([id]) => {
  const m = await GET('/api/matters/' + id), cli = isClient(), edit = can('admin', 'advocate', 'staff');
  view(`<div class="row sp"><div><h1 style="margin-bottom:0">${esc(m.title)}</h1><div class="mute">${esc(m.file_no)} · ${esc(m.client_name)} · ${sp(m.status)}</div></div>
    <a class="btn ghost sm" href="#/matters">← ${cli ? 'My cases' : 'Cases'}</a></div>
    <div class="card"><div class="row sp"><h2>Case details</h2>${edit ? '<button class="btn sm ghost" id="em">Edit</button>' : ''}</div>
    <p><b>Forum:</b> ${esc(m.forum || '—')}<br><b>Case no.:</b> ${esc(m.case_no || '—')}<br><b>Stage:</b> ${esc(m.stage || '—')}${cli ? '' : `<br><b>Opposite party:</b> ${esc(m.opposite_party || '—')}`}</p>
    ${cli ? (m.client_visible_note ? `<p><b>Update from the office:</b><br>${esc(m.client_visible_note)}</p>` : '') : (m.summary ? `<p><b>Internal summary:</b><br>${esc(m.summary)}</p>` : '')}</div>
    <div class="card"><div class="row sp"><h2>Hearings & dates</h2>${edit ? '<button class="btn sm" id="ah">Add hearing</button>' : ''}</div>
    ${m.hearings.length ? `<div class="tw"><table><tr><th>Date</th><th>Purpose</th><th>Outcome</th><th>Next date</th></tr>${m.hearings.map((h) => `<tr><td>${dt(h.hearing_date)}</td><td>${esc(h.purpose || '')}</td><td>${esc(h.outcome || '')}</td><td><b>${h.next_date ? dt(h.next_date) : '—'}</b></td></tr>`).join('')}</table></div>` : '<p class="mute">No hearings recorded.</p>'}</div>
    <div class="card"><div class="row sp"><h2>Documents</h2><button class="btn sm" id="ud">${cli ? 'Upload a document' : 'Upload'}</button></div>
    ${cli ? '<p class="mute">You can add documents here. For safety, they cannot be changed or removed once uploaded.</p>' : ''}
    ${m.documents.length ? `<ul class="list">${m.documents.map((d) => `<li><span><a href="/api/fs/${d.id}/download">${esc(d.name)}</a><div class="mute">${d.by_client ? 'Uploaded by client · ' : ''}${dt(d.created_at)} · ${Math.ceil((d.size || 0) / 1024)} KB</div></span>${edit ? `<label class="chk" style="margin:0"><input type="checkbox" data-vis="${d.id}" ${d.client_visible ? 'checked' : ''}> client sees</label>` : ''}</li>`).join('')}</ul>` : '<p class="mute">No documents.</p>'}</div>
    ${m.letters.length ? `<div class="card"><h2>Letters</h2><ul class="list">${m.letters.map((l) => `<li><a href="#/letter/${l.id}">${esc(l.subject)}</a><span class="mute">${esc(l.ref_no || 'draft')}</span></li>`).join('')}</ul></div>` : ''}
    ${m.invoices.length ? `<div class="card"><h2>Fees</h2><ul class="list">${m.invoices.map((i) => `<li><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a><span>${inr(i.total_paise)} ${sp(i.status)}</span></li>`).join('')}</ul></div>` : ''}
    ${cli ? '' : `<div class="card"><div class="row sp"><h2>Tasks</h2><button class="btn sm" id="at">Assign task</button></div>${m.tasks.length ? `<ul class="list">${m.tasks.map((t) => `<li><span>${esc(t.title)}<div class="mute">${esc(t.assignee || '')} · due ${dt(t.due_date)}</div></span>${sp(t.status)}</li>`).join('')}</ul>` : '<p class="mute">No tasks.</p>'}</div>
    <div class="card"><div class="row sp"><h2>File notings</h2><button class="btn sm" id="an">Add noting</button></div>${m.notings.length ? `<ul class="list">${m.notings.map((n) => `<li><span>${esc(n.note)}<div class="mute">${esc(n.user_name || '')} · ${dtm(n.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">No notings.</p>'}</div>`}`);
  const upd = () => go();
  const em = $('#em'); if (em) em.onclick = () => ask('Edit case', [{ name: 'title', label: 'Title', value: m.title, required: true }, { name: 'forum', label: 'Forum', value: m.forum }, { name: 'case_no', label: 'Case number', value: m.case_no }, { name: 'opposite_party', label: 'Opposite party', value: m.opposite_party }, { name: 'stage', label: 'Stage', value: m.stage }, { name: 'status', label: 'Status', type: 'select', value: m.status, options: ['open', 'on_hold', 'closed'] }, { name: 'summary', label: 'Internal summary', type: 'textarea', value: m.summary }, { name: 'client_visible_note', label: 'Update the client can see', type: 'textarea', value: m.client_visible_note }], 'Save', async (v) => { await PUT('/api/matters/' + id, v); upd(); });
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
  const add = $('#add'); if (add) add.onclick = async () => ask('Draft letter', [{ name: 'to_name', label: 'To', required: true }, { name: 'subject', label: 'Subject', required: true }, { name: 'matter_id', label: 'Case', type: 'select', options: await matterOpts() }, { name: 'body', label: 'Letter', type: 'textarea', required: true }, { name: 'client_visible', label: 'Make visible to the client when sent', type: 'checkbox' }], 'Save draft', async (v) => { const r = await POST('/api/letters', v); location.hash = '#/letter/' + r.id; }, true);
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

/* ===== In-Out Register (inward and outward letters / communications) ===== */
const MODES = ['', 'Registered Post', 'Speed Post', 'Courier', 'Email', 'Hand delivery', 'WhatsApp', 'Other'];
// one entry form for inward or outward; row = existing entry (edit), clientId = fixed client (when opened from a client page)
async function regForm(kind, row, clientId, after) {
  const inn = kind === 'in', r = row || {}, cl = await clientOpts();
  let matters = [['', '— none —']];
  try { const cid = clientId || r.client_id; matters = cid ? [['', '— none —'], ...(await GET('/api/clients/' + cid)).matters.map((m) => [m.id, m.file_no + ' · ' + m.title])] : await matterOpts(); } catch (e) {}
  const f = [
    { name: 'no', label: inn ? 'Inward No.' : 'Outward No.', value: r.no || '', ph: 'Leave blank for the next number', hint: r.id ? '' : 'Leave blank to number automatically. You may type your own number.' },
    { name: 'entry_date', label: inn ? 'Date received' : 'Date sent', type: 'date', value: r.entry_date || today(), hint: 'Any date, including a past date.' },
    { name: 'entry_time', label: 'Time', type: 'time', value: r.entry_time || '' },
    { name: 'party', label: inn ? 'Sender\'s name & organisation' : 'Receiver\'s name & organisation / address', value: r.party || '' },
    ...(inn ? [{ name: 'their_ref', label: 'Sender\'s reference / letter no. & date', value: r.their_ref || '' }] : []),
    { name: 'subject', label: inn ? 'Subject / description of contents' : 'Subject / description', type: 'textarea', value: r.subject || '' },
    ...(inn ? [{ name: 'enclosures', label: 'Enclosures / attachments', value: r.enclosures || '' }] : []),
    { name: 'dept', label: inn ? 'Recipient / department' : 'Sender\'s department / name', value: r.dept || '' },
    ...(inn ? [{ name: 'action', label: 'Action required / status', value: r.action || '', list: ['Reply', 'For information', 'File', 'Open', 'Actioned'] }]
      : [{ name: 'reply_to', label: 'Reference / reply to (Inward No.)', value: r.reply_to || '' }, { name: 'mode', label: 'Mode of dispatch', type: 'select', options: MODES.map((m) => [m, m || '— select —']), value: r.mode || '' }, { name: 'tracking', label: 'Tracking / postal receipt no.', value: r.tracking || '' }]),
    { name: 'signature', label: inn ? 'Receiver\'s signature (name)' : 'Dispatch clerk\'s signature (name)', value: r.signature || '' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', value: r.remarks || '' },
    ...(clientId ? [] : [{ name: 'client_id', label: 'Client (on whose behalf)', type: 'select', options: [['', '— none —'], ...cl], value: r.client_id || '' }]),
    { name: 'matter_id', label: 'Case', type: 'select', options: matters, value: r.matter_id || '' },
  ];
  return ask((r.id ? 'Edit ' : 'New ') + (inn ? 'inward' : 'outward') + ' entry', f, r.id ? 'Save' : 'Enter', async (v) => {
    const body = { ...v, client_id: clientId || v.client_id || null, matter_id: v.matter_id || null, kind };
    if (r.id) { if (!body.no) throw new Error('The number cannot be empty.'); await PATCH('/api/register/' + r.id, body); toast('Saved.'); }
    else { const x = await POST('/api/register', body); toast('Entered as ' + x.no); }
    if (after) after(); else go();
  }, true);
}
async function regNumbering() {
  const f = await GET('/api/register/format');
  const one = (kind, name) => ask('Numbering of ' + name + ' numbers', [
    { name: 'fmt', label: 'Pattern', value: f[kind].fmt, hint: 'Use {P} firm prefix, {YYYY} year, {YY} short year, {N:4} running number with 4 digits. Example: {P}/' + (kind === 'in' ? 'IN' : 'OUT') + '/{YYYY}/{N:4}. Now it gives ' + f[kind].example + '.' },
    { name: 'next', label: 'Next number to use', type: 'number', value: f[kind].next, hint: 'Changes only the numbers given automatically from now on. Existing entries keep their numbers.' }], 'Save', async (v) => { const r = await PUT('/api/register/format', { kind, fmt: v.fmt, next: +v.next }); toast('Next number will look like ' + r.example); go(); });
  return ask('Restructure numbering', [{ name: 'k', label: 'Which numbers?', type: 'select', options: [['in', 'Inward numbers'], ['out', 'Outward numbers']] }], 'Next', async (v) => { setTimeout(() => one(v.k, v.k === 'in' ? 'inward' : 'outward'), 50); });
}
// the table, used on the register page and inside a client page
function regTable(rows, showClient) {
  const csvBtn = rows.length ? '<button class="btn sm ghost noprint" id="rcsv">Export CSV</button>' : '';
  const head = `<tr><th>No.</th><th>Date</th><th>From / To</th><th>Subject</th>${showClient ? '<th>Client</th>' : ''}<th>Details</th><th class="noprint"></th></tr>`;
  const body = rows.map((x) => `<tr><td><b>${esc(x.no)}</b><div class="mute">${x.kind === 'in' ? 'Inward' : 'Outward'}</div></td><td>${dt(x.entry_date)}${x.entry_time ? '<div class="mute">' + esc(x.entry_time) + '</div>' : ''}</td><td>${esc(x.party || '—')}${x.dept ? '<div class="mute">' + esc(x.dept) + '</div>' : ''}</td>
    <td>${esc(x.subject || '—')}${x.file_no ? `<div class="mute">${esc(x.file_no)}</div>` : ''}${x.enclosures ? `<div class="mute">Encl: ${esc(x.enclosures)}</div>` : ''}</td>${showClient ? `<td>${x.client_id ? `<a href="#/client/${x.client_id}?tab=register">${esc(x.client_name)}</a>` : '—'}</td>` : ''}
    <td class="mute">${[x.their_ref && 'Ref: ' + x.their_ref, x.action, x.reply_to && 'Reply to ' + x.reply_to, x.mode, x.tracking && 'Track: ' + x.tracking, x.signature && 'Sign: ' + x.signature, x.remarks].filter(Boolean).map(esc).join(' · ') || '—'}</td>
    <td class="noprint" style="white-space:nowrap"><button class="btn sm ghost" data-re="${x.id}">Edit</button>${can('admin', 'advocate') ? ` <button class="btn sm ghost" data-rd="${x.id}">Delete</button>` : ''}</td></tr>`).join('');
  return { html: rows.length ? `<div class="row end" style="margin-bottom:.5rem">${csvBtn}</div><div class="tw"><table>${head}${body}</table></div>` : '<p class="mute">Nothing recorded.</p>', rows };
}
function regWire(root, rows, after) {
  $$('[data-re]', root).forEach((b) => (b.onclick = () => { const x = rows.find((r) => r.id === +b.dataset.re); regForm(x.kind, x, null, after); }));
  $$('[data-rd]', root).forEach((b) => (b.onclick = async () => { const x = rows.find((r) => r.id === +b.dataset.rd); if (!sure('Delete entry ' + x.no + '? This cannot be undone.')) return; try { await DEL('/api/register/' + x.id); toast('Deleted.'); after ? after() : go(); } catch (e) { toast(e.message, true); } }));
  const c = $('#rcsv', root); if (c) c.onclick = () => {
    const cols = ['kind', 'no', 'entry_date', 'entry_time', 'party', 'their_ref', 'subject', 'enclosures', 'dept', 'action', 'reply_to', 'mode', 'tracking', 'signature', 'remarks', 'client_name', 'file_no'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [cols.join(','), ...rows.map((r) => cols.map((k) => q(r[k])).join(','))].join('\n')], { type: 'text/csv' })); a.download = 'in-out-register.csv'; a.click();
  };
}
route(/^\/register$/, async (_, p) => {
  const kind = p.get('kind') || '', q = p.get('q') || '', from = p.get('from') || '', to = p.get('to') || '';
  const rows = await GET('/api/register?' + qs({ kind, q, from, to }));
  const t = regTable(rows, true);
  view(`<div class="row sp"><h1>In-Out Register</h1><span class="row"><button class="btn" id="ai">+ Inward</button><button class="btn" id="ao">+ Outward</button>${can('admin', 'advocate') ? '<button class="btn ghost" id="nb">Numbering</button>' : ''}</span></div>
    <div class="tabs">${[['', 'All'], ['in', 'Inward'], ['out', 'Outward']].map(([k, l]) => `<a href="#/register${k ? '?kind=' + k : ''}" class="${kind === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <form class="row noprint" id="rf" style="margin:.6rem 0;gap:.5rem;flex-wrap:wrap"><input name="q" value="${esc(q)}" placeholder="Search number, party, subject, client" style="flex:1;min-width:200px"><input type="date" name="from" value="${esc(from)}" title="From date" style="width:auto"><input type="date" name="to" value="${esc(to)}" title="To date" style="width:auto"><button class="btn ghost">Filter</button></form>
    <div class="card" id="rt">${t.html}</div><p class="mute">Entries can be made for any date. Only the number is compulsory.</p>`);
  $('#rf').onsubmit = (e) => { e.preventDefault(); const f = e.target; location.hash = '#/register?' + qs({ kind, q: f.q.value, from: f.from.value, to: f.to.value }); };
  $('#ai').onclick = () => regForm('in'); $('#ao').onclick = () => regForm('out');
  const nb = $('#nb'); if (nb) nb.onclick = regNumbering;
  regWire($('#rt'), rows);
}, { roles: ['admin', 'advocate', 'staff'] });
route(/^\/dak$/, async () => { location.hash = '#/register?kind=in'; }, { roles: ['admin', 'advocate', 'staff'] });

/* ===== messages ===== */
route(/^\/messages$/, async (_, p) => {
  const cid = p.get('client');
  const thread = async (clientId) => {
    const rows = await GET('/api/messages' + (clientId ? '?client_id=' + clientId : ''));
    return `<div class="card${can('admin') ? '' : ' noprint'}">${rows.length ? rows.map((m) => `<div class="msg ${m.from_user === ME.id ? 'me' : ''}"><small>${esc(m.from_name)} · ${dtm(m.created_at)}</small>${esc(m.body)}</div>`).join('') : '<p class="mute">No messages yet.</p>'}
      <form id="mf" class="row" style="margin-top:1rem;flex-wrap:nowrap"><input name="b" placeholder="Write a message…" required><button class="btn">Send</button></form></div>`;
  };
  const wire = (clientId) => { $('#mf').onsubmit = async (e) => { e.preventDefault(); try { await POST('/api/messages', { body: e.target.b.value, client_id: clientId }); go(); } catch (x) { toast(x.message, true); } }; };
  if (isClient()) { view(`<h1>Messages</h1><p class="mute">Write to the office about your case. For anything urgent, please also call.</p>${await thread()}`); wire(); return; }
  if (cid) { view(`<div class="row sp noprint"><h1>Conversation</h1><span class="row">${can('admin') ? `<a class="btn ghost sm" href="#/client/${cid}?tab=chat">Print / Save as PDF</a>` : ''}<a class="btn ghost sm" href="#/messages">← All</a></span></div>${await thread(cid)}`); wire(cid); return; }
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
      <td>${a.status === 'confirmed' ? (a.meet_link === 'restricted' ? `<span class="mute">Only ${esc(a.advocate)} / Admin</span>` : a.meet_link ? `<a class="btn sm" href="#/meeting/${a.id}">Open meeting</a>` : '<span class="mute">Preparing link…</span>') : ''}${a.status === 'awaiting_payment' && can('admin', 'advocate', 'staff', 'accounts') ? `<button class="btn sm gold" data-cf="${a.id}">Confirm payment</button> <span class="mute">${esc(a.pay_ref)}${a.pay_claim ? ' · client says paid, UTR ' + esc(a.pay_claim) : ''}</span>` : ''}${['confirmed', 'awaiting_payment'].includes(a.status) ? ` <button class="btn sm ghost" data-cx="${a.id}">Cancel</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="mute">No consultations booked.</p>'}</div>
    <p class="mute">A booking is confirmed — and the Google Meet link created and e-mailed to the client and the advocate — only after payment is recorded. The Admin is the host; only the Admin and the advocate booked can open the meeting here.</p>`);
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
  const pa = await GET('/api/portal-access'), wa = await GET('/api/whatsapp'), up = await GET('/api/upi'), rm = await GET('/api/reminders');
  view(`<h1>Settings</h1>
    <div class="card"><h2>Client portal</h2><div class="row sp"><span><b>${pa.client_portal ? 'Open' : 'CLOSED'}</b><div class="mute">${pa.client_portal ? 'Clients can sign in to see their cases, fees, letters and shared documents.' : 'No client can sign in or see anything. The office is not affected.'}</div></span>
      <button class="btn ${pa.client_portal ? 'ghost' : 'gold'}" id="cp">${pa.client_portal ? 'Close the client portal for everyone' : 'Open the client portal'}</button></div>
      <p class="mute" style="margin:.5rem 0 0">You can also block a single client, or switch off document sharing for one client, from that client's page.</p></div>
    <div class="card"><h2>Automatic payment reminders</h2>
      <form id="rmf"><label class="chk"><input type="checkbox" name="on" ${rm.on ? 'checked' : ''}> Send reminders automatically for unpaid invoices (daytime, 10 am – 6 pm India time)</label>
        <div class="row" style="gap:1rem;flex-wrap:wrap"><div><label>Only invoices dated on/after</label><input type="date" name="since" value="${rm.since || ''}" style="max-width:11rem"></div><div><label>First reminder, days after due date</label><input type="number" min="0" name="first" value="${rm.first}" style="max-width:8rem"></div>
          <div><label>Then repeat every (days)</label><input type="number" min="1" name="every" value="${rm.every}" style="max-width:8rem"></div>
          <div><label>At most (times per invoice)</label><input type="number" min="1" name="max" value="${rm.max}" style="max-width:8rem"></div></div>
        <label class="chk"><input type="checkbox" name="wa" ${rm.wa ? 'checked' : ''}> WhatsApp ${rm.wa_ready ? '' : '<span class="mute">(WhatsApp API not set up — skipped)</span>'}</label>
        <label class="chk"><input type="checkbox" name="email" ${rm.email ? 'checked' : ''}> E-mail ${rm.email_ready ? '' : '<span class="mute">(mailbox not set up — skipped)</span>'}</label>
        <p class="mute">Each reminder carries a Google Pay / UPI link for the exact pending amount ${rm.link_ready ? '' : '— <b>set your UPI ID below first, otherwise the link only opens the portal</b>'}. Older invoices (before the date above, e.g. imported ones) are never chased; the date resets to today whenever reminders are switched on. Invoice due dates start the count (invoice date if none). A client can be excluded from their own page. ${rm.pending} invoice${rm.pending === 1 ? ' is' : 's are'} due a reminder now.</p>
        <p><button class="btn">Save</button> <button class="btn ghost" type="button" id="rmr">Send due reminders now</button></p></form>
      ${rm.log.length ? `<details><summary>Recent reminders</summary><div class="tw"><table><tr><th>When</th><th>Invoice</th><th>Client</th><th>Via</th><th>Result</th></tr>${rm.log.map((l) => `<tr><td>${dtm(l.created_at.replace(' ', 'T') + 'Z')}</td><td>${esc(l.inv_no)}</td><td>${esc(l.client || '')}</td><td>${esc(l.channel)}${l.manual ? ' (manual)' : ''}</td><td>${esc(l.status)}${l.error ? ' — ' + esc(l.error) : ''}</td></tr>`).join('')}</table></div></details>` : ''}</div>
    <div class="card"><h2>Google Pay / UPI collection</h2>
      <form id="upf"><label>UPI ID (the one on your Google Pay for Business account)</label><input name="upi_id" value="${esc(up.vpa || '')}" placeholder="kclegal@okhdfcbank" autocomplete="off">
        <label>Name shown to the payer</label><input name="upi_name" value="${esc(up.name || '')}" placeholder="KC LEGAL">
        <label>Note on the pay page (optional)</label><input name="upi_note" value="${esc(up.note || '')}">
        <p><button class="btn">Save</button></p></form>
      <p>Your shareable payment link (for invoices, WhatsApp, e-mail): <code>${esc(up.pay_url)}</code> <button class="btn sm ghost" id="upc" type="button">Copy</button></p>
      <p class="mute">Add <code>&amp;amt=5000&amp;note=KC/INV/000101</code> to the end for a fixed amount. Booking payments use this UPI ID automatically, with the exact fee, a Google Pay button and a QR; the client then enters the UTR and you press “Confirm payment” in Appointments after seeing the credit in Google Pay.</p></div>
    <div class="card"><h2>WhatsApp to clients (Meta WhatsApp Business)</h2>
      <p>Status: ${wa.configured ? pill('connected', 'ok') : pill('not set up — messages open in WhatsApp for you to send by hand', 'warn')}</p>
      <form id="waf"><label>Phone number ID</label><input name="phone_id" value="${esc(wa.phone_id || '')}" autocomplete="off" placeholder="from Meta › WhatsApp › API setup">
        <label>WhatsApp Business Account ID</label><input name="waba" value="${esc(wa.waba || '')}" autocomplete="off">
        <label>Permanent access token ${wa.has_token ? '(saved — leave blank to keep)' : ''}</label><input name="token" type="text" autocomplete="off" data-lpignore="true" style="-webkit-text-security:disc">
        <label>App secret ${wa.has_secret ? '(saved — leave blank to keep)' : ''}</label><input name="app_secret" type="text" autocomplete="off" data-lpignore="true" style="-webkit-text-security:disc">
        <label>Template language code</label><input name="lang" value="${esc(wa.lang || 'en')}" style="max-width:8rem">
        <label class="chk"><input type="checkbox" name="welcome" ${wa.welcome ? 'checked' : ''}> Send a “Welcome to ${esc('KC LEGAL')}” greeting when a client's WhatsApp number is added for the first time</label>
        <label class="chk"><input type="checkbox" name="auto" ${wa.auto_booking ? 'checked' : ''}> Send the client a WhatsApp (with the video link) when a consultation is confirmed</label>
        <p><button class="btn">Save WhatsApp settings</button></p></form>
      <details><summary>How to set up</summary><ol class="mute">
        <li>developers.facebook.com › create an app (type Business) › add <b>WhatsApp</b>; link your Meta Business account and add the firm's WhatsApp number (it must not be in use in the ordinary WhatsApp app).</li>
        <li>Create a <b>System User</b> in Business Settings, give it the WhatsApp account, and generate a <b>permanent token</b> (permissions whatsapp_business_messaging, whatsapp_business_management). Paste the token, the Phone number ID and the account ID above. The app secret is under App settings › Basic.</li>
        <li>In WhatsApp Manager create and get approved these templates (names exactly as shown): ${wa.templates.map((t) => `<b>${esc(t.name)}</b> — <i>${esc(t.text)}</i>`).join('; ')}.</li>
        <li>WhatsApp › Configuration › Webhook: callback URL <code>${esc(wa.webhook_url || '')}</code>, verify token <code>${esc(wa.verify || '(save once to generate)')}</code>; subscribe to <b>messages</b>. This brings in delivery ticks and the client's replies (and “STOP” opt-outs).</li>
        <li>Send only to clients who agreed to receive WhatsApp messages. Business-started messages must use an approved template; free text works only for 24 hours after the client writes to you.</li></ol></details></div>
    <div class="card"><div class="row sp"><h2>Consultation types & default fees</h2><button class="btn sm" id="ct">Add type</button></div><ul class="list">${types.map((t) => `<li><span>${esc(t.name)} <span class="mute">${t.minutes} min</span></span><span class="row">${inr(t.fee_paise)} ${t.active ? '' : pill('off', 'bad')}<button class="btn sm ghost" data-et="${t.id}">Edit</button></span></li>`).join('')}</ul></div>
    <div class="card"><h2>Fee for each advocate</h2><p class="mute">Each advocate can charge a different fee. Leave a box blank to use the default fee shown above. Saved when you leave the box.</p>
    <div class="tw"><table><tr><th>Advocate</th>${types.map((t) => `<th class="n">${esc(t.name)}<br><span class="mute">default ${inr(t.fee_paise)}</span></th>`).join('')}</tr>
    ${advs.map((a) => `<tr><td>${esc(a.name)}</td>${types.map((t) => { const f = fees.find((x) => x.user_id === a.id && x.consult_type_id === t.id); return `<td class="n"><input type="number" min="0" step="1" style="width:110px" data-fee data-u="${a.id}" data-t="${t.id}" value="${f ? f.fee_paise / 100 : ''}" placeholder="${t.fee_paise / 100}"></td>`; }).join('')}</tr>`).join('')}</table></div></div>
    <div class="card"><h2>Import from Zoho Books</h2><p class="mute">One-time import of your old clients, invoices and receipts from the file KC-LEGAL-zoho-import.json. Safe to repeat: records already imported are skipped. Original Zoho numbers (INV-0000xx) are kept.</p>
    <p><input type="file" id="zf" accept=".json,application/json"> <button class="btn" id="zi">Import</button></p></div>
    <div class="card"><h2>Weekly availability for online consultations</h2><p class="mute">Times are India time. One line per slot: <code>Mon 10:00-13:00</code>. Leave blank for no availability.</p>
    ${advs.map((a) => { const mine = av.filter((x) => x.user_id === a.id).map((x) => `${days[x.weekday]} ${x.start_time}-${x.end_time}`).join('\n'); return `<label>${esc(a.name)}</label><textarea data-av="${a.id}">${esc(mine)}</textarea>`; }).join('')}
    <p><button class="btn" id="sv">Save availability</button></p></div>`);
  $('#rmf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await PUT('/api/reminders', { on: f.on.checked, since: f.since.value, first: f.first.value, every: f.every.value, max: f.max.value, wa: f.wa.checked, email: f.email.checked }); toast('Saved.'); go(); } catch (x) { toast(x.message, true); } };
  $('#rmr').onclick = async () => { try { const r = await POST('/api/reminders/run'); toast(r.invoices ? `${r.messages} message(s) sent for ${r.invoices} invoice(s).` : 'Nothing is due right now.'); go(); } catch (x) { toast(x.message, true); } };
  $('#upf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await PUT('/api/upi', { upi_id: f.upi_id.value, upi_name: f.upi_name.value, upi_note: f.upi_note.value }); toast('Saved.'); go(); } catch (x) { toast(x.message, true); } };
  $('#upc').onclick = () => { navigator.clipboard.writeText($('#upc').previousElementSibling.textContent).then(() => toast('Link copied.')); };
  $('#waf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await PUT('/api/whatsapp', { phone_id: f.phone_id.value, waba: f.waba.value, token: f.token.value, app_secret: f.app_secret.value, lang: f.lang.value, auto_booking: f.auto.checked, welcome: f.welcome.checked }); toast('Saved.'); go(); } catch (x) { toast(x.message, true); } };
  $('#cp').onclick = async () => { if (pa.client_portal && !sure('Close the client portal for ALL clients? They will be shut out immediately. Your own work is not affected.')) return; await PUT('/api/portal-access', { client_portal: !pa.client_portal }); go(); };
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
      <h3>Page &amp; margins</h3><label>Paper size</label><select name="page_size">${[['a4', 'A4 (210 × 297 mm)'], ['legal', 'Legal (216 × 356 mm)'], ['letter', 'Letter (216 × 279 mm)']].map(([v, l]) => `<option value="${v}" ${T.settings.page_size === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <p class="mute">Top and bottom are the space kept clear for the letterhead's header and footer. They apply on every page of a long document. Margins are in millimetres.</p>
      <div class="row"><div>${F('top_mm', 'Top / header', { type: 'number' })}</div><div>${F('bottom_mm', 'Bottom / footer', { type: 'number' })}</div></div><div class="row"><div>${F('left_mm', 'Left', { type: 'number' })}</div><div>${F('right_mm', 'Right', { type: 'number' })}</div></div>
      <div class="row" style="margin-top:.4rem"><button type="button" class="btn sm ghost" id="mstd">Standard A4 (25 mm all round)</button></div>
      <h3>Wording</h3>${F('invoice_title', 'Invoice title')}${F('receipt_title', 'Receipt title')}${F('signatory_name', 'Signatory name')}${F('signatory_title', 'Signatory designation')}${F('payment_details', 'Payment details (bank / UPI)', { area: 1 })}${F('invoice_footer', 'Invoice footer note', { area: 1 })}
      <p class="err" hidden></p><div style="margin-top:1rem"><button class="btn gold" style="width:100%">Save design</button></div></form></div>
      <div class="tplprev" id="pv"></div></div>`);
  const form = $('#tf'), pv = $('#pv');
  const read = () => { const o = {}; new FormData(form).forEach((v, k) => { if (k !== 'file') o[k] = ['top_mm', 'bottom_mm', 'left_mm', 'right_mm'].includes(k) ? Number(v) : v; }); return o; };
  const paint = () => { T = { ...T, settings: { ...T.settings, ...read() } }; pv.innerHTML = sample(); const sh = $('.sheet', pv); const z = Math.min(1, (pv.clientWidth - 16) / sh.offsetWidth); sh.style.zoom = z > 0 ? z : 1; };
  form.addEventListener('input', paint); paint();
  $('#mstd').onclick = () => { form.elements.page_size.value = 'a4'; ['top_mm', 'bottom_mm', 'left_mm', 'right_mm'].forEach((k) => (form.elements[k].value = 25)); paint(); };
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


/* ===== one online consultation: join + record (Admin and the booked advocate only) ===== */
route(/^\/meeting\/(\d+)$/, async ([id]) => {
  const m = await GET(`/api/appointments/${id}/meeting`);
  view(`<div class="row sp"><h1>Online consultation</h1><a class="btn ghost sm" href="#/appointments">← All consultations</a></div>
    <div class="card"><p><b>${esc(m.name)}</b> · ${esc(m.phone || '')} · ${esc(m.email || '')}<br>${dtm(m.start_at)} to ${dtm(m.end_at)} (India time)<br>${esc(m.type_name)} with <b>${esc(m.advocate)}</b> · host: Admin</p>
      <p class="mute">${esc(m.issue || '')}</p>
      <div class="row"><button class="btn gold" id="jn" ${m.status === 'confirmed' && m.meet_link ? '' : 'disabled'}>Join video call</button><span class="mute">${m.meet_link ? 'Only the invited client, the booked advocate and the Admin are admitted.' : 'The link is still being prepared.'}</span></div>
      ${m.meet_note ? `<p class="mute">${esc(m.meet_note)}</p>` : ''}</div>
    <div class="card"><h2>Recording</h2>
      <p class="mute">Tell the client the call is being recorded. Status: <b>${esc(m.rec_status || 'not recorded yet')}</b>. Recordings are kept in Google Drive: KcLegalPortal › ${esc(m.name)} › Recordings.</p>
      ${m.can_record ? `<p id="rs" class="mute"></p><div class="row"><button class="btn" id="rb">● Start recording</button><button class="btn ghost" id="rx" hidden>■ Stop and save</button></div>
      <p class="mute">To record from here: join the call in another tab, press Start, choose that <b>Meet tab</b> and tick <b>Share tab audio</b>. Keep this page open until you press Stop. (If Google's own recording is on for your account, it is filed automatically after the call.)</p>` : '<p class="mute">Connect Google Drive (Files → Storage settings) to record.</p>'}
      <h3>Saved recordings for this client</h3>${m.recordings.length ? `<ul class="list">${m.recordings.map((r) => `<li><a href="/api/fs/${r.id}/download">${esc(r.name)}</a><span class="mute">${fxSize(r.size)} · ${dtm(r.created_at)}</span></li>`).join('')}</ul>` : '<p class="mute">None yet.</p>'}</div>`);
  $('#jn').onclick = async () => { try { const r = await GET(`/api/appointments/${id}/join`); window.open(r.link, '_blank', 'noopener'); } catch (e) { toast(e.message, true); } };
  const rb = $('#rb'); if (!rb) return;
  let mr = null, rid = null, off = 0, chain = Promise.resolve(), streams = [], ac = null;
  const say = (t) => { $('#rs').textContent = t; };
  const send = (blob) => { chain = chain.then(async () => { const buf = await blob.arrayBuffer(); for (let k = 0; k < 4; k++) { const r = await fetch(`/api/appointments/${id}/recording/chunk?rid=${rid}&off=${off}`, { method: 'POST', headers: { 'X-Requested-With': 'kcportal', 'Content-Type': 'application/octet-stream' }, body: buf }); if (r.ok) { off += buf.byteLength; return; } if (k === 3) throw new Error('upload'); await new Promise((z) => setTimeout(z, 1500 * (k + 1))); } }).catch((e) => say('A piece could not be sent — keep the page open; the recording may be incomplete.')); return chain; };
  rb.onclick = async () => {
    try {
      const d = await POST(`/api/appointments/${id}/recording/start`); rid = d.rid; off = 0;
      const scr = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true }); streams = [scr];
      ac = new AudioContext(); const dest = ac.createMediaStreamDestination();
      if (scr.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(scr.getAudioTracks())).connect(dest);
      try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); streams.push(mic); ac.createMediaStreamSource(mic).connect(dest); } catch (e) {}
      const out = new MediaStream([...scr.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      mr = new MediaRecorder(out, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm', videoBitsPerSecond: 700000, audioBitsPerSecond: 64000 });
      mr.ondataavailable = (e) => { if (e.data && e.data.size) send(e.data); };
      mr.onstop = async () => { streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); try { ac.close(); } catch (e) {} await chain; say('Saving to Google Drive…'); try { const r = await POST(`/api/appointments/${id}/recording/finish`, { rid }); toast('Recording saved.'); go(); } catch (e) { say(e.message); $('#rx').hidden = false; $('#rx').textContent = 'Save again'; $('#rx').onclick = async () => { try { await POST(`/api/appointments/${id}/recording/finish`, { rid }); toast('Recording saved.'); go(); } catch (x) { say(x.message); } }; } };
      scr.getVideoTracks()[0].onended = () => { if (mr && mr.state !== 'inactive') mr.stop(); };
      mr.start(15000); rb.hidden = true; $('#rx').hidden = false; say('● Recording… keep this page open.');
      window.onbeforeunload = () => (mr && mr.state !== 'inactive' ? 'A recording is in progress.' : undefined);
    } catch (e) { toast(e.message || 'Recording was not started.', true); }
  };
  $('#rx').onclick = () => { if (mr && mr.state !== 'inactive') mr.stop(); $('#rx').hidden = true; };
}, { roles: ['admin', 'advocate'] });
