'use strict';
/* ===== Super Admin: Build Journal — how the portal is built, what it costs, how to run it; downloadable as Word / PDF ===== */
route(/^\/journal$/, async (_, p) => {
  const J = await GET('/api/platform/journal'), L = J.live;
  const tab = ['overview', 'built', 'costs', 'operate', 'security', 'history', 'notes'].includes(p.get('tab')) ? p.get('tab') : 'overview';
  const T = [['overview', 'Overview'], ['built', 'How it is built'], ['costs', 'Running costs'], ['operate', 'How to operate'], ['security', 'Security'], ['history', 'Versions'], ['notes', 'My notes']];
  const paras = (a) => a.map(([h, b]) => `<div class="card"><h3>${esc(h)}</h3><p style="white-space:pre-wrap">${esc(b)}</p></div>`).join('');
  let body = '';
  if (tab === 'overview') body = `<div class="card"><h2>What this portal is</h2>${String(J.purpose).split(/\n+/).map((x) => `<p>${esc(x)}</p>`).join("")}</div>
    <div class="card"><h2>Position today</h2><div class="tw"><table>
      <tr><td>Version</td><td><b>${esc(J.version)}</b> (${esc(J.built)})</td></tr><tr><td>Firms</td><td>${L.firms}</td></tr><tr><td>Office users</td><td>${L.users}</td></tr><tr><td>Clients / cases</td><td>${L.clients} / ${L.matters}</td></tr>
      <tr><td>Claude calls this month</td><td>${L.ai_calls}</td></tr><tr><td>Estimated running cost this month</td><td><b>${inr(L.total_month_paise)}</b> (fixed ${inr(L.fixed_month_paise)} + Claude ${inr(L.ai_cost_paise)} + court data ${inr(L.ecourts_cost_paise)})</td></tr></table></div></div>
    <div class="card"><h2>House rules for every build</h2><ol>${J.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div>`;
  if (tab === 'built') body = `<div class="card"><h2>Technology</h2><div class="tw"><table>${J.stack.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>What is used where</h2><div class="tw"><table><tr><th>Module</th><th>Files</th><th>Outside service</th><th>Set up at</th><th>Cost driver</th><th>Notes</th></tr>${J.modules.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div></div>`;
  if (tab === 'costs') body = `<div class="card"><div class="row sp"><h2>Cost register</h2><button class="btn sm" id="ca">Add item</button></div><p class="mute">Fixed items repeat; usage items are noted for your reference. Claude and court-data usage are calculated live from the portal's own meters and shown above.</p>
    <div class="tw"><table><tr><th>Item</th><th>Type</th><th class="n">Amount</th><th>Cycle</th><th class="n">Per month</th><th>Notes</th><th></th></tr>${J.cost.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.kind === 'fixed' ? 'fixed' : 'usage'}</td><td class="n">${inr(r.amount_paise)}</td><td>${esc(r.cycle)}</td><td class="n">${r.kind === 'fixed' ? inr(r.per_month_paise) : '—'}</td><td>${esc(r.notes || '')}</td><td><button class="btn sm ghost" data-ce="${r.id}">Edit</button> <button class="btn sm ghost" data-cd="${r.id}">Delete</button></td></tr>`).join('')}</table></div>
    <p><b>This month:</b> fixed ${inr(L.fixed_month_paise)} · Claude ${inr(L.ai_cost_paise)} (estimate) · court data ${inr(L.ecourts_cost_paise)} (estimate) · <b>total ${inr(L.total_month_paise)}</b></p></div>`;
  if (tab === 'operate') body = paras(J.operate);
  if (tab === 'security') body = paras(J.security);
  if (tab === 'history') body = `<div class="card"><h2>Release history</h2><div class="tw"><table>${J.releases.map(([v, t]) => `<tr><td><b>${esc(v)}</b></td><td>${esc(t)}</td></tr>`).join('')}</table></div></div>`;
  if (tab === 'notes') body = `<div class="card"><div class="row sp"><h2>Owner's notes</h2><button class="btn sm" id="na">Add a note</button></div><p class="mute">Write down anything you decide or change — it goes into the downloadable journal with its date.</p>
    ${J.notes.length ? J.notes.map((n) => `<div class="card"><div class="row sp"><b>${esc(n.title)}</b><span class="mute">${esc(n.created_at.slice(0, 10))} <button class="btn sm ghost" data-nd="${n.id}">Delete</button></span></div><p style="white-space:pre-wrap">${esc(n.body)}</p></div>`).join('') : '<p class="mute">No notes yet.</p>'}</div>`;
  view(`<div class="row sp"><h1>Build Journal</h1><div class="row"><a class="btn" href="/api/platform/journal/download/docx">Download Word</a><a class="btn ghost" href="/api/platform/journal/download/pdf">Download PDF</a></div></div>
    <p class="mute">Confidential. A complete record of what the portal is, how it is built, what it costs and how to run it. Updated with every release.</p>
    <div class="tabs">${T.map(([k, l]) => `<a href="#/journal?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${body}`);
  const cost = (r) => ask(r ? 'Edit item' : 'Add running-cost item', [{ name: 'name', label: 'Item', required: true, value: r && r.name }, { name: 'kind', label: 'Type', type: 'select', value: r ? r.kind : 'fixed', options: [['fixed', 'Fixed (repeats)'], ['variable', 'Usage (varies)']] }, { name: 'amount', label: 'Amount (₹)', type: 'number', value: r ? r.amount_paise / 100 : '' }, { name: 'cycle', label: 'Cycle', type: 'select', value: r ? r.cycle : 'monthly', options: [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']] }, { name: 'notes', label: 'Notes', value: r && r.notes }], 'Save', async (v) => { await POST('/api/platform/journal/cost', { ...v, id: r && r.id }); go(); });
  if ($('#ca')) $('#ca').onclick = () => cost();
  $$('[data-ce]').forEach((b) => (b.onclick = () => cost(J.cost.find((x) => x.id == b.dataset.ce))));
  $$('[data-cd]').forEach((b) => (b.onclick = async () => { if (sure('Delete this item?')) { await DEL('/api/platform/journal/cost/' + b.dataset.cd); go(); } }));
  if ($('#na')) $('#na').onclick = () => ask('New note', [{ name: 'title', label: 'Title', required: true }, { name: 'body', label: 'Note', type: 'textarea' }], 'Save', async (v) => { await POST('/api/platform/journal/notes', v); go(); }, true);
  $$('[data-nd]').forEach((b) => (b.onclick = async () => { if (sure('Delete this note?')) { await DEL('/api/platform/journal/notes/' + b.dataset.nd); go(); } }));
});


/* ===== Activity log (Super Admin): every firm and the platform ===== */
route(/^\/activity$/, async (_, p) => {
  const f = { firm: p.get('firm') || '', from: p.get('from') || '', to: p.get('to') || '', user: p.get('user') || '', kind: p.get('kind') || '', q: p.get('q') || '' };
  const D = await GET('/api/platform/activity?' + qs({ ...f, limit: 1500 }));
  const cols = [{ h: 'When', w: 1.5 }, { h: 'Firm', w: 1.2 }, { h: 'Person', w: 1.3 }, { h: 'Role', w: .8 }, { h: 'What', w: 2 }, { h: 'Detail', w: 1.5 }, { h: 'IP', w: 1 }], body = () => D.rows.map((r) => [r.at, r.firm, r.user, r.role, r.what, r.detail, r.ip]);
  view(`<div class="row sp"><h1>Activity log</h1><span class="row" style="gap:.4rem"><button class="btn sm ghost" data-ax="docx">Word</button><button class="btn sm ghost" data-ax="pdf">PDF</button></span></div>
    <p class="mute">What every law firm and the platform are doing: sign-ins, sign-outs, entries, changes and deletions, with date and time (Indian time). Read-only.</p>
    <div class="card"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem;align-items:end">
      <label>Law firm<select id="afm"><option value="">All firms and platform</option>${D.firms.map((x) => `<option value="${x.id}" ${String(x.id) === f.firm ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label>From<input type="date" id="af" value="${esc(f.from)}"></label><label>To<input type="date" id="at" value="${esc(f.to)}"></label>
      ${D.users.length ? `<label>Person<select id="au"><option value="">Everyone</option>${D.users.map((u) => `<option value="${u.id}" ${String(u.id) === f.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
      <label>Show<select id="ak">${[['', 'Everything'], ['signin', 'Sign-ins and sign-outs'], ['changes', 'Entries and changes']].map(([v, l]) => `<option value="${v}" ${v === f.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Search<input id="aq" value="${esc(f.q)}"></label><button class="btn" id="ago">Show</button></div></div>
    ${D.summary.length ? `<div class="card"><h2>Who was in</h2><div class="tw"><table><tr><th>Person</th><th>Firm</th><th>Role</th><th>Sign-ins</th><th>Last sign-in</th><th>Last sign-out</th><th>Entries / changes</th></tr>${D.summary.map((x) => `<tr><td>${esc(x.user)}</td><td>${esc(x.firm)}</td><td>${esc(x.role)}</td><td>${x.signins}</td><td>${esc(x.first_in)}</td><td>${esc(x.last_out)}</td><td>${x.actions}</td></tr>`).join('')}</table></div></div>` : ''}
    <div class="card"><h2>${D.rows.length} record(s)</h2>${D.rows.length ? `<div class="tw"><table><tr><th>When</th><th>Firm</th><th>Person</th><th>Role</th><th>What</th><th>Detail</th><th>IP</th></tr>${D.rows.map((r) => `<tr><td style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.firm)}</td><td>${esc(r.user)}</td><td>${esc(r.role)}</td><td>${esc(r.what)}</td><td>${esc(r.detail)}</td><td class="mute">${esc(r.ip)}</td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing in this period.</p>'}</div>`);
  $('#ago').onclick = () => { location.hash = '#/activity?' + qs({ firm: $('#afm').value, from: $('#af').value, to: $('#at').value, user: $('#au') ? $('#au').value : '', kind: $('#ak').value, q: $('#aq').value }); };
  $$('[data-ax]').forEach((b) => (b.onclick = async () => { const fm = b.dataset.ax; try {
    const r = await fetch('/api/export/' + fm, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kcportal' }, body: JSON.stringify({ title: 'Activity log - all firms', subtitle: `${f.from || 'start'} to ${f.to || 'today'}`, cols, rows: body(), restricted: 'activity' }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not make the file.');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'Activity log.' + fm; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { toast(e.message, true); } }));
});
