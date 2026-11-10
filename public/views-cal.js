'use strict';
/* ===== Calendar: holidays (Central / West Bengal / Calcutta High Court / Supreme Court), firm entries, birthdays, case dates ===== */
const CAL = {
  cats: { central: ['Central Govt', '#c0392b'], state: ['West Bengal Govt', '#1f8a4c'], hc: ['Calcutta High Court', '#6b3fa0'], sc: ['Supreme Court', '#1565c0'], firm: ['Firm / other', '#b26a00'] },
  bday: '#d6336c', cases: '#14213d',
};
const calPref = {
  get(k, d) { try { const v = localStorage.getItem('kc-cal-' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('kc-cal-' + k, v); } catch (e) {} },
};
const calIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const calDays = (a, b) => { const o = [], d = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00'); while (d <= e && o.length < 400) { o.push(calIso(d)); d.setDate(d.getDate() + 1); } return o; };
const calSat = (h) => h.cat === 'hc' && /Saturday$/.test(h.title);

route(/^\/calendar$/, async (_, p) => {
  const now = new Date(), m = /^\d{4}-\d{2}$/.test(p.get('m') || '') ? p.get('m') : calIso(now).slice(0, 7);
  const [Y, M] = m.split('-').map(Number), first = new Date(Y, M - 1, 1), start = new Date(Y, M - 1, 1 - first.getDay()), last = new Date(Y, M, 0);
  const end = new Date(Y, M - 1, last.getDate() + (6 - last.getDay())), from = calIso(start), to = calIso(end);
  const showB = calPref.get('bday', '0') === '1', showC = calPref.get('cases', '1') === '1', off = new Set(JSON.parse(calPref.get('off', '[]')));
  const D = await GET(`/api/calendar?from=${from}&to=${to}${showB ? '&bday=1' : ''}${showC ? '&cases=1' : ''}`);
  const edit = D.can_edit, admin = can('admin'), pro = can('admin', 'advocate', 'staff'), today = D.today;
  const items = {};   // date -> [{kind, color, label, long, id, ...}]
  const put = (d, it) => (items[d] = items[d] || []).push(it);
  for (const h of D.holidays) {
    if (off.has(h.cat)) continue;
    for (const d of calDays(h.date, h.end_date || h.date)) put(d, { k: 'h', cat: h.cat, color: CAL.cats[h.cat][1], label: h.title, h, sat: calSat(h), span: !!h.end_date });
  }
  for (const b of D.birthdays) put(b.date, { k: 'b', color: CAL.bday, label: '🎂 ' + b.name, b });
  for (const c of D.cases) put(c.d, { k: 'c', color: CAL.cases, label: c.title, c });
  const ORDER = { c: 0, b: 1, h: 2 };
  Object.values(items).forEach((a) => a.sort((x, y) => ORDER[x.k] - ORDER[y.k]));
  const tip = (x) => x.k === 'h' ? `${CAL.cats[x.cat][0]}: ${x.label}${x.h.provisional ? ' (provisional)' : ''}` : x.k === 'b' ? x.label : `${x.c.title} · ${x.c.forum || ''} ${x.c.case_no || ''}`;
  const prev = new Date(Y, M - 2, 1), next = new Date(Y, M, 1), pm = (d) => calIso(d).slice(0, 7);
  const dayCell = (d) => {
    const dd = new Date(d + 'T00:00:00'), inM = dd.getMonth() === M - 1, list = items[d] || [], sat = list.some((x) => x.sat), chips = list.filter((x) => !x.sat);
    return `<div class="cd${inM ? '' : ' out'}${d === today ? ' today' : ''}${dd.getDay() === 0 ? ' sun' : ''}${sat ? ' hcsat' : ''}" data-d="${d}" tabindex="0">
      <b>${dd.getDate()}</b>${chips.slice(0, 3).map((x) => `<i class="ch ${x.k === 'c' ? 'case' : ''}" style="${x.k === 'c' ? 'background:' + x.color : 'border-color:' + x.color + ';background:' + x.color + '1f'}" title="${esc(tip(x))}">${esc(x.label)}</i>`).join('')}${chips.length > 3 ? `<em>+${chips.length - 3} more</em>` : ''}</div>`;
  };
  const cells = calDays(from, to).map(dayCell).join('');
  const tdy = D.birthdays.filter((b) => b.date === today);
  const mFrom = calIso(first), mTo = calIso(last), agenda = Object.keys(items).filter((d) => d >= mFrom && d <= mTo).sort();
  const inAg = (d, x) => !(x.k === 'h' && x.span && d !== (x.h.date > mFrom ? x.h.date : mFrom));
  const row = (d, x) => `<li><span class="dot" style="background:${x.color}"></span><span class="ad">${dt(d).slice(0, 6)} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T00:00:00').getDay()]}</span><span class="at"><b>${esc(x.k === 'c' ? x.c.title : x.label)}</b>
      <span class="mute"> ${x.k === 'h' ? esc(CAL.cats[x.cat][0]) + (x.h.end_date ? ` · ${dt(x.h.date).slice(0, 6)} to ${dt(x.h.end_date).slice(0, 6)}` : '') + (x.h.provisional ? ' · provisional' : '') + (x.h.note ? ' · ' + esc(x.h.note) : '') : x.k === 'b' ? 'Birthday' + (x.b.age ? ` (${x.b.age})` : '') : (x.c.kind === 'heard' ? 'Heard' : 'Next date') + ` · ${esc(x.c.file_no)} · ${esc(x.c.client)}${x.c.forum ? ' · ' + esc(x.c.forum) : ''}${x.c.case_no ? ' ' + esc(x.c.case_no) : ''}${x.c.purpose ? ' · ' + esc(x.c.purpose) : ''}`}</span></span>
      <span class="aa">${x.k === 'c' ? `<a class="btn ghost sm" href="#/matter/${x.c.matter_id}">Open case</a>` : ''}${x.k === 'h' && edit ? `<button class="btn ghost sm" data-ed="${x.h.id}" data-o="${x.h.origin}">${x.h.origin === 'manual' ? 'Edit' : 'Remove'}</button>` : ''}</span></li>`;
  view(`<div class="row sp"><h1>Calendar</h1><div class="row">${edit ? '<button class="btn" id="add">Add holiday / event</button>' : ''}${pro ? '<button class="btn ghost" id="bd">Birthdays</button>' : ''}${admin ? '<button class="btn ghost" id="st">Settings</button>' : ''}</div></div>
    <div class="card calbar"><div class="row sp"><div class="row"><a class="btn ghost sm" href="#/calendar?m=${pm(prev)}">‹</a><h2 style="margin:0;min-width:9.5rem;text-align:center">${first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2><a class="btn ghost sm" href="#/calendar?m=${pm(next)}">›</a><a class="btn ghost sm" href="#/calendar">Today</a></div>
      <div class="row"><label class="sw"><input type="checkbox" id="tc" ${showC ? 'checked' : ''} ${pro ? '' : 'disabled'}><span></span> Case dates</label><label class="sw"><input type="checkbox" id="tb" ${showB ? 'checked' : ''} ${pro ? '' : 'disabled'}><span></span> Birthdays</label></div></div>
      <div class="leg">${Object.entries(CAL.cats).map(([k, [l, c]]) => `<label><input type="checkbox" data-f="${k}" ${off.has(k) ? '' : 'checked'}><i style="background:${c}"></i>${l}</label>`).join('')}<span><i style="background:${CAL.bday}"></i>Birthday</span><span><i style="background:${CAL.cases}"></i>Case date</span></div></div>
    ${tdy.length && showB ? `<div class="card"><h3>Today's birthdays</h3><ul class="list">${tdy.map((b) => `<li><span><b>${esc(b.name)}</b>${b.age ? ` <span class="mute">turns ${b.age}</span>` : ''} ${b.sent.length ? pill('greeted: ' + b.sent.join(' + '), 'ok') : ''}</span><span class="row">${pro ? `<button class="btn sm" data-g="${b.id}" data-c="email" ${b.email ? '' : 'disabled title="No e-mail"'}>E-mail</button><button class="btn sm" data-g="${b.id}" data-c="whatsapp" ${b.phone ? '' : 'disabled title="No mobile number"'}>WhatsApp</button>` : ''}</span></li>`).join('')}</ul></div>` : ''}
    <div class="card calgrid"><div class="cw">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<div>${x}</div>`).join('')}</div><div class="cg">${cells}</div></div>
    <div class="card"><h3>${first.toLocaleDateString('en-IN', { month: 'long' })} — dates</h3>${agenda.length ? `<ul class="list cal-ag">${agenda.map((d) => items[d].filter((x) => inAg(d, x)).map((x) => row(d, x)).join('')).join('')}</ul>` : '<p class="mute">Nothing listed this month.</p>'}</div>
    <p class="mute">Holidays follow the official lists of the Government of India (DoPT), Government of West Bengal, Calcutta High Court and Supreme Court. Entries marked <i>provisional</i> are fixed-date days; the official list for that year has not been notified yet and will replace them in the monthly update. Moon-dependent holidays (Eid, Muharram, Bakrid) can change by a day. ${D.settings.refreshed ? `Holiday list last updated ${dt(D.settings.refreshed)} (${esc(D.settings.source)}).` : ''}</p>`);

  const setP = (k, v) => { calPref.set(k, v); go(); };
  $('#tc').onchange = (e) => setP('cases', e.target.checked ? '1' : '0'); $('#tb').onchange = (e) => setP('bday', e.target.checked ? '1' : '0');
  $$('[data-f]').forEach((c) => (c.onchange = () => { const s = new Set(off); c.checked ? s.delete(c.dataset.f) : s.add(c.dataset.f); calPref.set('off', JSON.stringify([...s])); go(); }));
  const form = (h) => ask(h ? 'Edit entry' : 'Add holiday / event', [
    { name: 'title', label: 'Title', required: true, value: h && h.title }, { name: 'cat', label: 'Colour group', type: 'select', value: (h && h.cat) || 'firm', options: Object.entries(CAL.cats).map(([k, v]) => [k, v[0]]) },
    { name: 'date', label: 'Date', type: 'date', required: true, value: (h && h.date) || '' }, { name: 'end_date', label: 'Up to (optional, for several days)', type: 'date', value: (h && h.end_date) || '' }, { name: 'note', label: 'Note (optional)', value: h && h.note }],
    'Save', async (v) => { h ? await PUT('/api/calendar/holidays/' + h.id, v) : await POST('/api/calendar/holidays', v); toast('Saved.'); go(); });
  if ($('#add')) $('#add').onclick = () => form();
  $$('[data-ed]').forEach((b) => (b.onclick = async () => {
    const h = D.holidays.find((x) => x.id === +b.dataset.ed);
    if (b.dataset.o === 'manual') { const dlg = show('Entry', `<p><b>${esc(h.title)}</b></p><div class="row end"><button class="btn ghost" id="e1">Edit</button><button class="btn red" id="e2">Delete</button></div>`); $('#e1', dlg.el).onclick = () => { dlg.close(); form(h); }; $('#e2', dlg.el).onclick = async () => { dlg.close(); await DEL('/api/calendar/holidays/' + h.id); toast('Deleted.'); go(); }; }
    else if (sure(`Remove "${h.title}" from your calendar? It stays removed after the monthly update.`)) { await DEL('/api/calendar/holidays/' + h.id); toast('Removed.'); go(); }
  }));
  $$('.cd').forEach((c) => { const open = () => { const d = c.dataset.d, l = items[d] || []; const dlg = show(dt(d), l.length ? `<ul class="list cal-ag">${l.map((x) => row(d, x)).join('')}</ul>` : '<p class="mute">Nothing on this day.</p>' + (edit ? '<div class="row end"><button class="btn" id="ad">Add entry</button></div>' : '')); const a = $('#ad', dlg.el); if (a) a.onclick = () => { dlg.close(); ask('Add holiday / event', [{ name: 'title', label: 'Title', required: true }, { name: 'cat', label: 'Colour group', type: 'select', value: 'firm', options: Object.entries(CAL.cats).map(([k, v]) => [k, v[0]]) }, { name: 'date', label: 'Date', type: 'date', required: true, value: d }, { name: 'end_date', label: 'Up to (optional)', type: 'date' }], 'Save', async (v) => { await POST('/api/calendar/holidays', v); go(); }); }; $$('[data-ed]', dlg.el).forEach((b) => (b.onclick = () => { dlg.close(); const t = $$('[data-ed]').find((x) => x.dataset.ed === b.dataset.ed); t && t.click(); })); };
    c.onclick = open; c.onkeydown = (e) => { if (e.key === 'Enter') open(); }; });
  $$('[data-g]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await POST(`/api/calendar/birthdays/${b.dataset.g}/greet`, b.dataset.c === 'email' ? { email: true } : { whatsapp: true }), x = r[b.dataset.c];
      if (x.link) { const dlg = show('WhatsApp greeting', `<p>The WhatsApp API is not connected, so the message opens in WhatsApp for you to press Send.</p><div class="row end"><a class="btn" target="_blank" rel="noopener" href="${esc(x.link)}" id="wa">Open WhatsApp</a></div>`); $('#wa', dlg.el).onclick = () => setTimeout(() => { dlg.close(); go(); }, 400); }
      else if (x.status === 'sent') { toast('Greeting sent.'); go(); } else { toast(x.error || 'Not sent.', true); b.disabled = false; }
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  if ($('#bd')) $('#bd').onclick = () => calBirthdays(D.settings, admin);
  if ($('#st')) $('#st').onclick = () => calSettings(D.settings);
}, { office: true });

async function calBirthdays(S, admin) {
  const list = await GET('/api/calendar/birthdays');
  const dlg = show('Birthdays', `<p class="mute">Upload an Excel (.xlsx) or CSV file with the columns <b>Name, Birthday, Email, Phone</b> (birthday as DD/MM/YYYY; the year is optional). People whose phone or e-mail matches a client are linked to that client. Re-uploading never creates duplicates.</p>
    <div class="row"><button class="btn" id="up">Upload file</button><button class="btn ghost" id="pa">Paste list</button><button class="btn ghost" id="ad">Add one person</button></div>
    ${list.length ? `<div style="overflow:auto;margin-top:.8rem"><table><thead><tr><th>Name</th><th>Birthday</th><th>E-mail</th><th>Phone</th><th></th></tr></thead><tbody>${list.map((b) => `<tr><td>${esc(b.name)}${b.client_id ? ' ' + pill('client') : ''}</td><td>${String(b.day).padStart(2, '0')}/${String(b.month).padStart(2, '0')}${b.year ? '/' + b.year : ''}</td><td>${esc(b.email || '')}</td><td>${esc(b.phone || '')}</td><td style="white-space:nowrap"><button class="btn ghost sm" data-e="${b.id}">Edit</button> <button class="btn ghost sm" data-x="${b.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="mute">No birthdays yet.</p>'}`, true);
  const done = (r) => { calPref.set('bday', '1'); toast(`${r.added} added, ${r.updated} updated${r.skipped ? ', ' + r.skipped + ' row(s) skipped (date not understood)' : ''}.`); dlg.close(); go(); };
  $('#up', dlg.el).onclick = () => ask('Upload birthdays', [{ name: 'file', label: 'Excel (.xlsx) or CSV file', type: 'file', accept: '.xlsx,.csv,.txt', required: true }], 'Import', async (v) => { const fd = new FormData(); fd.append('file', v.file); done(await POST('/api/calendar/birthdays/import', fd)); });
  $('#pa', dlg.el).onclick = () => ask('Paste birthdays', [{ name: 'text', label: 'One person per line: Name, Birthday, Email, Phone', type: 'textarea', required: true, ph: 'Name,Birthday,Email,Phone\nAmit Roy,15/08/1980,amit@example.com,9830012345' }], 'Import', async (v) => done(await POST('/api/calendar/birthdays/import', { text: v.text })), true);
  const f = (b) => ask(b ? 'Edit person' : 'Add person', [{ name: 'name', label: 'Name', required: true, value: b && b.name }, { name: 'date', label: 'Birthday (DD/MM/YYYY)', required: true, value: b ? `${String(b.day).padStart(2, '0')}/${String(b.month).padStart(2, '0')}${b.year ? '/' + b.year : ''}` : '' }, { name: 'email', label: 'E-mail', value: b && b.email }, { name: 'phone', label: 'Mobile / WhatsApp', value: b && b.phone }], 'Save', async (v) => { b ? await PUT('/api/calendar/birthdays/' + b.id, v) : await POST('/api/calendar/birthdays', v); calPref.set('bday', '1'); dlg.close(); go(); });
  $('#ad', dlg.el).onclick = () => f();
  $$('[data-e]', dlg.el).forEach((x) => (x.onclick = () => f(list.find((b) => b.id === +x.dataset.e))));
  $$('[data-x]', dlg.el).forEach((x) => (x.onclick = async () => { if (sure('Delete this person?')) { await DEL('/api/calendar/birthdays/' + x.dataset.x); dlg.close(); go(); } }));
}

async function calSettings(S) {
  const dlg = show('Calendar settings', `<h4>Birthday greetings</h4>
    <label class="chk"><input type="checkbox" id="s_auto" ${S.auto ? 'checked' : ''}> Send birthday greetings automatically (every morning after 9 am)</label>
    <label class="chk"><input type="checkbox" id="s_em" ${S.email ? 'checked' : ''}> by e-mail (needs the mailbox set up in AI Control)</label>
    <label class="chk"><input type="checkbox" id="s_wa" ${S.wa ? 'checked' : ''}> by WhatsApp ${S.wa_api ? '' : '<span class="mute">(API not connected — use the WhatsApp button on the calendar; it opens WhatsApp with the message ready)</span>'}</label>
    <label for="s_sub">E-mail subject</label><input id="s_sub" value="${esc(S.subject)}"><label for="s_msg">Message — use {name} and {firm}</label><textarea id="s_msg" rows="6">${esc(S.msg)}</textarea>
    <div class="row end" style="margin:.6rem 0 1.2rem"><button class="btn" id="sv">Save</button></div>
    <h4>Holiday list</h4><p class="mute">Updated automatically every month${S.refreshed ? '. Last update: ' + dt(S.refreshed) + ' (' + esc(S.source) + (S.version ? ', list ' + esc(S.version) : '') + ')' : ''}. You can also update now, or add and remove entries on the calendar.</p>
    <div class="row end"><button class="btn ghost" id="rf">Update holiday list now</button></div>`);
  $('#sv', dlg.el).onclick = async () => { try { await PUT('/api/calendar/settings', { auto: $('#s_auto', dlg.el).checked, email: $('#s_em', dlg.el).checked, wa: $('#s_wa', dlg.el).checked, subject: $('#s_sub', dlg.el).value, msg: $('#s_msg', dlg.el).value }); toast('Saved.'); dlg.close(); } catch (e) { toast(e.message, true); } };
  $('#rf', dlg.el).onclick = async (e) => { e.target.disabled = true; try { const r = await POST('/api/calendar/refresh'); toast(`Holiday list updated (${r.count} entries, ${r.source}).`); dlg.close(); go(); } catch (x) { toast(x.message, true); e.target.disabled = false; } };
}
