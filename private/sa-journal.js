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
