'use strict';
/* ===== Repository, consents, follow-ups, limitation calculator, home extras ===== */

/* ---- Repository ---- */
route(/^\/repository(?:\/([a-z0-9-]+))?$/, async ([sec], p) => {
  const st = await GET('/api/repository/status').catch(() => ({})), all = await GET('/api/repository'), want = REPO_MAP[sec], cats = want ? all.filter((c) => c.cat === want) : all, q = (p.get('q') || '').toLowerCase(), adm = can('admin'), edit = can('admin', 'advocate', 'staff');
  const match = (l) => !q || (l.title + ' ' + (l.note || '') + ' ' + l.url).toLowerCase().includes(q);
  view(`<div class="row sp"><h1>${esc(want || 'Repository')}</h1>${edit ? '<button class="btn" id="al">Add a link</button>' : ''}</div>
    <p class="mute">Official courts, tribunals, free libraries, news and government services in one place. Links open in a new tab. ${adm ? 'You can hide any standard link and add your own.' : ''}</p>
    <p class="mute noprint" style="margin:.2rem 0">Links are checked automatically every 7 days${st.last_run ? '. Last check: ' + dtm(st.last_run) + (st.down ? ' (' + st.down + ' may be down)' : ' (all reachable)') : '. First check runs shortly after the portal starts'}.${adm ? ' <button class="btn sm ghost" id="chk">Check now</button>' : ''}</p>
    <div class="row noprint" style="margin-bottom:.8rem"><input id="q" placeholder="Search the repository" value="${esc(p.get('q') || '')}" style="flex:1;min-width:180px"></div>
    ${cats.map((c) => { const ls = c.links.filter((l) => (adm || !l.hidden) && match(l)); return ls.length ? `<div class="card"><h2>${esc(c.cat)}</h2><ul class="list">${ls.map((l) => `<li><span style="${l.hidden ? 'opacity:.5' : ''}"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.title)}</b></a>${l.std ? '' : ' ' + pill('yours')}${l.down ? ' ' + pill('link may be down', 'bad') : ''}${l.moved ? ' ' + pill('address updated automatically', 'ok') : ''}${l.hidden ? ' ' + pill('hidden') : ''}<div class="mute">${esc(l.note || '')}</div></span>
      <span class="row">${l.std ? (adm ? `<button class="btn sm ghost" data-h="${esc(l.key)}" data-v="${l.hidden ? 0 : 1}">${l.hidden ? 'Show' : 'Hide'}</button>` : '') : (edit ? `<button class="btn sm ghost" data-rm="${l.id}">Remove</button>` : '')}</span></li>`).join('')}</ul></div>` : ''; }).join('') || '<div class="card mute">Nothing matches.</div>'}`);
  let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = '#/repository' + (sec ? '/' + sec : '') + (e.target.value ? '?q=' + encodeURIComponent(e.target.value) : ''); }, 300); });
  const ck = $('#chk'); if (ck) ck.onclick = async () => { const r = await POST('/api/repository/check', {}); toast(r.message); };
  const al = $('#al'); if (al) al.onclick = () => ask('Add a link', [{ name: 'cat', label: 'Category', required: true, list: all.map((c) => c.cat), value: cats[0] && cats[0].cat }, { name: 'title', label: 'Title', required: true }, { name: 'url', label: 'Web address', required: true, ph: 'https://' }, { name: 'note', label: 'Note (optional)' }], 'Add', async (v) => { await POST('/api/repository', v); go(); });
  $$('[data-h]').forEach((b) => (b.onclick = async () => { await POST('/api/repository/hide', { key: b.dataset.h, hidden: b.dataset.v === '1' }); go(); }));
  $$('[data-rm]').forEach((b) => (b.onclick = async () => { if (sure('Remove this link?')) { await DEL('/api/repository/' + b.dataset.rm); go(); } }));
}, { office: true });

/* ---- Consents (privacy) ---- */
route(/^\/consents$/, async () => {
  const D = await GET('/api/consents'), edit = can('admin', 'advocate', 'staff');
  view(`<div class="row sp"><h1>Client consents</h1>${edit ? '<button class="btn" id="ac">Record consent</button>' : ''}</div>
    <p class="mute">Keep a record of what each client agreed to: handling their papers, contacting them, greetings. If a client withdraws consent to WhatsApp or greetings, the portal stops those messages for that client. ${D.without ? `<b>${D.without}</b> client(s) have no consent on record.` : 'Every client has a consent on record.'}</p>
    ${can('admin') ? `<div class="card"><h2>Consent wording</h2><p class="mute">Your standard consent text. Show or send it to clients before you record their consent.</p><textarea id="cn" rows="5" placeholder="e.g. I agree that the firm may keep and use my personal data and case papers for providing legal services, and may contact me by phone, WhatsApp and email about my matters.">${esc(D.notice)}</textarea><div style="margin-top:.5rem"><button class="btn sm" id="sn">Save wording</button></div></div>` : ''}
    <div class="card"><div class="tw"><table><tr><th>Client</th><th>For</th><th>How</th><th>Given</th><th>Status</th><th></th></tr>${D.rows.map((r) => `<tr><td>${esc(r.client)}</td><td>${esc(r.purpose)}</td><td>${esc(r.mode)}</td><td>${dt(r.given_on)}</td><td>${r.withdrawn_on ? pill('withdrawn ' + dt(r.withdrawn_on), 'bad') : pill('active', 'ok')}</td><td>${!r.withdrawn_on && edit ? `<button class="btn sm ghost" data-w="${r.id}">Withdraw</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">No records yet.</td></tr>'}</table></div></div>`);
  const sn = $('#sn'); if (sn) sn.onclick = async () => { await PUT('/api/consents/notice', { notice: $('#cn').value }); toast('Saved'); };
  const ac = $('#ac'); if (ac) ac.onclick = async () => {
    const cl = await clientOpts();
    ask('Record consent', [{ name: 'client_id', label: 'Client', type: 'select', options: cl, required: true }, ...D.purposes.map((x, i) => ({ name: 'p' + i, label: x, type: 'checkbox', value: i === 0 })),
      { name: 'mode', label: 'How it was given', type: 'select', options: [['written', 'Signed paper'], ['verbal', 'Told verbally'], ['email', 'Email'], ['portal', 'On the portal']] }, { name: 'given_on', label: 'Date', type: 'date', value: new Date().toISOString().slice(0, 10) }, { name: 'note', label: 'Note (optional)' }],
    'Save', async (v) => { await POST('/api/consents', { client_id: v.client_id, purposes: D.purposes.filter((_, i) => v['p' + i]), mode: v.mode, given_on: v.given_on, note: v.note }); go(); });
  };
  $$('[data-w]').forEach((b) => (b.onclick = async () => { if (sure('Mark this consent as withdrawn?')) { await POST(`/api/consents/${b.dataset.w}/withdraw`); go(); } }));
}, { office: true });

/* ---- Follow-ups ---- */
route(/^\/followups$/, async () => {
  const D = await GET('/api/followups'), sec = (t, n, html) => `<div class="card"><h2>${t} <span class="mute">(${n})</span></h2>${n ? html : '<p class="mute">Nothing waiting.</p>'}</div>`;
  const stg = Object.fromEntries(D.stages.map((s) => [s.stage, s.n])), tot = D.stages.reduce((s, x) => s + x.n, 0);
  view(`<h1>Follow-ups</h1><p class="mute">Everything that is waiting for a call, a reply or a date. Work down this page each morning.</p>
    <div class="grid"><div class="stat"><b>${stg.new || 0}</b><span>New leads</span></div><div class="stat"><b>${tot ? Math.round(((stg.converted || 0) / tot) * 100) : 0}%</b><span>Leads converted</span></div><div class="stat"><b>${D.leads.filter((x) => x.overdue).length}</b><span>Overdue calls</span></div></div>
    ${sec('Calls to make', D.leads.length, `<ul class="list">${D.leads.map((x) => `<li><span><a href="#/lead/${x.id}"><b>${esc(x.name)}</b></a> ${x.overdue ? pill('overdue', 'bad') : ''}<div class="mute">${esc(x.why)} · ${dt(x.due)} · ${esc(x.phone || '')} ${esc((x.issue || '').slice(0, 80))}</div></span>${x.phone ? `<a class="btn sm ghost" href="https://wa.me/${String(x.phone).replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</li>`).join('')}</ul>`)}
    ${sec('Chat tickets open for over two days', D.tickets.length, `<ul class="list">${D.tickets.map((x) => `<li><span><a href="#/ticket/${x.id}">${esc(x.subject || x.name || 'Ticket')}</a><div class="mute">${esc(x.name || '')} ${esc(x.phone || '')}</div></span>${pill(x.priority)}</li>`).join('')}</ul>`)}
    ${sec('Open cases with no next date', D.nodate.length, `<ul class="list">${D.nodate.map((x) => `<li><span><a href="#/matter/${x.id}">${esc(x.title)}</a><div class="mute">${esc(x.file_no)} · ${esc(x.forum || '')}</div></span></li>`).join('')}</ul>`)}
    ${sec('Fees unpaid for over 30 days', D.dues.length, `<ul class="list">${D.dues.map((x) => `<li><span><a href="#/accounts/ledgers?kind=client&id=${x.id}">${esc(x.name)}</a><div class="mute">${esc(x.phone || '')}</div></span><b>${inr(x.due)}</b></li>`).join('')}</ul>`)}
    ${sec('Tasks due soon', D.tasks.length, `<ul class="list">${D.tasks.map((x) => `<li><span><a href="#/tasks">${esc(x.title)}</a></span><span>${dt(x.due_date)}</span></li>`).join('')}</ul>`)}`);
}, { office: true });

/* ---- Limitation calculator ---- */
const LIM = [
  ['Suits', [
    ['Price of goods sold and delivered (no fixed credit period)', 'Art. 14', 3, 'y', 'Date of delivery of the goods'],
    ['Money lent', 'Art. 19', 3, 'y', 'Date the loan is made'],
    ['Money payable for work done', 'Art. 24', 3, 'y', 'Date the work is done'],
    ['Specific performance of a contract', 'Art. 54', 3, 'y', 'Date fixed for performance, or if none, when the plaintiff has notice that performance is refused'],
    ['Compensation for breach of contract', 'Art. 55', 3, 'y', 'Date the contract is broken'],
    ['Declaration', 'Art. 58', 3, 'y', 'When the right to sue first accrues'],
    ['Cancel or set aside an instrument or decree', 'Art. 59', 3, 'y', 'When the facts entitling the plaintiff to cancellation first become known to him'],
    ['Redeem a mortgage / recover possession of mortgaged property', 'Art. 61', 30, 'y', 'When the right to redeem or recover possession accrues'],
    ['Enforce payment of money secured by mortgage or charge', 'Art. 62', 12, 'y', 'When the money sued for becomes due'],
    ['Possession of immovable property based on previous possession', 'Art. 64', 12, 'y', 'Date of dispossession'],
    ['Possession of immovable property based on title', 'Art. 65', 12, 'y', 'When the defendant\'s possession becomes adverse to the plaintiff'],
    ['Suit by or on behalf of the Government', 'Art. 112', 30, 'y', 'When the right to sue accrues'],
    ['Any suit with no period provided (residuary)', 'Art. 113', 3, 'y', 'When the right to sue accrues'],
    ['Execution of a decree or order', 'Art. 136', 12, 'y', 'When the decree or order becomes enforceable'],
    ['Any other application with no period provided', 'Art. 137', 3, 'y', 'When the right to apply accrues'],
  ]],
  ['Appeals and review (civil)', [
    ['Appeal to the High Court from a decree or order (including second appeal)', 'Art. 116(a)', 90, 'd', 'Date of the decree or order appealed from'],
    ['Appeal to a court other than the High Court (for example the District Judge)', 'Art. 116(b)', 30, 'd', 'Date of the decree or order appealed from'],
    ['Appeal from a High Court decree or order to a larger bench of the same Court', 'Art. 117', 30, 'd', 'Date of the decree or order'],
    ['Review of judgment (High Court or lower court)', 'Art. 124', 30, 'd', 'Date of the decree or order'],
    ['Special Leave Petition to the Supreme Court', 'SC Rules 2013', 90, 'd', 'Date of the judgment or order'],
    ['Review petition in the Supreme Court', 'SC Rules 2013', 30, 'd', 'Date of the judgment or order'],
  ]],
  ['Arbitration', [
    ['Application to set aside an award (section 34)', 'Arbitration Act s.34(3)', 3, 'm', 'Date the party received the award. A further 30 days may be allowed on sufficient cause, and no more'],
  ]],
  ['Consumer', [
    ['Consumer complaint', 'Consumer Protection Act 2019 s.69', 2, 'y', 'Date the cause of action arises'],
    ['Appeal to the State Commission', 'CPA 2019 s.41', 45, 'd', 'Date of the District Commission order'],
    ['Appeal to the National Commission (from the State Commission)', 'CPA 2019 s.51', 30, 'd', 'Date of the State Commission order'],
    ['Appeal to the Supreme Court (from the National Commission)', 'CPA 2019 s.67', 30, 'd', 'Date of the National Commission order'],
  ]],
  ['Criminal complaints', [
    ['Offence punishable with fine only', 'BNSS s.514 (CrPC s.468)', 6, 'm', 'Date of the offence (or knowledge, where the law allows)'],
    ['Offence punishable with imprisonment up to 1 year', 'BNSS s.514 (CrPC s.468)', 1, 'y', 'Date of the offence (or knowledge, where the law allows)'],
    ['Offence punishable with imprisonment over 1 year and up to 3 years', 'BNSS s.514 (CrPC s.468)', 3, 'y', 'Date of the offence (or knowledge, where the law allows)'],
  ]],
  ['Tax, tribunals and information', [
    ['Appeal to the Commissioner (Appeals) — Income Tax', 'IT Act s.249(2)', 30, 'd', 'Service of the notice of demand or date of the order'],
    ['Appeal to the ITAT', 'IT Act s.253(3)', 60, 'd', 'Date the order is communicated'],
    ['GST appeal to the first appellate authority', 'CGST Act s.107(1)', 3, 'm', 'Date the decision or order is communicated'],
    ['Application to the Central Administrative Tribunal', 'Administrative Tribunals Act s.21', 1, 'y', 'Date of the final order'],
    ['RTI first appeal', 'RTI Act s.19(1)', 30, 'd', 'Date the decision is received'],
    ['RTI second appeal (Information Commission)', 'RTI Act s.19(3)', 90, 'd', 'Date the first appellate decision is received, or was due'],
  ]],
];
const limUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const limIso = (d) => d.toISOString().slice(0, 10);
const limAddM = (d, n) => { const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate(), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))); };
const limAddD = (d, n) => new Date(d.getTime() + n * 86400000);
const limFmt = (iso) => limUtc(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

route(/^\/limitation$/, async () => {
  const flat = []; LIM.forEach(([g, l]) => l.forEach((x) => flat.push([g, ...x])));
  view(`<h1>Limitation calculator</h1><p class="mute">Works out the last day to file. It is an aid: confirm against the Act and the facts of the case (acknowledgement, fresh starting points, sections 5, 12 to 15, 17 and 18, and any special law).</p>
    <div class="card"><label>What is being filed</label><select id="lt">${LIM.map(([g, l]) => `<optgroup label="${esc(g)}">${l.map((x) => `<option value="${flat.findIndex((f) => f[1] === x[0])}">${esc(x[0])}</option>`).join('')}</optgroup>`).join('')}<option value="nic">Cheque dishonour complaint (section 138, Negotiable Instruments Act)</option><option value="custom">Other — I will enter the period</option></select>
      <p class="mute" id="lh"></p>
      <div id="cu" hidden class="row" style="gap:.6rem"><div><label>Period</label><input id="cn" type="number" min="1" style="width:6rem" value="30"></div><div><label>Unit</label><select id="cun"><option value="d">days</option><option value="m">months</option><option value="y">years</option></select></div></div>
      <label id="dl">Date from which time runs</label><input type="date" id="d0">
      <label>Days to exclude (time spent getting certified copies, or any other time the law excludes) <span class="mute">section 12</span></label><input type="number" id="ex" min="0" value="0" style="width:8rem">
      <label>If the last day is a court holiday, move to the next working day under (section 4)</label><select id="cal"><option value="hc">Calcutta High Court calendar</option><option value="sc">Supreme Court calendar</option><option value="state">District courts and tribunals (West Bengal Government holidays)</option><option value="none">Do not adjust</option></select>
      <div class="row" style="margin-top:.8rem"><button class="btn gold" id="go">Calculate</button></div></div>
    <div id="out"></div>`);
  const sel = $('#lt'), upd = () => { const v = sel.value, cu = v === 'custom'; $('#cu').hidden = !cu; const x = flat[+v];
    $('#lh').textContent = v === 'nic' ? 'Enter the date the drawer RECEIVED your demand notice. The drawer has 15 days to pay; the complaint must then be filed within one month. (The notice itself must be sent within 30 days of the bank\'s return memo, and the cheque must be presented within its validity.)' : cu ? '' : `${x[2]} · ${x[3]} ${({ y: 'year(s)', m: 'month(s)', d: 'day(s)' })[x[4]]} · runs from: ${x[5]}`;
    $('#dl').textContent = v === 'nic' ? 'Date the drawer received the demand notice' : 'Date from which time runs'; };
  sel.onchange = upd; upd();
  $('#go').onclick = async () => {
    const d0 = $('#d0').value; if (!d0) return toast('Enter the date from which time runs.', true);
    const v = sel.value, ex = Math.max(0, parseInt($('#ex').value, 10) || 0); let base = limUtc(d0), desc, steps = [];
    if (v === 'nic') { const coa = limAddD(base, 15); base = limAddM(coa, 1); desc = 'Cheque dishonour complaint (section 138)'; steps.push(`Drawer's 15 days to pay end on ${limFmt(limIso(coa))}; the cause of action arises the next day.`, 'The complaint must be filed within one month of the cause of action arising.'); }
    else { let n, u; if (v === 'custom') { n = parseInt($('#cn').value, 10) || 0; u = $('#cun').value; desc = 'Custom period'; } else { const x = flat[+v]; n = x[3]; u = x[4]; desc = x[1]; if (!n) return; }
      base = u === 'y' ? limAddM(base, n * 12) : u === 'm' ? limAddM(base, n) : limAddD(base, n); steps.push('The day the time starts from is left out, so the last day is the same date after the period.'); }
    if (ex) { base = limAddD(base, ex); steps.push(`${ex} day(s) excluded.`); }
    let last = limIso(base), moved = '';
    const cal = $('#cal').value;
    if (cal !== 'none') {
      let hol = []; try { const D = await GET(`/api/calendar?from=${last}&to=${limIso(limAddD(base, 30))}`); hol = D.holidays.filter((h) => h.cat === cal); } catch (e) { toast('Holiday list not available; only Sundays are skipped.'); }
      const closed = (iso) => { const d = limUtc(iso); if (d.getUTCDay() === 0) return true; return hol.some((h) => iso >= h.date && iso <= (h.end_date || h.date)); };
      let cur = last, k = 0; while (closed(cur) && k++ < 40) cur = limIso(limAddD(limUtc(cur), 1));
      if (cur !== last) { moved = `The last day (${limFmt(last)}) is a closed day for this court, so the period runs to the next day the court is open (section 4).`; last = cur; }
    }
    const left = Math.round((limUtc(last) - limUtc(new Date().toISOString().slice(0, 10))) / 86400000);
    $('#out').innerHTML = `<div class="card"><h2>${esc(desc)}</h2><p style="font-size:14px"><b>Last day: ${esc(limFmt(last))}</b></p><p>${left >= 0 ? `<b>${left}</b> day(s) from today.` : `<b>${-left}</b> day(s) ago — the period appears to have expired. Consider condonation of delay if the law allows it.`}</p>
      ${moved ? `<p class="mute">${esc(moved)}</p>` : ''}<ul class="mute">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <div class="row noprint" style="margin-top:.6rem"><label>Remind me</label><input id="rd" type="number" min="0" value="7" style="width:5rem"><span class="mute">days before</span><button class="btn" id="mk">Create a task</button></div></div>`;
    $('#mk').onclick = async () => { const rd = Math.max(0, parseInt($('#rd').value, 10) || 0), due = limIso(limAddD(limUtc(last), -rd)); try { await POST('/api/tasks', { title: `LIMITATION: ${desc} — last day ${last.split('-').reverse().join('-')}`, due_date: due, priority: 'high', details: `Calculated from ${d0}. Verify before relying on it.` }); toast('Task created for ' + due.split('-').reverse().join('-')); } catch (e) { toast(e.message, true); } };
  };
}, { office: true });

/* ---- Home extras: onboarding for the Admin, this month's money ---- */
async function homeExtras() {
  const host = $('#view'); if (!host || !ME || isClient() || ME.role === 'superadmin') return;
  let html = '';
  if (ME.role === 'admin') { try { const o = await GET('/api/onboarding'); if (o.done < o.total) html += `<div class="card"><h2>Getting started <span class="mute">${o.done} of ${o.total}</span></h2><ul class="list">${o.steps.map((s) => `<li><span>${s.done ? '✔' : '○'} ${esc(s.label)}</span>${s.done ? '' : `<a class="btn sm ghost" href="${s.href}">Do this</a>`}</li>`).join('')}</ul></div>`; } catch (e) {} }
  if (ME.role === 'admin') { try { const c = await GET('/api/alerts/count'); if (c.open) html += `<div class="card"><div class="row sp"><span><b>${c.open}</b> fault${c.open === 1 ? '' : 's'} found by the weekly test${c.high ? ' — <b style="color:#d0021b">' + c.high + ' serious</b>' : ''}.</span><a class="btn sm ghost" href="#/alerts">Open Alerts</a></div></div>`; } catch (e) {} }
  try { const x = await GET('/api/home-extra'); html += !x.books ? '' : `<div class="card"><div class="row sp"><h2>This month — ${esc(x.books.month)}</h2><a class="btn sm ghost" href="#/accounts/reports">Reports</a></div><div class="grid"><div class="stat"><b>${inr(x.books.income_paise)}</b><span>Received</span></div><div class="stat"><b>${inr(x.books.expense_paise)}</b><span>Spent</span></div><div class="stat"><b>${inr(x.books.receivable_paise)}</b><span>Fees receivable</span></div></div>${x.books.checks ? `<p class="mute">${x.books.checks} item(s) in Accounts need a look.</p>` : ''}</div>`; } catch (e) {}
  if (html && $('#view') === host && !$('#hx')) host.insertAdjacentHTML('beforeend', `<div id="hx">${html}</div>`);
}
