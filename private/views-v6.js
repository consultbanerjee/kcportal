'use strict';
/* ===== v6.0: time & billing, conflict check, search, case pipeline, plan page with limits and data export ===== */

const hmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const todayIN = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

/* ---- Time & billing ---- */
route(/^\/time$/, async (_, p) => {
  const q = new URLSearchParams(); ['from', 'to', 'billed', 'user_id', 'matter_id'].forEach((k) => p.get(k) && q.set(k, p.get(k)));
  const [D, T] = await Promise.all([GET('/api/time?' + q.toString()), GET('/api/time/timer')]), run = T.running, adm = D.is_admin, canBill = can('admin', 'advocate');
  const money = (x) => inr(x), sel = (k, v) => (p.get(k) === v ? 'selected' : '');
  view(`<div class="row sp"><h1>Time</h1><span class="row"><button class="btn ghost sm" id="rep">Report</button>${adm ? '<button class="btn ghost sm" id="set">Rates</button>' : ''}<button class="btn" id="add">Add time</button></span></div>
    <div class="card"><h2>Timer</h2>${run ? `<p><b id="tick">${hmm(run.elapsed_min)}</b> running${run.file_no ? ' on ' + esc(run.file_no) + ' — ' + esc(run.title) : ''}${run.narration ? ' · ' + esc(run.narration) : ''}</p>
      <div class="row"><button class="btn" id="stop">Stop and save</button><button class="btn ghost" id="disc">Discard</button></div>` : `<p class="mute">Start the timer when you begin work; it keeps running if you close the page. Time is rounded up to ${D.round} minute${D.round > 1 ? 's' : ''}.</p><button class="btn" id="start">Start timer</button>`}</div>
    <div class="row noprint" style="gap:.5rem;margin:.5rem 0;flex-wrap:wrap"><label class="mute">From <input type="date" id="ff" value="${esc(p.get('from') || '')}"></label><label class="mute">To <input type="date" id="ft" value="${esc(p.get('to') || '')}"></label>
      <select id="fb" style="width:auto"><option value="">All</option><option value="unbilled" ${sel('billed', 'unbilled')}>Not yet billed</option><option value="billed" ${sel('billed', 'billed')}>Billed</option></select>
      ${adm ? `<select id="fu" style="width:auto"><option value="">Everyone</option>${D.users.map((u) => `<option value="${u.id}" ${sel('user_id', String(u.id))}>${esc(u.name)}</option>`).join('')}</select>` : ''}</div>
    <p class="mute">${D.entries.length} entries · ${esc(D.hours)} h · worth ${money(D.totals.value_paise)} · <b>not yet billed ${money(D.totals.unbilled_paise)}</b></p>
    <div class="card"><div class="tw"><table><tr>${canBill ? '<th></th>' : ''}<th>Date</th><th>Person</th><th>Case</th><th>Work</th><th class="n">Hours</th><th class="n">Rate/h</th><th class="n">Amount</th><th></th></tr>
      ${D.entries.map((e) => `<tr>${canBill ? `<td>${e.billable && !e.invoice_id ? `<input type="checkbox" data-b="${e.id}" data-c="${esc(e.client || '')}">` : ''}</td>` : ''}<td>${dt(e.date)}</td><td>${esc(e.user)}</td>
        <td>${e.matter_id ? `<a href="#/matter/${e.matter_id}">${esc(e.file_no)}</a><div class="mute">${esc(e.client || '')}</div>` : '—'}</td><td>${esc(e.narration || '')}${e.billable ? '' : ' ' + pill('not billable', 'warn')}</td>
        <td class="n">${esc(e.hours)}</td><td class="n">${e.rate_paise ? money(e.rate_paise) : '<span class="mute">not set</span>'}</td><td class="n">${e.billable ? money(e.amount_paise) : '—'}</td>
        <td>${e.invoice_id ? `<a href="#/invoice/${e.invoice_id}">${esc(e.invoice_no || 'invoice')}</a>` : `<button class="btn ghost sm" data-x="${e.id}">Remove</button>`}</td></tr>`).join('') || '<tr><td colspan="9" class="mute">No time recorded yet.</td></tr>'}</table></div>
      ${canBill && D.entries.some((e) => e.billable && !e.invoice_id) ? '<div class="row end noprint" style="margin-top:.8rem"><button class="btn" id="bill">Bill selected time</button></div>' : ''}</div>`);
  const refilter = () => { const n = new URLSearchParams(); [['from', '#ff'], ['to', '#ft'], ['billed', '#fb'], ['user_id', '#fu']].forEach(([k, s]) => { const el = $(s); if (el && el.value) n.set(k, el.value); }); location.hash = '#/time' + (n.toString() ? '?' + n : ''); };
  ['#ff', '#ft', '#fb', '#fu'].forEach((s) => { const el = $(s); if (el) el.onchange = refilter; });
  const mopts = async () => [['', '— no case —'], ...(await GET('/api/matters')).map((m) => [m.id, m.file_no + ' · ' + m.title])];
  const st = $('#start'); if (st) st.onclick = async () => ask('Start timer', [{ name: 'matter_id', label: 'Case', type: 'select', options: await mopts() }, { name: 'narration', label: 'Work (you can change it when you stop)' }], 'Start', async (v) => { await POST('/api/time/timer/start', v); go(); });
  const sp = $('#stop'); if (sp) sp.onclick = async () => ask('Stop and save', [{ name: 'narration', label: 'What was the work?', value: run.narration || '', required: true }], 'Save time', async (v) => { const r = await POST('/api/time/timer/stop', v); toast('Saved ' + hmm(r.minutes) + ' h.'); go(); });
  const ds = $('#disc'); if (ds) ds.onclick = async () => { if (sure('Discard the running timer?')) { await POST('/api/time/timer/discard'); go(); } };
  $('#add').onclick = async () => ask('Add time', [{ name: 'matter_id', label: 'Case', type: 'select', options: await mopts() }, { name: 'work_date', label: 'Date', type: 'date', value: todayIN(), required: true },
    { name: 'hours', label: 'Hours (e.g. 1.5)', type: 'number', step: '0.01', required: true }, { name: 'narration', label: 'Work done', required: true },
    { name: 'rate', label: `Rate per hour ₹ (blank = ${inr(D.default_rate_paise)})`, type: 'number', step: '1' }, { name: 'billable', label: 'Billable', type: 'checkbox', value: true }], 'Save', async (v) => { await POST('/api/time', v); go(); });
  $$('[data-x]').forEach((b) => (b.onclick = async () => { if (sure('Remove this time entry?')) { await DEL('/api/time/' + b.dataset.x); go(); } }));
  const bl = $('#bill'); if (bl) bl.onclick = async () => {
    const ids = $$('[data-b]:checked').map((c) => +c.dataset.b), cl = new Set($$('[data-b]:checked').map((c) => c.dataset.c));
    if (!ids.length) return toast('Tick the entries to bill.', true); if (cl.size > 1) return toast('Choose entries of one client at a time.', true);
    try { const r = await POST('/api/time/bill', { entry_ids: ids }); toast('Draft invoice ' + r.inv_no + ' made.'); location.hash = '#/invoice/' + r.invoice_id; } catch (e) { toast(e.message, true); }
  };
  $('#rep').onclick = async () => { const R = await GET('/api/time/report?' + q.toString()); const tb = (rows) => `<div class="tw"><table><tr><th>Name</th><th class="n">Hours</th><th class="n">Value</th><th class="n">Not billed</th></tr>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${hmm(r.minutes)}</td><td class="n">${inr(r.value_paise)}</td><td class="n">${inr(r.unbilled_paise)}</td></tr>`).join('') || '<tr><td colspan="4" class="mute">Nothing yet.</td></tr>'}</table></div>`; show('Time report', `<h4>By person</h4>${tb(R.by_user)}<h4>By case</h4>${tb(R.by_case)}`, true); };
  const se = $('#set'); if (se) se.onclick = async () => {
    const S = await GET('/api/time/settings');
    ask('Hourly rates', [{ name: 'rate', label: 'Firm rate per hour ₹ (used when a person has no rate of his own)', type: 'number', step: '1', value: S.rate_paise / 100 }, { name: 'round', label: 'Round timer up to (minutes)', type: 'number', value: S.round },
      ...S.users.map((u) => ({ name: 'u' + u.id, label: `${u.name} (${u.role}) — rate per hour ₹`, type: 'number', step: '1', value: u.rate_paise ? u.rate_paise / 100 : '' }))], 'Save', async (v) => {
      await PUT('/api/time/settings', { rate: v.rate || 0, round: v.round || 1, users: S.users.map((u) => ({ id: u.id, rate: v['u' + u.id] || 0 })) }); toast('Saved'); go(); });
  };
}, { roles: ['admin', 'advocate', 'staff'] });

/* ---- Conflict check ---- */
route(/^\/conflicts$/, async (_, p) => {
  const name = p.get('q') || '';
  view(`<h1>Conflict check</h1><p class="mute">Before you take a new client or case, check the name (and phone or email) against your clients, leads, opposite parties, case titles and register. Every check is noted.</p>
    <form class="card" id="cf"><div class="row" style="gap:.5rem;flex-wrap:wrap"><input name="q" placeholder="Name of the person or company" value="${esc(name)}" style="flex:2;min-width:200px"><input name="phone" placeholder="Phone (optional)" style="flex:1;min-width:130px"><input name="email" placeholder="Email (optional)" style="flex:1;min-width:150px"><button class="btn">Check</button></div></form>
    <div id="out"></div>${can('admin') ? '<div class="card"><h2>Recent checks</h2><div id="hist" class="mute">Loading…</div></div>' : ''}`);
  const out = $('#out'), run = async (v) => {
    const r = await GET('/api/conflicts?' + new URLSearchParams(v));
    out.innerHTML = `<div class="card">${r.clear ? '<p>' + pill('clear', 'ok') + ' Nothing found for this name.</p>' : `<p>${r.conflicts ? pill(r.conflicts + ' possible conflict' + (r.conflicts > 1 ? 's' : ''), 'bad') : pill('no conflict, but matches found', 'warn')}</p>
      <ul class="list">${r.hits.map((h) => `<li><span><b>${esc(h.title)}</b> ${h.severity === 'conflict' ? pill('conflict', 'bad') : ''}<div class="mute">${esc(h.detail)}</div></span>${h.link ? `<a class="btn ghost sm" href="${esc(h.link)}">Open</a>` : ''}</li>`).join('')}</ul>`}</div>`;
  };
  $('#cf').onsubmit = async (e) => { e.preventDefault(); const f = e.target, v = {}; ['q', 'phone', 'email'].forEach((k) => f[k].value.trim() && (v[k] = f[k].value.trim())); try { await run(v); } catch (x) { toast(x.message, true); } };
  if (name) run({ q: name }).catch((x) => toast(x.message, true));
  const h = $('#hist'); if (h) GET('/api/conflicts/history').then((rows) => { h.innerHTML = rows.length ? `<div class="tw"><table><tr><th>When</th><th>Who</th><th>Checked</th><th class="n">Matches</th></tr>${rows.map((r) => `<tr><td>${dtm(r.created_at)}</td><td>${esc(r.name || '')}</td><td>${esc(r.query)}</td><td class="n">${r.hits}</td></tr>`).join('')}</table></div>` : 'No checks yet.'; });
}, { roles: ['admin', 'advocate', 'staff', 'telecaller'] });

/* ---- Search ---- */
route(/^\/search$/, async (_, p) => {
  const q = (p.get('q') || '').trim();
  const R = q.length >= 2 ? await GET('/api/gsearch?q=' + encodeURIComponent(q)) : { groups: [] };
  view(`<h1>Search</h1><form class="row noprint" id="sf" style="margin-bottom:.8rem"><input name="q" value="${esc(q)}" placeholder="Search clients, cases, papers, invoices, tasks…" style="flex:1"><button class="btn">Search</button></form>
    ${q.length < 2 ? '<p class="mute">Type at least two letters.</p>' : R.groups.length ? R.groups.map((g) => `<div class="card"><h2>${esc(g.label)}</h2><ul class="list">${g.items.map((i) => `<li><span><b>${esc(i.title)}</b>${i.sub ? `<div class="mute">${esc(i.sub)}</div>` : ''}</span><a class="btn ghost sm" href="${esc(i.link)}">Open</a></li>`).join('')}</ul></div>`).join('') : `<div class="card"><p class="mute">Nothing found for “${esc(q)}”.</p></div>`}`);
  $('#sf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent(e.target.q.value.trim()); };
});

/* ---- Pipeline ---- */
route(/^\/pipeline$/, async (_, p) => {
  const me = p.get('who') === 'me', D = await GET('/api/pipeline' + (me ? '?who=me' : ''));
  view(`<div class="row sp"><h1>Case pipeline</h1><span class="tabs" style="margin:0;border:0"><a href="#/pipeline" class="${me ? '' : 'on'}">All open</a><a href="#/pipeline?who=me" class="${me ? 'on' : ''}">Mine</a></span></div>
    <p class="mute">${D.total} open cases by stage. The stage follows the case diary (consultation, notice, reply period, filing, listed in court, disposed).</p>
    <div style="display:flex;gap:.7rem;overflow-x:auto;align-items:flex-start;padding-bottom:.6rem">${D.columns.map((c) => `<div class="card" style="min-width:210px;max-width:240px;flex:0 0 auto"><h3 style="margin:0 0 .5rem">${esc(c.name)} <span class="mute">${c.cards.length}</span></h3>
      ${c.cards.map((k) => `<a href="#/matter/${k.id}" style="display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:6px;padding:.5rem;margin-bottom:.5rem"><b>${esc(k.file_no)}</b><div>${esc(k.title)}</div><div class="mute">${esc(k.client)}${k.advocate ? ' · ' + esc(k.advocate) : ''}</div>
        <div class="mute">${k.next_hearing ? 'Next: ' + dt(k.next_hearing) : 'No date set'}${k.open_tasks ? ' · ' + k.open_tasks + ' task' + (k.open_tasks > 1 ? 's' : '') : ''}</div></a>`).join('') || '<p class="mute">—</p>'}</div>`).join('')}</div>`);
}, { roles: ['admin', 'advocate', 'staff'] });

/* ---- Plan and usage (a firm's Admin) ---- */
route(/^\/plan$/, async () => {
  const [P, Lm] = await Promise.all([GET('/api/my-plan'), GET('/api/my-limits')]), mn = new Set(P.off), bar = (u, m) => (m ? `${u} of ${m}${u >= m ? ' ' + pill('limit reached', 'bad') : ''}` : `${u} (no limit)`);
  view(`<h1>Plan and usage</h1><div class="card"><p><b>${esc(P.plan)}</b> · fee ${inr(P.fee_paise)} per month</p>
    <p>Users (advocates and staff): <b>${bar(Lm.used.users, Lm.max_users)}</b><br>Clients: <b>${bar(Lm.used.clients, Lm.max_clients)}</b></p>
    <ul class="list">${P.modules.map(([k, l]) => `<li><span>${esc(l)}</span>${mn.has(k) ? pill('not in plan', 'bad') : pill('included', 'ok')}</li>`).join('')}</ul></div>
    <div class="card"><h2>Invoices from the portal provider</h2>${P.invoices.length ? `<div class="tw"><table><tr><th>For</th><th class="n">Amount</th><th>Due</th><th>Status</th></tr>${P.invoices.map((r) => `<tr><td>${esc(r.kind === 'monthly' ? r.period : r.note)}</td><td class="n">${inr(r.total_paise)}</td><td>${r.due_date ? dt(r.due_date) : ''}</td><td>${esc(r.status)}${r.paid_on ? ' ' + dt(r.paid_on) : ''}</td></tr>`).join('')}</table></div>` : '<p class="mute">No invoices yet.</p>'}</div>
    <div class="card"><h2>Your data is yours</h2><p class="mute">Download everything the portal holds for your firm (clients, cases, hearings, tasks, invoices, receipts, time, leads, papers list and case diary) as one Excel workbook. Your uploaded papers stay in your own storage.</p><a class="btn" href="/api/export/firm">Download all data (Excel)</a></div>`);
}, { roles: ['admin'] });

/* ---- search box in the left panel ---- */
document.addEventListener('submit', (e) => { if (e.target && e.target.id === 'gs') { e.preventDefault(); const v = e.target.q.value.trim(); if (v.length >= 2) location.hash = '#/search?q=' + encodeURIComponent(v); } });
