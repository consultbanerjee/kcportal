'use strict';
/* ===== Super Admin: firms, plans and modules, Claude switch, token meter, subscription billing, platform settings ===== */
const saTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : String(n || 0));
const SAT = [['firms', 'Firms'], ['usage', 'AI usage and cost'], ['billing', 'Billing'], ['settings', 'Platform settings']];

route(/^\/firms$/, async (_, p) => {
  const tab = SAT.some((t) => t[0] === p.get('tab')) ? p.get('tab') : 'firms';
  const head = `<h1>Platform</h1><div class="tabs">${SAT.map(([k, l]) => `<a href="#/firms?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (tab === 'firms') return saFirms(head);
  if (tab === 'usage') return saUsage(head, p.get('m'));
  if (tab === 'billing') return saBilling(head);
  return saSettings(head);
});

async function saFirms(head) {
  const [O, firms] = await Promise.all([GET('/api/platform/overview'), GET('/api/platform/firms')]);
  const by = Object.fromEntries(O.firms.map((f) => [f.id, f]));
  const link = (pth) => show('Invitation link', `<p>Send this private link to the administrator. It works once and expires in 7 days.</p><input readonly value="${esc(location.origin + '/' + pth)}">`);
  view(`${head}<div class="row sp"><p class="mute" style="margin:0">Each firm has its own administrator, team, clients and Google Drive. You never see a firm's client data. Claude is currently <b>${O.claude_all ? 'ON' : 'OFF'}</b> for the platform.</p><button class="btn" id="nf">Add firm</button></div>
    ${firms.map((f) => { const o = by[f.id] || {}, u = o.usage || {}; return `<div class="card"><div class="row sp"><h2>${esc(f.name)} ${f.active ? '' : pill('disabled', 'bad')} ${o.exempt ? pill('owner firm') : ''} ${o.due_n ? pill('dues ' + inr(o.due_paise), 'bad') : ''}</h2><span class="row"><button class="btn sm" data-pl="${f.id}">Plan and modules</button><button class="btn sm ghost" data-tg="${f.id}" data-a="${f.active ? 0 : 1}">${f.active ? 'Disable' : 'Enable'}</button></span></div>
      <p class="mute">Plan <b>${esc(O.plans[o.plan] || o.plan)}</b> · fee ${inr(o.fee_paise)}/month · ${f.team} team · ${f.clients} clients · Drive ${o.drive ? 'connected' : 'not connected'}<br>
      Claude: ${o.claude ? pill('on', 'ok') : pill('off', 'bad')} · this month ${u.calls || 0} calls, ${saTok((u.in_tok || 0) + (u.out_tok || 0))} tokens, cost ${inr(u.cost_paise)}${o.ai_bill ? ', to bill ' + inr(u.bill_paise) : ' (not billed)'}<br>
      Off for this firm: ${o.off && o.off.length ? o.off.map((m) => esc((O.modules.find((x) => x[0] === m) || [m, m])[1])).join(', ') : 'nothing — all modules on'}</p>
      <p class="mute">Booking link: <code>${esc(location.origin)}/#/book?firm=${esc(f.slug)}</code></p>
      <ul class="list">${f.admins.map((a) => `<li><span><b>${esc(a.name)}</b> <span class="mute">${esc(a.email)}</span> ${a.joined ? '' : pill('invited')}</span><span class="row"><button class="btn sm ghost" data-inv="${a.id}">Invite link</button></span></li>`).join('')}</ul></div>`; }).join('')}`);
  $('#nf').onclick = () => ask('Add firm', [{ name: 'name', label: 'Firm name', required: true }, { name: 'prefix', label: 'Number prefix (e.g. KC)', required: true }, { name: 'slug', label: 'Short web name (optional)' }, { name: 'admin_name', label: 'Administrator name', required: true }, { name: 'admin_email', label: 'Administrator email', type: 'email', required: true }], 'Create', async (v) => { const r = await POST('/api/platform/firms', v); setTimeout(() => link(r.invite_path), 50); go(); });
  $$('[data-inv]').forEach((b) => (b.onclick = async () => link((await POST(`/api/platform/admins/${b.dataset.inv}/invite`)).invite_path)));
  $$('[data-tg]').forEach((b) => (b.onclick = async () => { if (b.dataset.a === '0' && !sure('Disable this firm? Nobody in it can sign in until you enable it again.')) return; await PATCH('/api/platform/firms/' + b.dataset.tg, { active: b.dataset.a === '1' }); go(); }));
  $$('[data-pl]').forEach((b) => (b.onclick = () => {
    const o = by[b.dataset.pl], on = new Set(o.off);
    ask('Plan and modules — ' + o.name, [
      { name: 'plan', label: 'Plan', type: 'select', value: o.plan, options: Object.entries(O.plans) },
      { name: 'apply_preset', label: 'Reset the module ticks below to this plan\'s standard set', type: 'checkbox' },
      { name: 'fee', label: 'Monthly fee (₹)', type: 'number', step: '0.01', value: o.fee_paise / 100 },
      { name: 'claude', label: 'Claude (AI) allowed for this firm', type: 'checkbox', value: o.claude },
      { name: 'markup', label: 'AI cost markup % added when billing this firm', type: 'number', step: '1', value: o.markup },
      { name: 'ai_bill', label: 'Include AI usage in this firm\'s monthly invoice', type: 'checkbox', value: o.ai_bill },
      ...O.modules.map(([k, l]) => ({ name: 'm_' + k, label: 'Include: ' + l, type: 'checkbox', value: !on.has(k) })),
      { name: 'net', label: 'Invoice due in (days)', type: 'number', value: o.net },
      { name: 'autosuspend', label: 'Suspend this firm automatically if an invoice stays unpaid', type: 'checkbox', value: o.autosuspend },
      { name: 'grace', label: 'Grace days after the due date before suspending', type: 'number', value: o.grace },
      { name: 'exempt', label: 'Owner firm — never suspend', type: 'checkbox', value: o.exempt },
      { name: 'powered', label: 'Small footer line for this firm (optional)', value: o.powered, ph: 'e.g. Powered by …' },
    ], 'Save', async (v) => {
      const body = { plan: v.plan, apply_preset: v.apply_preset, fee: v.fee || 0, claude: v.claude, markup: v.markup || 0, ai_bill: v.ai_bill, net: v.net || 10, autosuspend: v.autosuspend, grace: v.grace || 15, exempt: v.exempt, powered: v.powered };
      if (!v.apply_preset) body.off = O.modules.filter(([k]) => !v['m_' + k]).map(([k]) => k);
      await PUT(`/api/platform/firms/${o.id}/plan`, body); go();
    }, true);
  }));
}

async function saUsage(head, m) {
  const D = await GET('/api/platform/usage' + (m ? '?month=' + m : ''));
  const ms = [...new Set([D.month, ...D.months])];
  view(`${head}<div class="card"><div class="row sp"><h2>Claude usage by firm</h2><select id="mo">${ms.map((x) => `<option ${x === D.month ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <p class="mute">Tokens are counted on every Claude call. Cost is <b>tentative</b>: tokens × the rates in Platform settings (now $${D.rates.rin} in / $${D.rates.rout} out per million tokens, ₹${D.rates.fx} per $). Edit the rates there to match Anthropic's current price list.</p>
    <div class="tw"><table><tr><th>Firm</th><th class="n">Calls</th><th class="n">Input tokens</th><th class="n">Output tokens</th><th class="n">Our cost</th><th class="n">To bill (with markup)</th></tr>
    ${D.firms.map((f) => `<tr><td>${esc(f.name)}<div class="mute">${f.by_feature.map((b) => esc(b.feature) + ' ' + b.calls).join(' · ')}</div></td><td class="n">${f.calls}</td><td class="n">${saTok(f.in_tok)}</td><td class="n">${saTok(f.out_tok)}</td><td class="n">${inr(f.cost_paise)}</td><td class="n">${inr(f.bill_paise)}</td></tr>`).join('')}
    <tr><td><b>Total</b></td><td></td><td></td><td></td><td class="n"><b>${inr(D.total_cost_paise)}</b></td><td class="n"><b>${inr(D.total_bill_paise)}</b></td></tr></table></div></div>`);
  $('#mo').onchange = (e) => { location.hash = '#/firms?tab=usage&m=' + e.target.value; };
}

async function saBilling(head) {
  const rows = await GET('/api/platform/billing'), O = await GET('/api/platform/overview');
  view(`${head}<div class="row sp" style="margin-bottom:.8rem"><span class="mute">Monthly invoices carry the plan fee plus AI usage (with the firm's markup). Generate last month's after the month ends.</span><span class="row"><button class="btn" id="gen">Generate last month</button><button class="btn ghost" id="man">Add a charge</button></span></div>
    <div class="card"><div class="tw"><table><tr><th>Firm</th><th>For</th><th class="n">Plan</th><th class="n">AI</th><th class="n">Total</th><th>Due</th><th>Status</th><th></th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.firm)}</td><td>${esc(r.kind === 'monthly' ? r.period : r.note)}</td><td class="n">${inr(r.plan_paise + r.other_paise)}</td><td class="n">${inr(r.ai_paise)}</td><td class="n">${inr(r.total_paise)}</td><td>${r.due_date ? dt(r.due_date) : ''}</td><td>${r.overdue ? pill('overdue', 'bad') : sp(r.status)}</td><td>${r.status === 'due' ? `<button class="btn sm" data-pd="${r.id}">Mark paid</button> <button class="btn sm ghost" data-cx="${r.id}">Cancel</button>` : r.paid_on ? `<span class="mute">${dt(r.paid_on)} ${esc(r.paid_ref || '')}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="mute">No invoices yet.</td></tr>'}</table></div></div>
    <div class="card"><h2>Dues</h2><p class="mute">Firms with “suspend automatically” on are disabled once an invoice is unpaid beyond its grace days. The owner firm is never suspended. You can also run the check now.</p><button class="btn ghost" id="enf">Run dues check now</button></div>`);
  $('#gen').onclick = async () => { const r = await POST('/api/platform/billing/generate', {}); toast(`${r.created.length} invoice(s) created for ${r.period}`); go(); };
  $('#enf').onclick = async () => { const r = await POST('/api/platform/enforce', {}); toast(r.suspended.length ? 'Suspended: ' + r.suspended.join(', ') : 'No firm needed suspending'); go(); };
  $('#man').onclick = () => ask('Add a charge', [{ name: 'tenant_id', label: 'Firm', type: 'select', options: O.firms.map((f) => [f.id, f.name]), required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', step: '0.01', required: true }, { name: 'note', label: 'What for', required: true, ph: 'Setup and training' }, { name: 'due_date', label: 'Due date', type: 'date' }], 'Add', async (v) => { await POST('/api/platform/billing', v); go(); });
  $$('[data-pd]').forEach((b) => (b.onclick = () => ask('Mark as paid', [{ name: 'paid_on', label: 'Received on', type: 'date', value: new Date().toISOString().slice(0, 10) }, { name: 'ref', label: 'UPI / bank reference' }], 'Save', async (v) => { await POST(`/api/platform/billing/${b.dataset.pd}/paid`, v); go(); })));
  $$('[data-cx]').forEach((b) => (b.onclick = async () => { if (sure('Cancel this invoice?')) { await POST(`/api/platform/billing/${b.dataset.cx}/cancel`); go(); } }));
}

async function saSettings(head) {
  const O = await GET('/api/platform/overview');
  view(`${head}<div class="card"><h2>Claude (AI)</h2>
    <p class="mute">Claude stays connected through your own Anthropic account, so a firm needs no AI account of its own. Key: ${O.key_set ? 'saved in the portal' : O.key_env ? 'set on the server' : '<b>not set</b>'}.</p>
    <form id="sf" class="grid2">
      <label class="chk"><input type="checkbox" name="claude_all" ${O.claude_all ? 'checked' : ''}> Claude allowed on the whole platform (master switch)</label>
      <label class="chk"><input type="checkbox" name="auto_bill" ${O.auto_bill ? 'checked' : ''}> Create monthly invoices automatically on the 1st</label>
      <label>Platform Anthropic API key (leave empty to keep; type __clear__ to remove)</label><input name="platform_key" type="password" autocomplete="new-password" placeholder="sk-ant-…">
      <label>Input price, US$ per million tokens</label><input name="rate_in" type="number" step="0.01" value="${O.rates.in}">
      <label>Output price, US$ per million tokens</label><input name="rate_out" type="number" step="0.01" value="${O.rates.out}">
      <label>₹ per US$</label><input name="usd_inr" type="number" step="0.01" value="${O.rates.fx}">
      <label>Product name shown to firms (optional)</label><input name="product" value="${esc(O.product)}">
      <p class="mute">The price boxes are placeholders. Set them from Anthropic's current price list for the model you use; the meter then shows a close estimate of what each firm costs you.</p>
      <button class="btn">Save</button></form></div>`);
  $('#sf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target.elements;
    try { await PUT('/api/platform/settings', { claude_all: f.claude_all.checked, auto_bill: f.auto_bill.checked, platform_key: f.platform_key.value.trim(), rate_in: f.rate_in.value, rate_out: f.rate_out.value, usd_inr: f.usd_inr.value, product: f.product.value }); toast('Saved'); go(); }
    catch (ex) { toast(ex.message, true); }
  };
}

/* ===== a firm's Admin: plan, usage and onboarding ===== */
route(/^\/plan$/, async () => {
  const P = await GET('/api/my-plan'), mn = new Set(P.off);
  view(`<h1>Plan and usage</h1><div class="card"><p><b>${esc(P.plan)}</b> · fee ${inr(P.fee_paise)} per month</p>
    <ul class="list">${P.modules.map(([k, l]) => `<li><span>${esc(l)}</span>${mn.has(k) ? pill('not in plan', 'bad') : pill('included', 'ok')}</li>`).join('')}</ul>
    <p class="mute">AI (Claude) is <b>${P.claude ? 'on' : 'switched off by the platform'}</b>. This month (${esc(P.month)}): ${P.usage.calls} calls, ${saTok(P.usage.in_tok + P.usage.out_tok)} tokens${P.usage.bill_paise ? ', charge so far ' + inr(P.usage.bill_paise) : ''}.</p></div>
    <div class="card"><h2>Invoices from the portal provider</h2>${P.invoices.length ? `<div class="tw"><table><tr><th>For</th><th class="n">Amount</th><th>Due</th><th>Status</th></tr>${P.invoices.map((r) => `<tr><td>${esc(r.kind === 'monthly' ? r.period : r.note)}</td><td class="n">${inr(r.total_paise)}</td><td>${r.due_date ? dt(r.due_date) : ''}</td><td>${sp(r.status)}</td></tr>`).join('')}</table></div>` : '<p class="mute">No invoices.</p>'}</div>`);
}, { roles: ['admin'] });
