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
/* ===== start-page hero: greeting, live India time and weather ===== */
function heroHtml(name) {
  return `<div class="hero"><div class="hero-l"><div class="hero-hi" id="hh">Good day</div><h1>${esc(name)}</h1><div class="hero-firm">${esc(FIRM)}</div></div>
    <div class="hero-r"><div class="hero-clock" id="hc">--:--:--</div><div class="hero-date" id="hd"></div><div class="hero-wx" id="hw"><span class="mute">Loading weather…</span></div></div></div>`;
}
function heroStart() {
  const tick = () => {
    const c = document.getElementById('hc'); if (!c) { clearInterval(window.__hero); return; }
    const n = new Date(), p = (o) => new Intl.DateTimeFormat('en-IN', Object.assign({ timeZone: 'Asia/Kolkata' }, o)).format(n);
    const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(n) % 24;
    c.textContent = p({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase() + ' IST';
    document.getElementById('hd').textContent = p({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('hh').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  };
  tick(); clearInterval(window.__hero); window.__hero = setInterval(tick, 1000);
  GET('/api/weather').then((w) => { const el = document.getElementById('hw'); if (!el) return; el.innerHTML = w.unavailable ? `<span class="mute">${esc(w.city)} — weather unavailable</span>` : `<span class="wx-ic">${w.icon}</span><span><b>${w.temp}°C</b> ${esc(w.text)}<br><span class="mute">${esc(w.city)} · feels ${w.feels}° · humidity ${w.humidity}% · wind ${w.wind} km/h${w.hi != null ? ' · high ' + w.hi + '° / low ' + w.lo + '°' : ''}</span></span>`; }).catch(() => {});
}

route(/^\/$/, async () => {
  const d = await GET('/api/dashboard');
  if (isClient()) {
    view(`${heroHtml(ME.name.split(' ')[0])}<div id="qod" class="qod"></div>
      <div class="grid"><a class="stat" href="#/matters"><b>${d.matters}</b><span>Open cases</span></a>
      <a class="stat" href="#/letters"><b>${d.unread_letters}</b><span>New letters</span></a>
      <a class="stat" href="#/messages"><b>${d.unread_messages}</b><span>New messages</span></a>
      <a class="stat ${d.due_paise ? 'alert' : ''}" href="#/invoices"><b>${inr(d.due_paise)}</b><span>Fees due</span></a></div>
      <div class="card" style="margin-top:1rem"><h2>Next court dates</h2>${d.next_dates.length ? `<ul class="list">${d.next_dates.map((x) => `<li><a href="#/matter/${x.matter_id}">${esc(x.title)}</a><b>${dt(x.date)}</b></li>`).join('')}</ul>` : '<p class="mute">No upcoming dates recorded.</p>'}</div>
      <div class="card"><div class="row sp"><h2>Consultations</h2><a class="btn sm" href="#/book">Book a call</a></div>${d.appointments.length ? `<ul class="list">${d.appointments.map((a) => `<li><span>${dtm(a.start_at)}</span><span>${sp(a.status)} ${a.meet_link ? `<a href="${esc(a.meet_link)}" target="_blank" rel="noopener">Join</a>` : ''}</span></li>`).join('')}</ul>` : '<p class="mute">None booked.</p>'}</div>`);
    heroStart(); quoteStart();
    return;
  }
  const mod = (k) => !(MODS.off || []).includes(k) && !(MODS.advOff || []).includes(k), pro = ['admin', 'advocate', 'staff'].includes(ME.role);
  const stat = (href, n, label, alert) => `<a class="stat ${alert ? 'alert' : ''}" href="${href}"><b>${n}</b><span>${label}</span></a>`;
  view(`${heroHtml(ME.name.split(' ')[0])}<div id="qod" class="qod"></div>
    ${mod('research') ? researchBox() : ''}
    <div class="grid">${pro ? stat('#/matters', d.open_matters, 'Open cases') : ''}${stat('#/tasks', d.my_tasks, 'My tasks')}${stat('#/tasks?view=overdue', d.overdue_tasks, 'Overdue tasks', d.overdue_tasks)}
    ${mod('crm') ? stat('#/leads', d.new_leads, 'New leads') + stat('#/appointments', d.appointments_today, 'Calls today') : ''}${mod('messages') && ME.role !== 'accounts' && ME.role !== 'telecaller' ? stat('#/messages', d.unread_messages, 'Client messages') : ''}${mod('letters') && pro ? stat('#/letters', d.drafts_to_approve, 'Letter drafts') : ''}</div>
    ${pro ? `<div class="card"><div class="row sp"><h2>Court dates — next 7 days</h2>${can('admin', 'advocate', 'staff', 'telecaller') ? '<button class="btn sm gold" id="qc">+ Add client</button>' : ''}</div>${d.dates.length ? `<ul class="list">${d.dates.map((x) => `<li><span><a href="#/matter/${x.matter_id}">${esc(x.title)}</a><div class="mute">${esc(x.file_no)} · ${esc(x.forum || '')}</div></span><b>${dt(x.date)}</b></li>`).join('')}</ul>` : '<p class="mute">Nothing listed for the coming week.</p>'}</div>` : ''}`);
  const qc = $('#qc'); if (qc) qc.onclick = () => addClient();
  researchBoxWire();
  heroStart(); quoteStart();
  homeExtras();
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
  return ask('New client', [{ name: 'name', label: 'Full name', required: true }, { name: 'reference', label: 'Reference (through whom the client came)', list: refs, hint: 'Optional. Pick an existing name or type a new one. The client\'s folder is kept under this name.' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email', hint: 'Needed if you give the client portal access.' }, { name: 'address', label: 'Address', type: 'textarea' },
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
  if (!clientId) fields.push({ name: 'client_id', label: 'Client', type: 'select', options: [['', '— choose —'], ...await clientOpts(), NEW_CLIENT], required: true }, ...newClientFields());
  fields.push({ name: 'title', label: 'Case title', required: true, ph: 'e.g. Ramesh Sharma v. State Bank of India' }, { name: 'forum', label: 'Court / forum' }, { name: 'case_no', label: 'Case number' },
    { name: 'opposite_party', label: 'Opposite party' }, { name: 'stage', label: 'Stage' }, { name: 'assigned_to', label: 'Handled by', type: 'select', options: await teamOpts('— unassigned —') });
  ask('New case', fields, 'Create', async (v) => { const cid = clientId || await resolveClient(v); const r = await POST('/api/matters', { ...v, client_id: cid }); location.hash = '#/matter/' + r.id; }); if (!clientId) wireNewClient();
}

/* ===== matters ===== */
route(/^\/matters$/, async () => {
  const draw = async (q) => {
    const rows = await GET('/api/matters?' + qs({ q }));
    $('#res').innerHTML = rows.length ? `<div class="tw"><table><tr><th>File</th><th>Case</th>${isClient() ? '' : '<th>Client</th>'}<th>Forum</th><th>Next date</th><th></th></tr>${rows.map((m) => `<tr><td>${esc(m.file_no)}</td><td><a href="#/matter/${m.id}">${esc(m.title)}</a></td>${isClient() ? '' : `<td>${esc(m.client_name)}</td>`}<td>${esc(m.forum || '')}</td><td>${m.next_date ? dt(m.next_date) : '—'}</td><td>${sp(m.status)}</td></tr>`).join('')}</table></div>` : '<p class="mute">No cases found.</p>';
  };
  view(`<div class="row sp"><h1>${isClient() ? 'My cases' : 'Cases'}</h1><span class="row" style="gap:.4rem">${can('admin') ? '<a class="btn ghost sm" href="#/deleted-cases">Recycle Bin</a>' : ''}${can('admin', 'advocate', 'staff') ? '<button class="btn" id="add">New case</button>' : ''}</span></div>${searchBar('Search title, file number or client')}<div class="card" id="res"></div>`);
  liveSearch(draw); draw('');
  const add = $('#add'); if (add) add.onclick = () => newMatter();
});

route(/^\/matter\/(\d+)$/, async ([id]) => {
  const m = await GET('/api/matters/' + id), cli = isClient(), lvl = m.my_level || 'full', edit = can('admin', 'advocate', 'staff') && lvl !== 'view', canF = can('admin', 'advocate', 'staff') && lvl === 'full';
view(`<div class="row sp"><div><h1 style="margin-bottom:.1rem">${esc(m.title)}</h1><div class="mute">${esc(m.forum || '')}</div>
      <div class="row" style="gap:.5rem;margin-top:.35rem"><span class="mute">File No. ${esc(m.file_no)} · ${esc(m.client_name)}</span> ${sp(m.status)}</div></div>
      <div class="row">${canF ? '<button class="btn sm ghost" id="em">Edit</button>' : ''}${canF && can('admin', 'advocate') ? '<button class="btn sm ghost" id="dm" style="color:var(--bad,#b00020)">Delete</button>' : ''}<a class="btn ghost sm" href="#/matters">← ${cli ? 'My cases' : 'Cases'}</a></div></div>
    ${cli ? '' : '<div class="card" id="tcard" style="padding:10px 16px"></div><div class="card" id="mvcard" style="padding:10px 16px"></div>'}
    ${cli ? '' : '<div class="card" id="ecard" style="padding:10px 16px"></div>'}
    ${(() => { const I = m.ident || {}, cn = I.case_no || m.case_no || '', d1 = (x) => (x ? ' <span class="mute" style="white-space:nowrap">dated ' + esc(dt(x)) + '</span>' : ''), kv = (k, v) => (v ? `<div style="display:flex;gap:.6rem;padding:.18rem 0"><span class="mute" style="min-width:7.5rem">${k}</span><b>${esc(v)}</b></div>` : ''), day = I.next_date ? new Date(I.next_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }) : '';
      const side = (t, a) => `<div class="card" style="margin:0"><div class="row sp"><b>${t}</b><span class="chip" style="padding:.05rem .5rem">${a.length}</span></div>${a.length ? a.map((x) => `<div style="padding:.3rem 0;border-top:1px solid var(--line);margin-top:.3rem">${esc(x)}</div>`).join('') : '<div class="mute" style="margin-top:.4rem">—</div>'}</div>`;
      return `<div class="grid2" style="align-items:stretch;margin-bottom:1rem"><div class="card" style="margin:0"><div style="font-size:14px;line-height:1.7"><b>Case No.:</b> <b style="color:#c00000">${esc(cn || '—')}</b>${cn && I.case_date ? d1(I.case_date) : ''}${I.reg_no ? `<br><b>Registration No.:</b> ${esc(I.reg_no)}${d1(I.reg_date)}` : ''}</div>
          <div style="margin-top:.5rem">${kv('Filing No.', (I.filing_no || '').replace('Filing No: ', ''))}${kv('Stage', I.stage || m.stage)}${kv('CNR No.', I.cnr)}${kv('Act', I.act)}${cli ? '' : kv('Opposite party', m.opposite_party)}</div></div>
        <div class="card" style="margin:0;text-align:center"><div class="mute">Next hearing</div><div style="font:700 14px Georgia,serif;color:var(--navy);margin:.25rem 0">${I.next_date ? esc(dt(I.next_date)) + ' <span class="mute" style="font-size:12px">(' + day + ')</span>' : '—'}</div><div class="mute">${I.next_date ? 'From the court record' : 'Not available — add a hearing or link the court record'}</div>
          <div style="display:flex;justify-content:center;gap:2.2rem;margin-top:.8rem;border-top:1px solid var(--line);padding-top:.6rem"><div><div class="mute">Court</div><b>${esc(I.court_no || '—')}</b></div><div><div class="mute">Item No.</div><b>${esc(I.item_no || '—')}</b></div></div></div></div>
        ${cli || !m.ident ? '' : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;margin-bottom:1rem">${side('Advocates (petitioner side)', I.adv_p || [])}${side('Advocates (respondent side)', I.adv_r || [])}${side('Judges', I.judges || [])}</div>`}`; })()}
    ${cli ? (m.client_visible_note ? `<div class="card"><p><b>Update from the office:</b><br>${esc(m.client_visible_note)}</p></div>` : '') : (m.summary ? `<div class="card"><p><b>Internal summary:</b><br>${esc(m.summary)}</p></div>` : '')}
 <div class="card" id="dcard"></div>
    <div class="card"><div class="tabs" id="mtabs" style="margin-bottom:.8rem">${[['listings', 'Listings'], ...(cli ? [] : [['orders', 'Orders'], ['ia', 'IA'], ['history', 'History']])].map(([k, l]) => `<a href="javascript:void(0)" data-mt="${k}">${l}</a>`).join('')}</div>
    <div data-mp="listings"><div><div class="row sp"><h2>Hearings & dates</h2>${edit ? '<button class="btn sm" id="ah">Add hearing</button>' : ''}</div>
    ${m.hearings.length ? `<div class="tw"><table><tr><th>Date</th><th>Purpose</th><th>Outcome</th><th>Next date</th></tr>${m.hearings.map((h) => `<tr><td>${dt(h.hearing_date)}</td><td>${esc(h.purpose || '')}</td><td>${esc(h.outcome || '')}</td><td><b>${h.next_date ? dt(h.next_date) : '—'}</b></td></tr>`).join('')}</table></div>` : '<p class="mute">No hearings recorded.</p>'}</div></div>
    ${cli ? '' : '<div data-mp="orders" hidden><p class="mute">Loading…</p></div><div data-mp="ia" hidden></div><div data-mp="history" hidden></div>'}
    </div>
    ${cli ? '' : '<div class="card" id="acard"></div>'}
    ${m.letters.length ? `<div class="card"><h2>Letters</h2><ul class="list">${m.letters.map((l) => `<li><a href="#/letter/${l.id}">${esc(l.subject)}</a><span class="mute">${esc(l.ref_no || 'draft')}</span></li>`).join('')}</ul></div>` : ''}
    ${m.invoices.length ? `<div class="card"><h2>Fees</h2><ul class="list">${m.invoices.map((i) => `<li><a href="#/invoice/${i.id}">${esc(i.inv_no)}</a><span>${inr(i.total_paise)} ${sp(i.status)}</span></li>`).join('')}</ul></div>` : ''}
    ${cli ? '' : `<div class="card"><div class="row sp"><h2>Tasks</h2>${edit ? '<button class="btn sm" id="at">Assign task</button>' : ''}</div>${m.tasks.length ? `<ul class="list">${m.tasks.map((t) => `<li><span>${esc(t.title)}<div class="mute">${esc(t.assignee || '')} · due ${dt(t.due_date)}</div></span>${sp(t.status)}</li>`).join('')}</ul>` : '<p class="mute">No tasks.</p>'}</div>`}
    ${cli ? '' : `<div class="card"><div class="row sp"><h2>File notings</h2>${edit ? '<button class="btn sm" id="an">Add noting</button>' : ''}</div>${m.notings.length ? `<ul class="list">${m.notings.map((n) => `<li><span>${esc(n.note)}<div class="mute">${esc(n.user_name || '')} · ${dtm(n.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">No notings.</p>'}</div></div>`}
    <div class="card"><div class="row sp"><h2>Files</h2><span class="mute">${esc(m.client_name)}</span></div><div id="fx"></div></div>`);
  { const tabs = $$('[data-mt]'), show = (k) => { tabs.forEach((a) => a.classList.toggle('on', a.dataset.mt === k)); $$('[data-mp]').forEach((d) => (d.hidden = d.dataset.mp !== k)); }; tabs.forEach((a) => (a.onclick = () => show(a.dataset.mt))); show(cli ? 'listings' : 'orders'); }
  const upd = () => go();
  if (!cli) { teamCard(id, m); moveCard(id, m); }
  diaryCard(id, m, cli);
  if (!cli && typeof courtCard === 'function') courtCard(id, edit, m);
  if (!cli && typeof argCard === 'function') argCard(id);
  const dm = $('#dm'); if (dm) dm.onclick = () => ask('Delete this case?', [{ name: 'confirm', label: `It moves to the Recycle Bin, not deleted for good: its papers stay in Google Drive and the firm administrator can restore it at any time. Type ${m.file_no} to confirm`, required: true }], 'Delete case', async (v) => { await api('DELETE', '/api/matters/' + id, { confirm: v.confirm }); toast('Case deleted.'); location.hash = '#/matters'; });
  const em = $('#em'); if (em) em.onclick = () => ask('Edit case', [{ name: 'title', label: 'Title', value: m.title, required: true }, { name: 'forum', label: 'Forum', value: m.forum }, { name: 'case_no', label: 'Case number', value: m.case_no }, { name: 'opposite_party', label: 'Opposite party', value: m.opposite_party }, { name: 'stage', label: 'Stage', value: m.stage }, { name: 'status', label: 'Status', type: 'select', value: m.status, options: ['open', 'on_hold', 'closed'] }, { name: 'summary', label: 'Internal summary', type: 'textarea', value: m.summary }, { name: 'client_visible_note', label: 'Update the client can see', type: 'textarea', value: m.client_visible_note }], 'Save', async (v) => { await PUT('/api/matters/' + id, v); upd(); });
  const ah = $('#ah'); if (ah) ah.onclick = () => ask('Record hearing', [{ name: 'hearing_date', label: 'Hearing date', type: 'date', value: today(), required: true }, { name: 'purpose', label: 'Purpose' }, { name: 'outcome', label: 'Outcome / order' }, { name: 'next_date', label: 'Next date', type: 'date' }], 'Save', async (v) => { await POST(`/api/matters/${id}/hearings`, v); upd(); });
  if (typeof explorer === 'function' && $('#fx')) explorer($('#fx'), { client: m.client_id, scopeName: m.client_name, cli });
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
    <a class="btn sm ghost" href="/api/letters/${id}/download/docx">Word</a><a class="btn sm ghost" href="/api/letters/${id}/download/pdf">PDF</a><button class="btn sm" data-print>Print</button></div></div>
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
  const csvBtn = rows.length ? '<button class="btn sm ghost noprint" id="rcsv">Export CSV</button><button class="btn sm ghost noprint" data-rx="docx">Word</button><button class="btn sm ghost noprint" data-rx="pdf">PDF</button>' : '';
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
  $$('[data-rx]', root).forEach((b) => (b.onclick = () => { const ks = [['kind', 'Type', 1], ['no', 'No.', 1], ['entry_date', 'Date', 1.2], ['party', 'Party', 2], ['their_ref', 'Their ref.', 1.2], ['subject', 'Subject', 3], ['dept', 'Dept.', 1], ['action', 'Action', 1.5], ['mode', 'Mode', 1], ['file_no', 'File', 1.2]]; dlTable(b.dataset.rx, 'In-Out Register', `${rows.length} entries`, ks.map((k) => ({ h: k[1], w: k[2] })), rows.map((r) => ks.map((k) => r[k[0]] == null ? '' : r[k[0]]))); }));
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
  try {
    const st = await GET('/api/team/settings'), box = document.createElement('div'); box.className = 'card';
    box.innerHTML = `<h2>What advocates and staff can see</h2><p class="mute">An advocate or staff member always sees the cases allotted to him (or created by him) and the tasks given to him. Everything else stays hidden until you switch it on. Accountants see only Accounts, and telecallers only calling and CRM.</p>
      <div class="tw"><table><tr><th>Part of the portal</th><th>Advocates</th><th>Staff</th></tr>${st.keys.map((k) => `<tr><td>${esc(k.label)}</td><td><input type="checkbox" data-adv="${esc(k.key)}" ${k.on ? 'checked' : ''}></td><td><input type="checkbox" data-stf="${esc(k.key)}" ${k.staff ? 'checked' : ''}></td></tr>`).join('')}</table></div>`;
    $('#view').insertBefore(box, $('#view').children[2] || null);
    box.onchange = async () => { await PUT('/api/team/settings', { advocate: $$('[data-adv]', box).filter((x) => x.checked).map((x) => x.dataset.adv), staff: $$('[data-stf]', box).filter((x) => x.checked).map((x) => x.dataset.stf) }); toast('Saved.'); };
  } catch (e) {}
  $$('[data-inv]').forEach((b) => (b.onclick = async () => link((await POST(`/api/users/${b.dataset.inv}/invite`)).invite_path)));
  $$('[data-tg]').forEach((b) => (b.onclick = async () => { await PATCH('/api/users/' + b.dataset.tg, { active: b.dataset.a === '1' ? 1 : 0 }); TEAM = null; go(); }));
}, { roles: ['admin'] });

route(/^\/settings$/, async () => {
  const [types, av, fees] = await Promise.all([GET('/api/consult-types'), GET('/api/availability'), GET('/api/consult-fees')]);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const advs = (await team()).filter((u) => ['admin', 'advocate'].includes(u.role));
  const pa = await GET('/api/portal-access'), up = await GET('/api/upi'), acc = await GET('/api/access');
  view(`<h1>Settings</h1>
    <div class="card"><h2>Client portal</h2><div class="row sp"><span><b>${pa.client_portal ? 'Open' : 'CLOSED'}</b><div class="mute">${pa.client_portal ? 'Clients can sign in to see their cases, fees, letters and shared documents.' : 'No client can sign in or see anything. The office is not affected.'}</div></span>
      <button class="btn ${pa.client_portal ? 'ghost' : 'gold'}" id="cp">${pa.client_portal ? 'Close the client portal for everyone' : 'Open the client portal'}</button></div>
      <p class="mute" style="margin:.5rem 0 0">You can also block a single client, or switch off document sharing for one client, from that client's page.</p></div>
    <div class="card"><h2>Google Pay / UPI collection</h2>
      <form id="upf"><label>UPI ID (the one on your Google Pay for Business account)</label><input name="upi_id" value="${esc(up.vpa || '')}" placeholder="kclegal@okhdfcbank" autocomplete="off">
        <label>Name shown to the payer</label><input name="upi_name" value="${esc(up.name || '')}" placeholder="${esc(FIRM)}">
        <label>Note on the pay page (optional)</label><input name="upi_note" value="${esc(up.note || '')}">
        <p><button class="btn">Save</button></p></form>
      <p>Your shareable payment link (for invoices, WhatsApp, e-mail): <code>${esc(up.pay_url)}</code> <button class="btn sm ghost" id="upc" type="button">Copy</button></p>
      <p class="mute">Add <code>&amp;amt=5000&amp;note=INV/000101</code> to the end for a fixed amount. Booking payments use this UPI ID automatically, with the exact fee, a Google Pay button and a QR; the client then enters the UTR and you press “Confirm payment” in Appointments after seeing the credit in Google Pay.</p></div>
    <div class="card"><h2>Who can use what</h2><p class="mute">Choose which members of your firm may use each service your plan includes. You, as administrator, can always use them. A service that is not active for your firm is switched off by the portal provider.</p>
      <div class="tw"><table><tr><th>Service</th>${acc.roles.map((r) => `<th>${esc(r[1])}</th>`).join('')}</tr>${acc.services.map((s) => `<tr><td>${esc(s.label)}${s.active ? '' : ' <span class="mute">(not active)</span>'}</td>${acc.roles.map((r) => `<td><input type="checkbox" data-acl="${s.id}" value="${r[0]}" ${s.roles.includes(r[0]) ? 'checked' : ''} ${s.active ? '' : 'disabled'}></td>`).join('')}</tr>`).join('')}</table></div>
      ${acc.other.length ? `<p class="mute">Also part of your plan: ${acc.other.map((o) => esc(o.label) + (o.active ? '' : ' (off)')).join(', ')}.</p>` : ''}
      <p><button class="btn" id="aclsv">Save access</button></p></div>
    <div class="card"><div class="row sp"><h2>Consultation types & default fees</h2><button class="btn sm" id="ct">Add type</button></div><ul class="list">${types.map((t) => `<li><span>${esc(t.name)} <span class="mute">${t.minutes} min</span></span><span class="row">${inr(t.fee_paise)} ${t.active ? '' : pill('off', 'bad')}<button class="btn sm ghost" data-et="${t.id}">Edit</button></span></li>`).join('')}</ul></div>
    <div class="card"><h2>Fee for each advocate</h2><p class="mute">Each advocate can charge a different fee. Leave a box blank to use the default fee shown above. Saved when you leave the box.</p>
    <div class="tw"><table><tr><th>Advocate</th>${types.map((t) => `<th class="n">${esc(t.name)}<br><span class="mute">default ${inr(t.fee_paise)}</span></th>`).join('')}</tr>
    ${advs.map((a) => `<tr><td>${esc(a.name)}</td>${types.map((t) => { const f = fees.find((x) => x.user_id === a.id && x.consult_type_id === t.id); return `<td class="n"><input type="number" min="0" step="1" style="width:110px" data-fee data-u="${a.id}" data-t="${t.id}" value="${f ? f.fee_paise / 100 : ''}" placeholder="${t.fee_paise / 100}"></td>`; }).join('')}</tr>`).join('')}</table></div></div>
    <div class="card"><h2>Import from Zoho Books</h2><p class="mute">One-time import of your old clients, invoices and receipts from the file KC-LEGAL-zoho-import.json. Safe to repeat: records already imported are skipped. Original Zoho numbers (INV-0000xx) are kept.</p>
    <p><input type="file" id="zf" accept=".json,application/json"> <button class="btn" id="zi">Import</button></p></div>
    <div class="card"><h2>Weekly availability for online consultations</h2><p class="mute">Times are India time. One line per slot: <code>Mon 10:00-13:00</code>. Leave blank for no availability.</p>
    ${advs.map((a) => { const mine = av.filter((x) => x.user_id === a.id).map((x) => `${days[x.weekday]} ${x.start_time}-${x.end_time}`).join('\n'); return `<label>${esc(a.name)}</label><textarea data-av="${a.id}">${esc(mine)}</textarea>`; }).join('')}
    <p><button class="btn" id="sv">Save availability</button></p></div>`);
  $('#upf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await PUT('/api/upi', { upi_id: f.upi_id.value, upi_name: f.upi_name.value, upi_note: f.upi_note.value }); toast('Saved.'); go(); } catch (x) { toast(x.message, true); } };
  $('#upc').onclick = () => { navigator.clipboard.writeText($('#upc').previousElementSibling.textContent).then(() => toast('Link copied.')); };
  $('#aclsv').onclick = async () => { const acl = {}; acc.services.forEach((x) => (acl[x.id] = [])); $$('[data-acl]').forEach((c) => { if (c.checked) acl[c.dataset.acl].push(c.value); }); try { await PUT('/api/access', { acl }); toast('Access saved.'); } catch (x) { toast(x.message, true); } };
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
  try {
    const rs = await GET('/api/research/status').catch(() => null);
    if (rs !== null && !(MODS.off || []).includes('research') || (rs && !rs.on)) {
      const box = document.createElement('div'); box.className = 'card';
      box.innerHTML = `<h2>Research Desk</h2><label class="chk"><input type="checkbox" id="rsw" ${rs && rs.on ? 'checked' : ''}> Show the Research Desk (law search and AI questions) to my firm</label><p class="mute">Switch it off to hide it for everyone in your firm. Your portal provider can also leave it out of your plan.</p>`;
      $('#view').insertBefore(box, $('#view').children[2] || null);
      $('#rsw', box).onchange = async (e) => { await PUT('/api/research/settings', { on: e.target.checked }); toast(e.target.checked ? 'Research Desk is on.' : 'Research Desk is off.'); MODS = await GET('/api/modules'); };
    }
  } catch (e) {}
}, { roles: ['admin'] });

/* ===== Document design (letter pad template) — firm admin ===== */
route(/^\/template$/, async () => {
  if (ME.role !== 'admin') { view('<p class="mute">Only the firm administrator can change the document design.</p>'); return; }
  let T = await getTpl(true);
  { const S0 = T.settings; if (![1, 2, 3, 4].some((n) => S0['pay' + n + '_text'])) { S0.pay1_text = S0.payment_details || ''; S0.pay2_text = S0.pan || ''; } }
  const F = (k, label, o = {}) => `<label>${label}</label>${o.hint ? `<div class="mute" style="font-size:10px;margin:-.1rem 0 .25rem">${o.hint}</div>` : ''}${o.area ? `<textarea name="${k}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">` : `<input name="${k}" type="${o.type || 'text'}" ${o.type === 'number' ? 'min="0" max="120"' : ''} value="`}${o.area ? esc(T.settings[k] || '') + '</textarea>' : esc(T.settings[k] ?? '') + '">'}`;
  const sample = () => {
    const S = T.settings, d = new Date().toISOString().slice(0, 10);
    const inv = { inv_no: 'INV/0001', inv_date: d, due_date: d, status: 'sent', client_name: 'Sample Client Pvt. Ltd.', client_address: '12 Park Street\nKolkata 700016', subject: 'Professional fees for legal services',
      items: [{ description: 'Legal consultation\nAdvice, drafting and appearance as required.', qty: 1, rate_paise: 1500000 }, { description: 'Documentation charges', qty: 2, rate_paise: 250000 }], total_paise: 2000000, paid_paise: 0, payments: [], notes: '' };
    return sheetFor(T, invoiceSheet(inv, S, T));
  };
  view(`<h1>Document design</h1><p class="mute">This letter pad is used for every invoice, receipt and letter your firm prints.</p>
    <div class="tplgrid"><div class="card"><form id="tf">
      <h3>Firm documents</h3><p class="mute">Upload your firm's own letterhead, logo, signature and payment QR here, once. They are used on every invoice, receipt and letter. JPG or PNG; a transparent PNG is best for the logo and signature.</p>
      <div class="docs3">
        <div class="docbox"><h4>Letterhead</h4><div class="thumb">${T.has_letterhead ? `<img src="/api/template/letterhead?v=${T.v}" alt="">` : '<span>Not uploaded</span>'}</div><p class="mute" style="margin:0 0 .3rem;font-size:10px">Full A4 page, up to 4 MB.</p><input type="file" id="lhf" accept="image/jpeg,image/png"><div class="row"><button type="button" class="btn sm" id="lhm" style="${T.has_letterhead ? '' : 'display:none'}">Match colours &amp; margins</button><button type="button" class="btn sm ghost" id="lhd" style="${T.has_letterhead ? '' : 'display:none'}">Remove</button></div></div>
        <div class="docbox"><h4>Logo</h4><div class="thumb">${T.has_logo ? `<img src="/api/template/logo?v=${T.lv}" alt="">` : '<span>Not uploaded</span>'}</div><p class="mute" style="margin:0 0 .3rem;font-size:10px">Shown in the portal and on a text header.</p><input type="file" id="lgf" accept="image/jpeg,image/png"><div class="row"><button type="button" class="btn sm ghost" id="lgd" style="${T.has_logo ? '' : 'display:none'}">Remove</button></div></div>
        <div class="docbox"><h4>Signature</h4><div class="thumb">${T.has_signature ? `<img src="/api/template/signature?v=${T.sv}" alt="">` : '<span>Not uploaded</span>'}</div><p class="mute" style="margin:0 0 .3rem;font-size:10px">Prints above "Authorised Signatory".</p><input type="file" id="sgf" accept="image/jpeg,image/png"><div class="row"><button type="button" class="btn sm ghost" id="sgd" style="${T.has_signature ? '' : 'display:none'}">Remove</button></div></div>
        <div class="docbox"><h4>Payment QR</h4><div class="thumb">${T.has_qr ? `<img src="/api/template/qr?v=${T.qv}" alt="">` : '<span>Not uploaded</span>'}</div><p class="mute" style="margin:0 0 .3rem;font-size:10px">UPI / bank QR. Prints beside the bank details.</p><input type="file" id="qrf" accept="image/jpeg,image/png"><div class="row"><button type="button" class="btn sm ghost" id="qrd" style="${T.has_qr ? '' : 'display:none'}">Remove</button></div></div>
      </div>
      <p class="mute">After a letterhead upload the portal reads it and sets the colours and the header/footer space so the invoice matches it.</p>
      <h3>Header (used when there is no image)</h3>${F('header_name', 'Firm name')}${F('tagline', 'Tagline')}${F('address', 'Address', { area: 1 })}${F('phone', 'Phone')}${F('email', 'Email')}${F('website', 'Website')}
      <h3>Colours &amp; font</h3><div class="row"><div><label>Main</label><input name="primary" type="color" value="${T.settings.primary}"></div><div><label>Accent</label><input name="accent" type="color" value="${T.settings.accent}"></div><div><label>Title</label><input name="title_color" type="color" value="${T.settings.title_color}"></div></div>
      <label>Font</label><select name="font"><option value="sans" ${T.settings.font === 'sans' ? 'selected' : ''}>Modern (sans-serif)</option><option value="serif" ${T.settings.font === 'serif' ? 'selected' : ''}>Classic (serif)</option></select>
      <h3>Page &amp; margins</h3><label>Paper size</label><select name="page_size">${[['a4', 'A4 (210 × 297 mm)'], ['legal', 'Legal (216 × 356 mm)'], ['letter', 'Letter (216 × 279 mm)']].map(([v, l]) => `<option value="${v}" ${T.settings.page_size === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <p class="mute">Top and bottom are the space kept clear for the letterhead's header and footer. They apply on every page of a long document. Margins are in millimetres.</p>
      <div class="row"><div>${F('top_mm', 'Top / header', { type: 'number' })}</div><div>${F('bottom_mm', 'Bottom / footer', { type: 'number' })}</div></div><div class="row"><div>${F('left_mm', 'Left', { type: 'number' })}</div><div>${F('right_mm', 'Right', { type: 'number' })}</div></div>
      <label class="chk"><input type="checkbox" name="inv_hide_footer" value="1" ${T.settings.inv_hide_footer ? 'checked' : ''}> Hide the address line at the bottom of invoices <span class="mute">(letter pad stays as it is for letters)</span></label>
      <div class="row" style="margin-top:.4rem"><button type="button" class="btn sm ghost" id="mstd">Standard A4 (25 mm all round)</button></div>
      <h3>Titles &amp; signatory</h3>${F('invoice_title', 'Invoice title')}${F('receipt_title', 'Receipt title')}${F('signatory_name', 'Signatory name')}${F('signatory_title', 'Signatory designation')}
      <h3>Payment details (printed on invoices)</h3><p class="mute">Up to four items printed to the left of the QR code, each with a heading and its description (for example Bank Details, UPI, PAN, GST). Leave an item blank to skip it.</p>${[1, 2, 3, 4].map((n) => { const leg = n === 1 ? T.settings.payment_details : n === 2 ? T.settings.pan : ''; return `<div class="payslot"><b>Item ${n}</b>${F('pay' + n + '_title', 'Heading', { ph: n === 1 ? 'Bank Details' : n === 2 ? 'PAN' : 'e.g. UPI' })}${F('pay' + n + '_text', 'Description (one item per line)', { area: 1, rows: n === 1 ? 5 : 2, ph: n === 1 ? 'A/c Name: Your Firm Name\nA/c No.: 000000000000\nBank: Bank name\nIFSC: ABCD0000000 (Branch name, City)' : '' })}</div>`; }).join('')}${F('qr_caption', 'Text under the QR code', { hint: 'Leave blank to print the QR without any text.', ph: 'Scan to pay' })}${F('invoice_footer', 'Invoice footer note', { area: 1 })}
      <h3>Terms &amp; conditions</h3>${F('invoice_terms', 'Terms & conditions (one per line)', { area: 1 })}
      <p class="err" hidden></p><div style="margin-top:1rem"><button class="btn gold" style="width:100%">Save design</button></div></form></div>
      <div class="tplprev" id="pv"></div></div>`);
  const form = $('#tf'), pv = $('#pv');
  const read = () => { const o = { inv_hide_footer: '' }; new FormData(form).forEach((v, k) => { if (k !== 'file') o[k] = ['top_mm', 'bottom_mm', 'left_mm', 'right_mm'].includes(k) ? Number(v) : v; }); return o; };
  const paint = () => { T = { ...T, settings: { ...T.settings, ...read() } }; pv.innerHTML = sample(); const sh = $('.sheet', pv); const z = Math.min(1, (pv.clientWidth - 16) / sh.offsetWidth); sh.style.zoom = z > 0 ? z : 1; };
  form.addEventListener('input', paint); paint();
  $('#mstd').onclick = () => { form.elements.page_size.value = 'a4'; ['top_mm', 'bottom_mm', 'left_mm', 'right_mm'].forEach((k) => (form.elements[k].value = 25)); paint(); };
  form.onsubmit = async (e) => {
    e.preventDefault(); const err = $('.err', form); err.hidden = true;
    try { await PUT('/api/template', read()); T = await getTpl(true); paint(); toast('Design saved'); } catch (ex) { err.hidden = false; err.textContent = ex.message; }
  };
  const readImg = (f) => new Promise((ok, no) => { const fr = new FileReader(); fr.onerror = no; fr.onload = () => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = fr.result; }; fr.readAsDataURL(f); });
  // read the letterhead: find the header/footer depth and the dominant dark + bright colours
  const matchLh = async (src) => {
    const im = typeof src === 'string' ? await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }) : await readImg(src);
    const W = 200, H = Math.round(W * im.naturalHeight / im.naturalWidth), c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H); const px = g.getImageData(0, 0, W, H).data;
    const ink = (x, y) => { const k = (y * W + x) * 4; return px[k + 3] > 40 && (px[k] + px[k + 1] + px[k + 2]) / 3 < 225; };
    const rowInk = []; for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (ink(x, y)) n++; rowInk.push(n > 1); }
    const mm = (y) => Math.round(y * 297 / H), gap = Math.max(3, Math.round(H * 0.03));
    let top = 0; { let y = 0, blank = 0; for (; y < H * 0.45; y++) { if (rowInk[y]) { top = y; blank = 0; } else if (top && ++blank >= gap) break; } }
    let bot = H; { let y = H - 1, blank = 0; for (; y > H * 0.55; y--) { if (rowInk[y]) { bot = y; blank = 0; } else if (bot < H && ++blank >= gap) break; } }
    const bk = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4, r = px[k], gg = px[k + 1], b = px[k + 2];
      if (px[k + 3] < 40 || Math.max(r, gg, b) - Math.min(r, gg, b) < 45) continue;
      const key = (r >> 5) * 64 + (gg >> 5) * 8 + (b >> 5); const e = bk.get(key) || [0, 0, 0, 0]; e[0]++; e[1] += r; e[2] += gg; e[3] += b; bk.set(key, e); }
    const hex = (e) => '#' + [e[1], e[2], e[3]].map((v) => Math.round(v / e[0]).toString(16).padStart(2, '0')).join('');
    const rgb = (e) => [e[1] / e[0], e[2] / e[0], e[3] / e[0]], dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const list = [...bk.values()].filter((e) => e[0] > 25).sort((p, q) => q[0] - p[0]);
    let dk = null, br = null;
    if (list.length) { const dark = list.find((e) => (rgb(e)[0] + rgb(e)[1] + rgb(e)[2]) / 3 < 150) || list[0]; dk = hex(dark); const o = list.find((e) => dist(rgb(e), rgb(dark)) > 110); br = o ? hex(o) : null; }
    return { top_mm: Math.min(120, Math.max(10, mm(top) + 3)), bottom_mm: Math.min(80, Math.max(8, 297 - mm(bot) + 2)), primary: dk, accent: br };
  };
  const applyMatch = async (src) => { const m = await matchLh(src); const o = { top_mm: m.top_mm, bottom_mm: m.bottom_mm }; if (m.primary) o.primary = m.primary; if (m.accent) o.accent = m.accent; await PUT('/api/template', { ...T.settings, ...o }); };
  $('#lhf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f);
    try { await POST('/api/template/letterhead', fd); try { await applyMatch(f); } catch (x) { console.error('match failed', x); } T = await getTpl(true); toast('Letterhead uploaded - colours and margins matched'); go(); } catch (ex) { toast(ex.message, true); } };
  $('#lhm').onclick = async () => { try { await applyMatch('/api/template/letterhead?v=' + Date.now()); T = await getTpl(true); toast('Colours and margins matched to your letterhead'); go(); } catch (ex) { toast(ex.message, true); } };
  $('#lgf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { await POST('/api/template/logo', fd); T = await getTpl(true); toast('Logo uploaded'); go(); } catch (ex) { toast(ex.message, true); } };
  $('#lgd').onclick = async () => { if (!sure('Remove the logo?')) return; await DEL('/api/template/logo'); await getTpl(true); go(); };
  $('#sgf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { await POST('/api/template/signature', fd); T = await getTpl(true); toast('Signature uploaded'); go(); } catch (ex) { toast(ex.message, true); } };
  $('#qrf').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { await POST('/api/template/qr', fd); T = await getTpl(true); toast('QR code uploaded'); go(); } catch (ex) { toast(ex.message, true); } };
  $('#qrd').onclick = async () => { if (!sure('Remove the payment QR?')) return; await DEL('/api/template/qr'); await getTpl(true); go(); };
  $('#sgd').onclick = async () => { if (!sure('Remove the signature?')) return; await DEL('/api/template/signature'); await getTpl(true); go(); };
  $('#lhd').onclick = async () => { if (!sure('Remove the letterhead image?')) return; await DEL('/api/template/letterhead'); await getTpl(true); go(); };
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
      <p class="mute">Tell the client the call is being recorded. Status: <b>${esc(m.rec_status || 'not recorded yet')}</b>. Recordings are kept in the firm's files:  ${esc(m.name)} › Recordings.</p>
      ${m.can_record ? `<p id="rs" class="mute"></p><div class="row"><button class="btn" id="rb">● Start recording</button><button class="btn ghost" id="rx" hidden>■ Stop and save</button></div>
      <p class="mute">To record from here: join the call in another tab, press Start, choose that <b>Meet tab</b> and tick <b>Share tab audio</b>. Keep this page open until you press Stop. (If Google's own recording is on for your account, it is filed automatically after the call.)</p>` : '<p class="mute">Connect secure cloud storage (Files → Storage settings) to record.</p>'}
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
      mr.onstop = async () => { streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); try { ac.close(); } catch (e) {} await chain; say('Saving to secure cloud storage…'); try { const r = await POST(`/api/appointments/${id}/recording/finish`, { rid }); toast('Recording saved.'); go(); } catch (e) { say(e.message); $('#rx').hidden = false; $('#rx').textContent = 'Save again'; $('#rx').onclick = async () => { try { await POST(`/api/appointments/${id}/recording/finish`, { rid }); toast('Recording saved.'); go(); } catch (x) { say(x.message); } }; } };
      scr.getVideoTracks()[0].onended = () => { if (mr && mr.state !== 'inactive') mr.stop(); };
      mr.start(15000); rb.hidden = true; $('#rx').hidden = false; say('● Recording… keep this page open.');
      window.onbeforeunload = () => (mr && mr.state !== 'inactive' ? 'A recording is in progress.' : undefined);
    } catch (e) { toast(e.message || 'Recording was not started.', true); }
  };
  $('#rx').onclick = () => { if (mr && mr.state !== 'inactive') mr.stop(); $('#rx').hidden = true; };
}, { roles: ['admin', 'advocate'] });


/* ===== Case team: who is on this case, with what rights; health chips; quick actions (works as an installed app) ===== */
const LVL = { view: ['View only', 'Can read the case, nothing else'], work: ['Work', 'Can add hearings, notings, tasks and files'], full: ['Full', 'Everything, including editing details, fees and the team'] };
async function teamCard(id, m) {
  const host = $('#tcard'); if (!host) return;
  let T; try { T = await GET(`/api/matters/${id}/team`); } catch (e) { host.remove(); return; }
  const I = m.ident || {}, nd = I.next_date || (m.hearings.find((h) => h.next_date && h.next_date >= today()) || {}).next_date;
  const days = nd ? Math.round((new Date(nd) - new Date(today())) / 864e5) : null;
  const due = (m.invoices || []).filter((i) => !['paid', 'cancelled', 'draft'].includes(i.status)).length;
  const chips = [
    days === null ? '<span class="chip" style="background:#fdecec">No next date set</span>' : `<span class="chip" style="background:${days <= 2 ? '#fdecec' : '#eef3ea'}">${days < 0 ? 'Date passed ' + (-days) + 'd ago' : days === 0 ? 'Hearing TODAY' : 'Hearing in ' + days + ' day' + (days > 1 ? 's' : '')}</span>`,
    due ? `<span class="chip" style="background:#fff4d6">${due} fee bill${due > 1 ? 's' : ''} unpaid</span>` : '',
    m.documents.length ? '' : '<span class="chip" style="background:#fff4d6">No documents yet</span>',
    (m.tasks || []).filter((t) => t.status !== 'done').length ? `<span class="chip">${(m.tasks || []).filter((t) => t.status !== 'done').length} open task(s)</span>` : '',
    `<span class="chip" title="${esc(LVL[m.my_level || 'full'][1])}">My access: ${LVL[m.my_level || 'full'][0]}</span>`,
  ].join(' ');
  host.innerHTML = `<div class="row sp" style="gap:.6rem"><div class="row" style="gap:.4rem;flex-wrap:wrap">${chips}</div></div>
    <div class="row sp" style="margin-top:.6rem;gap:.6rem;flex-wrap:wrap"><div><b>Case team</b> ${T.members.length ? T.members.map((x) => `<span class="chip" title="${esc(LVL[x.level][1])}">${esc(x.name)} · ${LVL[x.level][0]}</span>`).join(' ') : '<span class="mute">Not assigned to anyone yet' + (T.restrict ? '' : ' — everyone in the office can see this case') + '</span>'}</div>
    ${T.can_manage ? '<button class="btn sm ghost" id="tm">Assign advocates</button>' : ''}</div>`;
  const tm = $('#tm'); if (tm) tm.onclick = () => {
    const cur = Object.fromEntries(T.members.map((x) => [x.user_id, x.level]));
    const rows = T.people.map((u) => `<div class="row sp" style="padding:.35rem 0;border-bottom:1px solid var(--line)"><span>${esc(u.name)} <span class="mute">(${esc(u.role)})</span></span><select data-tu="${u.id}" style="width:auto"><option value="">Not on case</option>${['view', 'work', 'full'].map((l) => `<option value="${l}" ${cur[u.id] === l ? 'selected' : ''}>${LVL[l][0]}</option>`).join('')}</select></div>`).join('');
    const d = document.createElement('div'); d.className = 'modal-bg'; d.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:99;display:flex;align-items:flex-end;justify-content:center';
    d.innerHTML = `<div class="card" style="max-width:520px;width:100%;max-height:85vh;overflow:auto;margin:0;border-radius:14px 14px 0 0"><h2>Assign advocates</h2><p class="mute" style="font-size:12px">View: read only · Work: add hearings, notings, tasks, files · Full: also edit details, fees and team.</p>${rows}<div class="row" style="justify-content:flex-end;margin-top:.8rem"><button class="btn ghost" id="tx">Cancel</button><button class="btn" id="ts">Save team</button></div></div>`;
    document.body.appendChild(d); $('#tx').onclick = () => d.remove();
    $('#ts').onclick = async () => { const members = [...d.querySelectorAll('[data-tu]')].filter((x) => x.value).map((x) => ({ user_id: +x.dataset.tu, level: x.value })); try { await PUT(`/api/matters/${id}/team`, { members }); d.remove(); toast('Team saved.'); go(); } catch (e) { toast(e.message, true); } };
  };
  // thumb-reach action bar for the installed app (phones only, via CSS)
  const bar = document.createElement('div'); bar.className = 'qbar noprint';
  const ph = (m.client_phone || '').replace(/\D/g, '');
  bar.innerHTML = `${ph ? `<a href="tel:+${ph.length === 10 ? '91' + ph : ph}">📞<span>Call</span></a><a target="_blank" rel="noopener" href="https://wa.me/${ph.length === 10 ? '91' + ph : ph}">💬<span>WhatsApp</span></a>` : ''}${m.my_level !== 'view' ? '<a href="javascript:void(0)" id="qh">📅<span>Hearing</span></a><a href="javascript:void(0)" id="qn">📝<span>Noting</span></a>' : ''}<a href="javascript:void(0)" id="qt">⬆<span>Top</span></a>`;
  document.body.appendChild(bar);
  const clean = () => { if (!location.hash.startsWith('#/matter/')) { bar.remove(); window.removeEventListener('hashchange', clean); } }; window.addEventListener('hashchange', clean);
  const fire = (sel) => { const b = $(sel); if (b) b.click(); };
  const qh = $('#qh'); if (qh) qh.onclick = () => fire('#ah'); const qn = $('#qn'); if (qn) qn.onclick = () => { const b = $('#an'); if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); b.click(); } };
  $('#qt').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ===== File movement: hand a case to another person, returnable by a date ===== */
const fdt = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
async function moveCard(id, m) {
  const host = $('#mvcard'); if (!host) return;
  let V; try { V = await GET(`/api/matters/${id}/moves`); } catch (e) { host.remove(); return; }
  const o = V.open;
  host.innerHTML = `<div class="row sp" style="gap:.6rem;flex-wrap:wrap"><div><b>File is with</b> <span class="chip">${esc(V.holder ? V.holder.name : 'nobody yet')}</span>
    ${o ? `<span class="chip" style="background:${o.overdue ? '#fdecec' : '#eef3ea'}">${o.overdue ? 'OVERDUE — was due ' : 'Return by '}${esc(fdt(o.due_at))}</span> <span class="mute">moved by ${esc(o.from_name || '')}${o.note ? ' — ' + esc(o.note) : ''}</span>` : ''}</div>
    <div class="row" style="gap:.4rem">${o ? '<button class="btn sm gold" id="mr">Return file</button>' : ''}${V.can_move ? '<button class="btn sm" id="mm">Move file</button>' : ''}</div></div>
    ${V.history.length > 1 || (V.history.length === 1 && !o) ? `<details style="margin-top:.4rem"><summary class="mute" style="cursor:pointer">Movement history (${V.history.length})</summary><ul class="list">${V.history.map((h) => `<li><span>${esc(h.from_name || '—')} → <b>${esc(h.to_name)}</b><div class="mute">${esc(fdt(h.created_at + 'Z'))} · due ${esc(fdt(h.due_at))}${h.note ? ' · ' + esc(h.note) : ''}</div></span><span class="chip">${esc(h.status)}</span></li>`).join('')}</ul></details>` : ''}`;
  const mr = $('#mr'); if (mr) mr.onclick = async () => { try { await POST(`/api/moves/${o.id}/return`); toast('File returned.'); go(); } catch (e) { toast(e.message, true); } };
  const mm = $('#mm'); if (mm) mm.onclick = () => ask('Move this file to…', [{ name: 'to_user', label: 'Move to', type: 'select', options: V.people.map((u) => [u.id, `${u.name} (${u.role})`]), required: true },
    { name: 'due_date', label: `Return by (leave blank = ${V.cfg.hours} hours from now)`, type: 'date' }, { name: 'note', label: 'Instruction / note' }], 'Move file',
    async (v) => { await POST(`/api/matters/${id}/move`, { ...v, to_user: +v.to_user }); toast('File moved. They have been notified.'); go(); });
}
route(/^\/moves$/, async (_, p) => {
  const vw = p.get('view') || 'mine', D = await GET('/api/moves?view=' + vw);
  view(`<h1>File movement</h1><p class="mute">Files are handed from one person to another and must come back by the return date (${D.cfg.hours} hours if none is set). If a file is not returned, the person is reminded on WhatsApp and e-mail, again after ${D.cfg.remind_days} days, and after ${D.cfg.final_days} more day(s) it goes back to the firm for fresh allocation.</p>
    <div class="tabs">${[['mine', 'With me'], ['out', 'Given by me'], ['hist', 'My history'], ...(can('admin') ? [['all', 'All files']] : [])].map(([k, l]) => `<a href="#/moves?view=${k}" class="${vw === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="card">${D.rows.length ? `<ul class="list">${D.rows.map((r) => `<li><span><a href="#/matter/${r.matter_id}"><b>${esc(r.file_no)}</b> ${esc(r.title)}</a><div class="mute">${esc(r.client_name)} · ${esc(r.from_name || '—')} → <b>${esc(r.to_name)}</b> · return by ${esc(fdt(r.due_at))}${r.note ? ' · ' + esc(r.note) : ''}</div></span>
      <span class="row" style="gap:.4rem">${r.overdue ? '<span class="chip" style="background:#fdecec">Overdue</span>' : `<span class="chip">${esc(r.status)}</span>`}${r.status === 'open' ? `<button class="btn sm gold" data-ret="${r.id}">Return</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="mute">Nothing here.</p>'}</div>
    ${can('admin') ? `<div class="card"><b>Firm rules</b><div class="row" style="gap:.6rem;flex-wrap:wrap;margin-top:.4rem"><label>Default return (hours) <input type="number" id="mh" value="${D.cfg.hours}" style="width:80px"></label><label>Reminder after (days) <input type="number" id="md" value="${D.cfg.remind_days}" style="width:70px"></label><label>Take back after (more days) <input type="number" id="mf" value="${D.cfg.final_days}" style="width:70px"></label><button class="btn sm" id="ms">Save</button></div></div>` : ''}`);
  $$('[data-ret]').forEach((b) => (b.onclick = async () => { try { await POST(`/api/moves/${b.dataset.ret}/return`); toast('File returned.'); go(); } catch (e) { toast(e.message, true); } }));
  const ms = $('#ms'); if (ms) ms.onclick = async () => { try { await PUT('/api/moves/settings', { hours: +$('#mh').value, remind_days: +$('#md').value, final_days: +$('#mf').value }); toast('Saved.'); } catch (e) { toast(e.message, true); } };
}, { office: true });


route(/^\/deleted-cases$/, async () => {
  const rows = await GET('/api/matters-deleted');
  view(`<div class="row sp"><h1>Recycle Bin</h1><a class="btn ghost sm" href="#/matters">← Cases</a></div><p class="mute">A deleted case is never really removed: it waits here, hidden everywhere, and you can restore it at any time exactly as it was. Its papers stay safe in the client's folder and Google Drive. Only the portal owner can delete a case for good.</p>
    <div class="card">${rows.length ? `<ul class="list">${rows.map((m) => `<li><span><b>${esc(m.file_no)}</b> ${esc(m.title)}<div class="mute">${esc(m.client_name)} · deleted ${esc(dt(m.deleted_at))}${m.deleted_by_name ? ' by ' + esc(m.deleted_by_name) : ''}</div></span><span class="row" style="gap:.4rem"><button class="btn sm gold" data-rs="${m.id}">Restore</button></span></li>`).join('')}</ul>` : '<p class="mute">The Recycle Bin is empty.</p>'}</div>`);
  $$('[data-rs]').forEach((b) => (b.onclick = async () => { try { await POST(`/api/matters/${b.dataset.rs}/restore`); toast('Case restored.'); go(); } catch (e) { toast(e.message, true); } }));
}, { office: true });


/* ===== Case diary: step-by-step record, court dates included; add by hand, drag or use arrows to place anywhere ===== */
async function diaryCard(id, m, cli) {
  const host = $('#dcard'); if (!host) return;
  let D, filter = 'all', editId = null, dragId = null;
  const GL = { office: 'Office', papers: 'Papers', court: 'Court', note: 'Own note' }, GC = { office: 'var(--surface-1);color:var(--text-secondary)', papers: 'var(--bg-success);color:var(--text-success)', court: 'var(--bg-accent);color:var(--text-accent)', note: 'var(--bg-warning);color:var(--text-warning)' };
  const load = async () => { try { D = await GET(`/api/matters/${id}/diary`); } catch (e) { host.remove(); return; } draw(); };
  const saveOrder = async (ids) => { try { await PUT(`/api/matters/${id}/diary/order`, { ids }); } catch (e) { toast(e.message, true); } await load(); };
  const draw = () => {
    const rows = D.entries.filter((e) => filter === 'all' || e.group === filter), ed = D.can_edit, ids = D.entries.map((e) => e.id);
    host.innerHTML = `<div class="row sp" style="gap:.5rem;flex-wrap:wrap"><h2 style="margin:0">Case diary</h2><div class="row" style="gap:.3rem;flex-wrap:wrap">
      ${['all', 'office', 'papers', 'court'].filter((g) => !cli || g === 'all').map((g) => `<button class="btn sm ${filter === g ? '' : 'ghost'}" data-df="${g}">${g === 'all' ? 'All' : GL[g]}</button>`).join('')}
      ${ed ? `<button class="btn sm ghost" id="dsort">Sort by date</button>` : ''}${ed && m.ident ? '<button class="btn sm ghost" id="dsync">Sync from eCourts</button>' : ''}</div></div>
    ${D.stage === null ? '' : `<div style="display:flex;gap:4px;margin:.7rem 0;overflow-x:auto">${D.stages.map((x, k) => `<span class="chip" style="flex:0 0 auto;${k < D.stage ? 'background:var(--bg-success)' : k === D.stage ? 'background:var(--bg-accent);font-weight:600' : 'opacity:.6'}">${esc(x)}</span>`).join('')}</div>`}
    <div id="dlist" style="margin-top:.6rem">${rows.length ? rows.map((e) => `<div class="drow" ${ed ? 'draggable="true"' : ''} data-id="${e.id}" style="display:flex;gap:.5rem;align-items:flex-start;padding:.55rem;border:1px solid var(--line);border-radius:8px;margin-bottom:.4rem;background:#fff">
        ${ed ? '<span class="dh" title="Drag to move" style="cursor:grab;color:#999;font-size:14px;line-height:1">⋮⋮</span>' : ''}<div style="min-width:84px;font-size:12px" class="mute">${esc(dt(e.date))}</div>
        <div style="flex:1;min-width:0"><div><span style="display:inline-block;font-size:10px;padding:1px 7px;border-radius:6px;margin-right:6px;background:${GC[e.group]}">${esc(GL[e.group])}</span><b>${esc(e.title || e.label)}</b>${e.source === 'court' ? ' <span class="mute" style="font-size:10px">· eCourts</span>' : ''}${e.edited ? ' <span class="mute" style="font-size:10px">· edited</span>' : ''}${!cli && e.visible ? ' <span class="mute" style="font-size:10px">· shown to client</span>' : ''}</div>
          ${e.note ? `<div style="font-size:12px;margin-top:.15rem;white-space:pre-wrap">${esc(e.note)}</div>` : ''}
          ${e.clock ? `<div style="margin-top:.2rem"><span class="chip" style="background:${e.clock.closed ? 'var(--bg-success)' : e.clock.over ? '#fdecec' : '#fff4d6'}">${e.clock.closed ? 'Reply received' : e.clock.over ? 'Reply period over (' + esc(dt(e.clock.due)) + ')' : 'Reply due ' + esc(dt(e.clock.due)) + ' · ' + e.clock.left + ' day(s) left'}</span></div>` : ''}
          ${e.link ? `<div style="font-size:12px"><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.link)}</a></div>` : ''}${e.by ? `<div class="mute" style="font-size:10px">by ${esc(e.by)}</div>` : ''}</div>
        ${ed ? `<div style="display:flex;gap:2px"><button class="btn sm ghost" data-a="up" data-id="${e.id}" aria-label="Move up">▲</button><button class="btn sm ghost" data-a="dn" data-id="${e.id}" aria-label="Move down">▼</button><button class="btn sm ghost" data-a="ed" data-id="${e.id}">Edit</button><button class="btn sm ghost" data-a="rm" data-id="${e.id}" aria-label="Delete">✕</button></div>` : ''}</div>`).join('') : '<p class="mute">No entries yet.</p>'}</div>
    ${ed ? `<div id="dform" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.5rem;margin-top:.7rem;align-items:end;padding-top:.7rem;border-top:1px solid var(--line)">
      <label>Date<input type="date" id="dd" value="${today()}"></label>
      <label>Type<select id="dk">${['office', 'papers', 'court', 'note'].map((g) => `<optgroup label="${GL[g]}">${D.kinds.filter((k) => k.group === g && !['no_reply'].includes(k.kind)).map((k) => `<option value="${k.kind}">${esc(k.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label id="drw" hidden>Reply period (days)<input type="number" id="dr" value="${D.reply_days}" min="1" max="180"></label>
      <label style="grid-column:1/-1">Narration<textarea id="dn" rows="2" placeholder="Write the entry, as in a diary"></textarea></label>
      <label>Link (optional)<input id="dl" placeholder="draft, receipt or order link"></label>
      <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="dv"> Show to client</label>
      <span class="row" style="gap:.4rem"><button class="btn" id="dadd">${editId ? 'Save changes' : 'Add entry'}</button>${editId ? '<button class="btn ghost" id="dcx">Cancel</button>' : ''}</span></div>` : ''}`;
    $$('[data-df]').forEach((b) => (b.onclick = () => { filter = b.dataset.df; draw(); }));
    const rw = () => { const k = $('#dk'); if (k && $('#drw')) $('#drw').hidden = k.value !== 'notice_sent' || !!editId; }; if ($('#dk')) { $('#dk').onchange = rw; rw(); }
    if ($('#dsort')) $('#dsort').onclick = async () => { await POST(`/api/matters/${id}/diary/sort`); toast('Sorted by date.'); load(); };
    if ($('#dsync')) $('#dsync').onclick = async (x) => { x.target.disabled = true; try { await POST(`/api/matters/${id}/ecourt/sync`, {}); toast('Court data updated.'); } catch (e) { toast(e.message, true); } load(); };
    $$('#dlist [data-a]').forEach((b) => (b.onclick = async () => {
      const eid = +b.dataset.id, k = ids.indexOf(eid), a = b.dataset.a;
      if (a === 'up' && k > 0) { [ids[k - 1], ids[k]] = [ids[k], ids[k - 1]]; return saveOrder(ids); }
      if (a === 'dn' && k < ids.length - 1) { [ids[k + 1], ids[k]] = [ids[k], ids[k + 1]]; return saveOrder(ids); }
      if (a === 'rm') { if (!sure('Remove this entry? The old version is kept in the audit trail.')) return; try { await DEL('/api/diary/' + eid); toast('Removed.'); } catch (e) { toast(e.message, true); } return load(); }
      if (a === 'ed') { const e = D.entries.find((x) => x.id === eid); editId = eid; draw(); $('#dd').value = e.date; $('#dn').value = e.note || ''; $('#dl').value = e.link || ''; $('#dv').checked = e.visible; if (e.source === 'manual') $('#dk').value = e.kind; else { $('#dd').disabled = true; $('#dk').disabled = true; } $('#dform').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }));
    $$('.drow[draggable]').forEach((r) => { r.ondragstart = () => { dragId = +r.dataset.id; r.style.opacity = '.4'; }; r.ondragend = () => { r.style.opacity = ''; }; r.ondragover = (ev) => { ev.preventDefault(); r.style.borderColor = 'var(--navy)'; }; r.ondragleave = () => { r.style.borderColor = ''; };
      r.ondrop = (ev) => { ev.preventDefault(); const to = +r.dataset.id; if (!dragId || dragId === to) return; const from = ids.indexOf(dragId); ids.splice(from, 1); ids.splice(ids.indexOf(to), 0, dragId); saveOrder(ids); }; });
    if ($('#dadd')) $('#dadd').onclick = async () => {
      const body = { date: $('#dd').value, kind: $('#dk').value, note: $('#dn').value.trim(), link: $('#dl').value.trim(), visible: $('#dv').checked, reply_days: +$('#dr').value };
      if (!body.date || !body.note) return toast('Enter the date and the narration.', true);
      try { if (editId) await PUT('/api/diary/' + editId, body); else await POST(`/api/matters/${id}/diary`, body); toast(editId ? 'Saved.' : 'Entry added.'); editId = null; await load(); } catch (e) { toast(e.message, true); }
    };
    if ($('#dcx')) $('#dcx').onclick = () => { editId = null; draw(); };
  };
  load();
}


/* ===== Activity log (firm administrator): who did what and when, with Word / PDF ===== */
route(/^\/activity$/, async (_, p) => {
  const f = { from: p.get('from') || '', to: p.get('to') || '', user: p.get('user') || '', kind: p.get('kind') || '', q: p.get('q') || '' };
  const D = await GET('/api/activity?' + qs({ ...f, limit: 1500 }));
  view(`<div class="row sp"><h1>Activity log</h1><span class="row" style="gap:.4rem" id="alx"><button class="btn sm ghost" data-ax="docx">Word</button><button class="btn sm ghost" data-ax="pdf">PDF</button></span></div>
    <p class="mute">Every sign-in, sign-out, entry, change and deletion by everyone in your firm, with date and time (Indian time). It cannot be edited or deleted.</p>
    <div class="card"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem;align-items:end">
      <label>From<input type="date" id="af" value="${esc(f.from)}"></label><label>To<input type="date" id="at" value="${esc(f.to)}"></label>
      <label>Person<select id="au"><option value="">Everyone</option>${D.users.map((u) => `<option value="${u.id}" ${String(u.id) === f.user ? 'selected' : ''}>${esc(u.name)} (${esc(u.role)})</option>`).join('')}</select></label>
      <label>Show<select id="ak">${[['', 'Everything'], ['signin', 'Sign-ins and sign-outs'], ['changes', 'Entries and changes']].map(([v, l]) => `<option value="${v}" ${v === f.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Search<input id="aq" value="${esc(f.q)}" placeholder="name or action"></label><button class="btn" id="ago">Show</button></div></div>
    ${D.summary.length ? `<div class="card"><h2>Who was in</h2><div class="tw"><table><tr><th>Person</th><th>Role</th><th>Sign-ins</th><th>Last sign-in</th><th>Last sign-out</th><th>Entries / changes</th></tr>${D.summary.map((x) => `<tr><td>${esc(x.user)}</td><td>${esc(x.role)}</td><td>${x.signins}</td><td>${esc(x.first_in)}</td><td>${esc(x.last_out)}</td><td>${x.actions}</td></tr>`).join('')}</table></div></div>` : ''}
    <div class="card"><h2>${D.rows.length} record(s)</h2>${D.rows.length ? `<div class="tw"><table><tr><th>When</th><th>Person</th><th>Role</th><th>What</th><th>Detail</th><th>IP</th></tr>${D.rows.map((r) => `<tr><td style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.user)}</td><td>${esc(r.role)}</td><td>${esc(r.what)}</td><td>${esc(r.detail)}</td><td class="mute">${esc(r.ip)}</td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing in this period.</p>'}</div>`);
  $('#ago').onclick = () => { location.hash = '#/activity?' + qs({ from: $('#af').value, to: $('#at').value, user: $('#au').value, kind: $('#ak').value, q: $('#aq').value }); };
  $$('[data-ax]').forEach((b) => (b.onclick = () => dlTable(b.dataset.ax, 'Activity log', `${f.from || 'start'} to ${f.to || 'today'}${f.q ? ' · ' + f.q : ''}`, [{ h: 'When', w: 1.5 }, { h: 'Person', w: 1.3 }, { h: 'Role', w: .8 }, { h: 'What', w: 2 }, { h: 'Detail', w: 1.6 }, { h: 'IP', w: 1 }], D.rows.map((r) => [r.at, r.user, r.role, r.what, r.detail, r.ip]), 'activity')));
}, { admin: true });
