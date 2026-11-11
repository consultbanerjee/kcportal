'use strict';
/* ===== AI: drafting desk, mail assistant, website chats, admin control ===== */
const busy = (btn, on, txt) => { if (!btn) return; btn.disabled = on; if (txt) btn.dataset.t = on ? btn.textContent : btn.dataset.t, btn.textContent = on ? txt : btn.dataset.t || btn.textContent; };
const kindLabel = (k) => String(k || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* ---------- Drafting Desk ---------- */
const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB';
route(/^\/draft$/, async (_, q) => {
  const [kinds, list, clients] = await Promise.all([GET('/api/ai/kinds'), GET('/api/ai/drafts'), GET('/api/clients')]), cpre = q.get('client') || '';
  view(`<h1>AI Drafting Desk</h1><p class="mute">Pick the client, tick the documents already in the client's folder (Google Drive), say what you need — Claude drafts it from those papers in the firm's house format. Always check facts, sections and citations before use.</p>
    <form class="card" id="df"><div class="grid2"><div><label>What to draft</label><select name="kind" id="dk">${kinds.map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select></div>
      <div><label>Page size</label><select name="page" id="dp"><option>A4</option><option>Legal</option></select><div class="mute" id="dpn"></div></div></div>
      <label>Client</label><select name="client_id" id="dc"><option value="">— none —</option>${clients.map((c) => `<option value="${c.id}" ${String(c.id) === cpre ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div id="dd"></div>
      <label>Title (optional)</label><input name="title" maxlength="150">
      <label>Instructions / facts</label><textarea name="instruction" rows="6" placeholder="e.g. Draft a writ petition against the order dated … challenging … Add prayer for stay. / Draft a legal notice for dishonour of cheque dated … Demand ₹… within 15 days."></textarea>
      <label>Extra files from your computer (optional, up to 6; not annexed)</label><input type="file" name="files" multiple accept=".docx,.pdf,.jpg,.jpeg,.png,.webp,.txt">
      <p class="err" hidden></p><div style="margin-top:1rem"><button class="btn gold">Prepare draft</button></div></form>
    <div class="card"><h2>Saved drafts</h2>${list.length ? `<ul class="list">${list.map((d) => `<li><span><a href="#/draft/${d.id}"><b>${esc(d.title)}</b></a><div class="mute">${esc(kindLabel(d.kind))}${d.client ? ' · ' + esc(d.client) : ''} · ${esc(d.by)} · ${dtm(d.created_at)} ${d.status === 'working' ? pill('drafting…') : d.status === 'failed' ? pill('failed', 'bad') : ''}</div></span></li>`).join('')}</ul>` : '<p class="mute">No drafts yet.</p>'}</div>`);
  const K = Object.fromEntries(kinds.map((k) => [k.id, k]));
  const sync = () => { const k = K[$('#dk').value]; const sel = $('#dp'); if (k.page) { sel.value = k.page; sel.disabled = true; $('#dpn').textContent = k.page === 'A4' ? 'Writ petitions are always on A4.' : 'Suits are always on Legal paper.'; } else { sel.disabled = false; $('#dpn').textContent = 'Choose A4 or Legal for this document.'; } };
  $('#dk').onchange = sync; sync();
  const loadDocs = async () => {
    const cid = $('#dc').value, box = $('#dd'); if (!cid) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="mute">Loading the client’s documents…</p>';
    const docs = await GET('/api/ai/client-docs?client_id=' + cid);
    box.innerHTML = docs.length ? `<label>Documents in the client’s folder <span class="mute">(tick what the AI should read; ticked papers it relies on become annexures)</span></label>
      <div class="row" style="margin:.2rem 0"><button type="button" class="btn ghost sm" id="da">Tick all</button><button type="button" class="btn ghost sm" id="dn">Clear</button><span class="mute" id="dt"></span></div>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--line,#ddd);border-radius:8px;padding:.3rem .6rem">${docs.map((d) => `<label class="row" style="gap:.5rem;margin:.15rem 0;font-weight:400"><input type="checkbox" class="dcb" value="${d.id}" data-s="${d.size || 0}" ${d.ok ? '' : 'disabled'}> <span>${esc(d.path ? d.path + ' / ' : '')}<b>${esc(d.name)}</b> <span class="mute">${kb(d.size)}${d.ok ? '' : ' — type not readable'}</span></span></label>`).join('')}</div>` : '<p class="mute">This client has no documents yet. Upload them on the client’s Files page, or attach files below.</p>';
    const tot = () => { const c = $$('.dcb:checked'); const t = $('#dt'); if (t) t.textContent = c.length + ' selected · ' + kb(c.reduce((a, x) => a + +x.dataset.s, 0)); };
    box.onchange = tot; tot();
    if ($('#da')) { $('#da').onclick = () => { $$('.dcb:not(:disabled)').forEach((x) => (x.checked = true)); tot(); }; $('#dn').onclick = () => { $$('.dcb').forEach((x) => (x.checked = false)); tot(); }; }
  };
  $('#dc').onchange = loadDocs; loadDocs();
  $('#df').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('.err', f), b = $('button.gold', f); err.hidden = true; b.disabled = true; b.textContent = 'Starting…';
    try { const fd = new FormData(f); fd.set('page', $('#dp').value); fd.set('doc_ids', $$('.dcb:checked').map((x) => x.value).join(',')); const r = await POST('/api/ai/draft', fd); location.hash = '#/draft/' + r.id; }
    catch (ex) { err.hidden = false; err.textContent = ex.message; b.disabled = false; b.textContent = 'Prepare draft'; }
  };
});
route(/^\/draft\/(\d+)$/, async ([id]) => {
  let d = await GET('/api/ai/drafts/' + id);
  if (d.status === 'working') {
    view(`<div class="row sp"><a class="btn ghost sm" href="#/draft">← Drafting Desk</a></div><div class="card"><h2>Claude is drafting…</h2><p class="mute">Reading the documents and writing the draft. Long petitions can take two to five minutes. You can leave this page; the draft will be in Saved drafts when ready.</p><div class="spin" style="margin:1rem 0">⏳</div></div>`);
    const t = setInterval(async () => { if (!location.hash.startsWith('#/draft/' + id)) return clearInterval(t); try { const x = await GET('/api/ai/drafts/' + id); if (x.status !== 'working') { clearInterval(t); go(); } } catch (e) {} }, 3000);
    return;
  }
  if (d.status === 'failed') { view(`<div class="row sp"><a class="btn ghost sm" href="#/draft">← Drafting Desk</a><button class="btn ghost sm" id="dl">Delete</button></div><div class="card"><h2>The draft could not be prepared</h2><p class="err">${esc(d.error || '')}</p><p class="mute">Go back and press Prepare draft again.</p></div>`); $('#dl').onclick = async () => { await DEL('/api/ai/drafts/' + id); location.hash = '#/draft'; }; return; }
  const ann = d.annexures || [], built = d.built || [], F = d.fmt;
  const fileRow = (f) => `<li class="row sp"><span><b>${esc(f.name)}</b> <span class="mute">${f.error ? esc(f.error) : kb(f.size) + (f.pages ? ' · ' + f.pages + ' pp' : '')}</span></span><span class="row">${f.error ? '' : `<label class="row" style="gap:.3rem;font-weight:400"><input type="checkbox" class="sf" value="${f.n}" ${f.kind !== 'word' ? 'checked' : ''}> send</label>${/\.pdf$/.test(f.name) ? `<a class="btn ghost sm" target="_blank" href="/api/ai/drafts/${id}/files/${f.n}?inline=1">Open / Print</a>` : ''}<a class="btn ghost sm" href="/api/ai/drafts/${id}/files/${f.n}">Download</a>`}</span></li>`;
  view(`<div class="row sp"><a class="btn ghost sm" href="#/draft">← Drafting Desk</a><div class="row"><button class="btn sm" id="dw">Save as Word (.docx)</button><button class="btn sm" id="dp">Save as PDF</button><button class="btn ghost sm" id="cp">Copy text</button><button class="btn ghost sm" id="dl">Delete</button></div></div>
    <div class="card"><div class="grid2"><div><label>Title</label><input id="tt" value="${esc(d.title)}"></div>
      <div><label>Page size</label><select id="pg" ${d.page_locked ? 'disabled' : ''}><option ${F.page === 'A4' ? 'selected' : ''}>A4</option><option ${F.page === 'Legal' ? 'selected' : ''}>Legal</option></select></div></div>
      <div class="mute">Format: ${esc(F.label || '')} — ${esc(F.font)} ${F.size} pt, line spacing ${F.spacing}, margins T${F.m.top}" B${F.m.bottom}" L${F.m.left}" R${F.m.right}", justified${d.page_locked ? ' · page size fixed for this kind of paper' : ''}.</div>
      <label>Draft (you can edit directly; lines starting @C, @CB, @R, @L, @T, @PB, @NUM, @NONUM are formatting codes)</label><textarea id="ot" rows="28" style="font-family:'Times New Roman',serif;line-height:1.5">${esc(d.output)}</textarea>
      <div class="row" style="margin-top:.8rem"><button class="btn gold" id="sv">Save changes</button><span class="mute">${esc(kindLabel(d.kind))}</span></div></div>
    ${d.notes ? `<div class="card"><h3>Notes for the advocate</h3><div style="white-space:pre-wrap">${esc(d.notes)}</div></div>` : ''}
    <div class="card"><h3>Annexures <span class="mute">(documents from the client’s folder, in chronological order)</span></h3>${ann.length ? `<table class="tbl"><tr><th>No.</th><th>Document</th><th>Date</th></tr>${ann.sort((x, y) => x.n - y.n).map((a) => `<tr><td>${esc(F.annex)}-${a.n}</td><td>${esc(a.title)}</td><td>${esc(a.date || '')}</td></tr>`).join('')}</table>` : '<p class="mute">No annexures in this draft.</p>'}</div>
    <div class="card"><h3>PDF, Word, print, e-mail and WhatsApp</h3><p class="mute">“Prepare files” saves your edits and makes the Word file, the ${ann.length ? 'petition as one PDF and each annexure as its own small PDF (stamped and page-numbered continuing from the petition)' : 'PDF'}, and keeps a copy in the client’s Drafts folder.</p>
      <p class="err" hidden></p><button class="btn gold" id="bd">${built.length ? 'Prepare files again' : 'Prepare files'}</button>
      ${built.length ? `<ul class="list" style="margin-top:.8rem">${built.map(fileRow).join('')}</ul><div class="row" style="margin-top:.8rem"><button class="btn" id="sd">Send by e-mail / WhatsApp…</button></div>` : ''}</div>
    <div class="card"><h3>Ask Claude to revise</h3><textarea id="ri" rows="3" placeholder="e.g. Add a paragraph on interest at 12% p.a.; make the tone firmer; shorten the facts."></textarea><p class="err" hidden></p><button class="btn" id="rv">Revise</button><p class="mute">Revising replaces the text above with a new version and clears the prepared files.</p></div>`);
  const save = async () => { await PATCH('/api/ai/drafts/' + id, { title: $('#tt').value, output: $('#ot').value, page: $('#pg').value }); };
  $('#sv').onclick = async () => { await save(); toast('Saved'); };
  const grab = (fmt) => async () => { try { await save(); location.href = `/api/ai/drafts/${id}/download/${fmt}`; } catch (ex) { toast(ex.message, true); } };
  $('#dw').onclick = grab('docx'); $('#dp').onclick = grab('pdf');
  $('#cp').onclick = async () => { try { await navigator.clipboard.writeText($('#ot').value); toast('Copied'); } catch (e) { toast('Copy failed', true); } };
  $('#dl').onclick = async () => { if (sure('Delete this draft?')) { await DEL('/api/ai/drafts/' + id); location.hash = '#/draft'; } };
  $('#bd').onclick = async (e) => { const err = $('.err', e.target.parentNode); err.hidden = true; e.target.disabled = true; e.target.textContent = 'Preparing…'; try { await save(); await POST(`/api/ai/drafts/${id}/build`, {}); go(); } catch (ex) { err.hidden = false; err.textContent = ex.message; e.target.disabled = false; e.target.textContent = 'Prepare files'; } };
  if ($('#sd')) $('#sd').onclick = () => {
    const pick = $$('.sf:checked').map((x) => +x.value); if (!pick.length) return toast('Tick the files to send', true);
    ask('Send ' + pick.length + ' file(s)', [
      { name: 'email', label: 'Send by e-mail (files attached)', type: 'checkbox' }, { name: 'to', label: 'E-mail address', type: 'email' },
      { name: 'whatsapp', label: 'Send on WhatsApp (link to download the files)', type: 'checkbox' }, { name: 'phone', label: 'WhatsApp mobile number', type: 'tel' },
      { name: 'message', label: 'Short message (optional)', type: 'textarea' }], 'Send', async (v) => {
      if (!v.email && !v.whatsapp) throw new Error('Tick e-mail or WhatsApp.');
      const r = await POST(`/api/ai/drafts/${id}/share`, { files: pick, email: v.email, to: v.to, whatsapp: v.whatsapp, phone: v.phone, message: v.message });
      if (r.wa_link) window.open(r.wa_link, '_blank');
      toast(r.emailed ? 'E-mailed to ' + r.emailed + (r.wa_link ? ' · WhatsApp opened' : '') : 'WhatsApp opened'); go();
    }, true);
  };
  $('#rv').onclick = async (e) => {
    const err = $('.err', e.target.parentNode); err.hidden = true; if (!$('#ri').value.trim()) return;
    e.target.disabled = true; e.target.textContent = 'Revising…';
    try { await save(); await POST(`/api/ai/drafts/${id}/refine`, { instruction: $('#ri').value }); go(); } catch (ex) { err.hidden = false; err.textContent = ex.message; e.target.disabled = false; e.target.textContent = 'Revise'; }
  };
});
route(/^\/draft\/(\d+)\/print$/, async ([id]) => {
  const [d, T] = await Promise.all([GET('/api/ai/drafts/' + id), getTpl()]);
  view(`<div class="row sp noprint"><a class="btn ghost sm" href="#/draft/${id}">← Back to draft</a><button class="btn sm" data-print>Print</button></div>
    ${sheetFor(T, `<div class="lbody">${esc(d.output.replace(/^@(?:CB|C|R|B|L|I|TH|T)\s?/gm, '').replace(/^@(?:PB|NUM|NONUM)\s*$/gm, ''))}</div>`)}`);
});

/* ---------- Mail assistant ---------- */
const mailPill = (m) => m.status === 'ignored' ? pill('ignored') : m.reply_status === 'sent' ? pill('replied', 'ok') : m.reply_status === 'scheduled' ? pill('scheduled', 'ok') : m.reply_status === 'draft' ? pill('draft ready') : pill(m.status);
route(/^\/mail$/, async (_, q) => {
  const f = q.get('f') || '';
  const [list, out] = await Promise.all([f === 'outbox' ? Promise.resolve([]) : GET('/api/mail' + (f ? '?f=' + f : '')), f === 'outbox' ? GET('/api/mail/outbox') : Promise.resolve([])]);
  const tab = (k, l) => `<a class="btn sm ${f === k ? '' : 'ghost'}" href="#/mail${k ? '?f=' + k : ''}">${l}</a>`;
  view(`<div class="row sp"><h1>Email assistant</h1><div class="row"><button class="btn sm ghost" id="cm">Compose with AI</button><button class="btn sm" id="pl">Fetch new mail</button></div></div>
    <div class="row" style="margin-bottom:.6rem">${tab('', 'All')}${tab('review', 'Drafts to review')}${tab('human', 'Needs a person')}${tab('outbox', 'Outbox')}</div>
    <div class="card">${f === 'outbox' ? (out.length ? `<div class="tw"><table><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr>${out.map((o) => `<tr><td>${esc(o.to_addr)}</td><td>${esc(o.subject)}</td><td>${pill(o.status, o.status === 'failed' ? 'bad' : o.status === 'sent' ? 'ok' : '')}${o.auto ? ' <span class="mute">auto</span>' : ''}${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}</td><td>${dtm(o.sent_at || o.send_at)}</td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing scheduled or sent.</p>')
      : list.length ? `<ul class="list">${list.map((m) => `<li><span><a href="#/mail/${m.id}"><b>${esc(m.subject)}</b></a><div class="mute">${esc(m.from_name || m.from_addr)} · ${dtm(m.received_at)}</div>${m.summary ? `<div>${esc(m.summary)}</div>` : ''}</span><span>${m.needs_human ? pill('needs person', 'bad') + ' ' : ''}${m.urgency === 'high' ? pill('urgent', 'bad') + ' ' : ''}${mailPill(m)}</span></li>`).join('')}</ul>` : '<p class="mute">No mail yet. New mail is fetched every few minutes, or press “Fetch new mail”.</p>'}</div>`);
  $('#pl').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Checking…'; try { const r = await POST('/api/mail/poll'); toast(r.fetched + ' new'); go(); } catch (ex) { toast(ex.message, true); e.target.disabled = false; e.target.textContent = 'Fetch new mail'; } };
  $('#cm').onclick = () => ask('Compose with AI', [{ name: 'to', label: 'To (email)', type: 'email', required: true }, { name: 'instruction', label: 'What should the email say?', type: 'textarea', required: true }], 'Draft', async (v) => { const r = await POST('/api/mail/compose', v); location.hash = '#/mailreply/' + r.id; }, true);
});
route(/^\/mail\/(\d+)$/, async ([id]) => {
  const m = await GET('/api/mail/' + id), cur = m.replies.find((r) => ['draft', 'scheduled', 'failed'].includes(r.status)), sent = m.replies.filter((r) => r.status === 'sent');
  view(`<div class="row sp"><a class="btn ghost sm" href="#/mail">← Mail</a><div class="row"><button class="btn ghost sm" id="rd">Redraft with instruction</button><button class="btn ghost sm" id="ig">Ignore</button></div></div>
    <div class="card"><h2>${esc(m.subject)}</h2><p class="mute">${esc(m.from_name)} &lt;${esc(m.from_addr)}&gt; · ${dtm(m.received_at)}</p><div>${m.needs_human ? pill('needs a person', 'bad') + ' ' : ''}${m.category ? pill(m.category.replace(/_/g, ' ')) + ' ' : ''}${m.urgency ? pill(m.urgency) : ''}</div>${m.summary ? `<p><b>AI summary:</b> ${esc(m.summary)}</p>` : ''}${m.lead_id ? `<p><a href="#/leads">Saved as a lead (see Leads) →</a></p>` : ''}<div style="white-space:pre-wrap;border-top:1px solid #dfe3ec;padding-top:.8rem">${esc(m.body)}</div></div>
    ${sent.map((r) => `<div class="card"><h3>Reply sent ${dtm(r.sent_at)}${r.auto ? ' (automatic)' : ''}</h3><div style="white-space:pre-wrap">${esc(r.body)}</div></div>`).join('')}
    ${cur ? replyForm(cur) : '<div class="card"><p class="mute">No reply drafted. Use “Redraft with instruction”.</p></div>'}`);
  bindReply(cur, () => go());
  $('#ig').onclick = async () => { await POST(`/api/mail/${id}/ignore`); location.hash = '#/mail'; };
  $('#rd').onclick = () => ask('Redraft reply', [{ name: 'instruction', label: 'What should the reply say or do differently? (optional)', type: 'textarea' }], 'Draft', async (v) => { await POST(`/api/mail/${id}/redraft`, v); go(); });
});
route(/^\/mailreply\/(\d+)$/, async ([id]) => {
  const r = await GET('/api/mail/reply/' + id);
  view(`<a class="btn ghost sm" href="#/mail">← Mail</a>${replyForm(r)}`); bindReply(r, () => { location.hash = '#/mail?f=outbox'; });
});
function replyForm(r) {
  return `<div class="card"><h3>Reply ${r.status === 'scheduled' ? pill('scheduled ' + dtm(r.send_at), 'ok') : r.status === 'failed' ? pill('failed', 'bad') : pill('draft')}${r.auto ? ' <span class="mute">auto-send</span>' : ''}</h3>${r.error ? `<p class="err">${esc(r.error)}</p>` : ''}
    <label>To</label><input id="rt" value="${esc(r.to_addr)}"><label>Subject</label><input id="rs" value="${esc(r.subject)}"><label>Message</label><textarea id="rb" rows="12">${esc(r.body)}</textarea>
    <div class="row" style="margin-top:.8rem;flex-wrap:wrap"><button class="btn gold" id="sn">Approve &amp; send now</button><input type="datetime-local" id="sa" style="max-width:15rem"><button class="btn" id="ss">Schedule</button><button class="btn ghost" id="sv">Save edits</button><button class="btn ghost" id="dc">Discard</button></div></div>`;
}
function bindReply(r, done) {
  if (!r) return;
  const edit = () => PATCH('/api/mail/replies/' + r.id, { to: $('#rt').value, subject: $('#rs').value, body: $('#rb').value });
  const wrap = (fn) => async () => { try { await fn(); done(); } catch (ex) { toast(ex.message, true); } };
  $('#sv').onclick = wrap(async () => { await edit(); toast('Saved'); });
  $('#sn').onclick = wrap(async () => { if (!sure('Send this email now?')) throw new Error('Cancelled'); await edit(); await POST(`/api/mail/replies/${r.id}/schedule`, {}); toast('Sending'); });
  $('#ss').onclick = wrap(async () => { const v = $('#sa').value; if (!v) throw new Error('Choose a date and time.'); await edit(); await POST(`/api/mail/replies/${r.id}/schedule`, { send_at: new Date(v).toISOString() }); toast('Scheduled'); });
  $('#dc').onclick = wrap(async () => { if (!sure('Discard this reply?')) throw new Error('Cancelled'); await POST(`/api/mail/replies/${r.id}/discard`); });
}

/* ---------- Website chats ---------- */
route(/^\/chats$/, async () => {
  const list = await GET('/api/chats');
  view(`<h1>Website chats</h1><p class="mute">Conversations handled automatically by the AI assistant on your website. Visitors who share their details are saved in Leads.</p>
    <div class="card">${list.length ? `<ul class="list">${list.map((c) => `<li><span><a href="#/chat/${c.id}"><b>${esc(c.name || 'Visitor')}</b></a> <span class="mute">${esc(c.phone || c.email || '')}</span><div>${esc((c.first_msg || '').slice(0, 140))}</div><div class="mute">${c.msg_count} messages · ${dtm(c.updated_at)}</div></span><span>${c.needs_human ? pill('call back', 'bad') + ' ' : ''}${c.lead_id ? `<a class="btn sm ghost" href="#/leads">In Leads</a>` : pill('no details')}</span></li>`).join('')}</ul>` : '<p class="mute">No chats yet.</p>'}</div>`);
});
route(/^\/chat\/(\d+)$/, async ([id]) => {
  const c = await GET('/api/chats/' + id);
  view(`<a class="btn ghost sm" href="#/chats">← Chats</a><div class="card"><h2>${esc(c.name || 'Visitor')}</h2><p class="mute">${esc(c.phone || '')} ${esc(c.email || '')} · ${dtm(c.created_at)}</p>${c.needs_human ? `<p>${pill('human follow-up needed', 'bad')}</p>` : ''}${c.lead_id ? `<p><a href="#/leads">See Leads →</a></p>` : ''}
    ${c.messages.map((m) => `<div style="margin:.5rem 0;${m.role === 'user' ? '' : 'text-align:right'}"><span style="display:inline-block;max-width:80%;padding:.5rem .8rem;border-radius:12px;background:${m.role === 'user' ? '#eef1f7' : '#fff4dc'};text-align:left;white-space:pre-wrap">${esc(m.content)}</span></div>`).join('')}</div>`);
});

/* ---------- Admin: AI Control ---------- */
route(/^\/ai$/, async () => {
  if (ME.role !== 'admin') { view('<p class="mute">Only the firm administrator can open AI Control.</p>'); return; }
  const a = await GET('/api/ai-admin'), t = a.text, n = a.num;
  const sw = (k, label, help) => `<label class="row" style="gap:.6rem;align-items:flex-start"><input type="checkbox" data-sw="${k}" ${a.on[k] ? 'checked' : ''} style="width:auto;margin-top:.3rem"><span><b>${label}</b><br><span class="mute">${help}</span></span></label>`;
  view(`<h1>AI Control</h1>${a.claude_allowed ? '' : '<div class="card"><b>Claude (AI) is switched off for your firm by the portal provider.</b> The switches below will start working once it is switched on again.</div>'}<p class="mute">Switch AI features on or off for your whole firm. Everything stays off until you turn it on.</p>
    <form id="af"><div class="card"><h2>Switches</h2>
      ${sw('drafting', 'AI Drafting Desk', 'Advocates and staff can generate notices, petitions, FIR complaints etc. from uploaded papers.')}
      ${sw('email', 'Email assistant', 'Reads your mailbox, drafts replies, and sends approved or scheduled replies.')}
      ${sw('chat', 'Website chat assistant', 'Answers visitors on your website, saves leads, and sends them to book a paid consultation.')}</div>
    <div class="card"><h2>Claude connection</h2><p class="mute">Status: ${a.key_set ? 'your own key is saved (' + esc(a.key_hint) + ')' : a.key_env ? 'using the server-wide key' : '<b>no key yet</b> — AI will not work until a key is added'}. Keys are stored encrypted and never shown again.</p>
      <label>Anthropic API key (leave blank to keep the current one; type <code>__clear__</code> to remove)</label><input name="ai_key" type="text" autocomplete="off" data-lpignore="true" data-1p-ignore style="-webkit-text-security:disc" placeholder="sk-ant-…">
      <label>Model (blank = ${esc(a.model_default)})</label><input name="ai_model" value="${esc(t.ai_model)}"><label>Model for drafting only (blank = same; use the strongest model for petitions)</label><input name="ai_draft_model" value="${esc(t.ai_draft_model)}" placeholder="e.g. claude-opus-5-5"><div class="row" style="margin-top:.6rem"><button type="button" class="btn sm ghost" id="tai">Test connection</button><span id="tair" class="mute"></span></div>
      <h3 style="margin-top:1rem">Usage this month</h3>${a.usage.length ? `<div class="tw"><table><tr><th>Feature</th><th class="n">Calls</th><th class="n">Input tokens</th><th class="n">Output tokens</th></tr>${a.usage.map((u) => `<tr><td>${esc(u.feature)}</td><td class="n">${u.calls}</td><td class="n">${u.in_tok}</td><td class="n">${u.out_tok}</td></tr>`).join('')}</table></div>` : '<p class="mute">No use yet.</p>'}</div>
    <div class="card"><h2>Drafting rules</h2><p class="mute">Standing instructions Claude follows in every draft (formats, fonts, who signs, how annexures are marked, house style). For KC LEGAL these are kept in step with the drafting instructions given to Claude outside the portal.</p><textarea name="ai_drafting_rules" rows="8">${esc(t.ai_drafting_rules)}</textarea></div>
    <div class="card"><h2>Email assistant</h2><div class="row sp"><p class="mute" style="margin:0">Using Titan Mail? Buy Titan for your domain from your web host, create the mailbox, then press the button and enter the mailbox address and its password. We fill in the server details for you.</p><button type="button" class="btn gold" id="titan">Use Titan Mail</button></div><div class="grid2"><div><label>Incoming mail server (IMAP)</label><input name="mail_imap_host" value="${esc(t.mail_imap_host)}" placeholder="imap.titan.email"><label>IMAP port</label><input name="mail_imap_port" type="number" value="${esc(n.mail_imap_port)}"><label>Mailbox login</label><input name="mail_imap_user" value="${esc(t.mail_imap_user)}"><label>Password ${a.secrets.mail_imap_pass ? '✓ saved' : '— not saved'}</label><input name="mail_imap_pass" type="text" autocomplete="off" data-lpignore="true" data-1p-ignore style="-webkit-text-security:disc" placeholder="${a.secrets.mail_imap_pass ? '•••••••• saved (type to replace)' : 'not saved yet'}"></div>
      <div><label>Outgoing mail server (SMTP)</label><input name="mail_smtp_host" value="${esc(t.mail_smtp_host)}" placeholder="smtp.titan.email"><label>SMTP port</label><input name="mail_smtp_port" type="number" value="${esc(n.mail_smtp_port)}"><label>Login</label><input name="mail_smtp_user" value="${esc(t.mail_smtp_user)}"><label>Password ${a.secrets.mail_smtp_pass ? '✓ saved' : '— not saved'}</label><input name="mail_smtp_pass" type="text" autocomplete="off" data-lpignore="true" data-1p-ignore style="-webkit-text-security:disc" placeholder="${a.secrets.mail_smtp_pass ? '•••••••• saved (type to replace)' : 'not saved yet'}"></div></div>
      <label>Sender name</label><input name="mail_from_name" value="${esc(t.mail_from_name)}"><label>Signature added to every reply</label><textarea name="mail_signature" rows="3">${esc(t.mail_signature)}</textarea>
      <label>When a reply is ready</label><select name="mail_mode"><option value="review" ${a.mail_mode === 'review' ? 'selected' : ''}>Wait for staff to approve (safest)</option><option value="auto" ${a.mail_mode === 'auto' ? 'selected' : ''}>Send routine enquiry replies automatically after a delay (court, urgent and legal matters always wait for a person)</option></select>
      <div class="grid2"><div><label>Automatic reply delay (minutes)</label><input name="mail_auto_delay_min" type="number" value="${esc(n.mail_auto_delay_min)}"></div><div><label>Check mailbox every (minutes)</label><input name="mail_poll_min" type="number" value="${esc(n.mail_poll_min)}"></div></div>
      <label class="row" style="gap:.5rem"><input type="checkbox" name="mail_ai_disclose" ${a.mail_ai_disclose ? 'checked' : ''} style="width:auto"> Add “prepared by the firm's AI assistant” note to automatic replies</label>
      <div class="row" style="margin-top:.6rem"><button type="button" class="btn sm ghost" id="tml">Test mailbox login</button><span id="tmlr" class="mute"></span></div>${a.mail_last_error ? `<p class="err">Last mailbox error: ${esc(a.mail_last_error)}</p>` : ''}</div>
    <div class="card"><h2>Website chat</h2><label>Opening message</label><textarea name="chat_greeting" rows="2" placeholder="Hello! I'm the virtual assistant of ${esc(FIRM)}. How can I help you today?">${esc(t.chat_greeting)}</textarea>
      <label>Information the assistant may use (practice areas, office hours, courts you appear in, languages…)</label><textarea name="chat_firm_info" rows="5">${esc(t.chat_firm_info)}</textarea>
      <label>Websites allowed to show the chat (one per line, e.g. https://kclegal.us and https://www.kclegal.us)</label><textarea name="chat_origins" rows="2">${esc(t.chat_origins)}</textarea>
      <label>Daily message limit (cost control)</label><input name="chat_daily_cap" type="number" value="${esc(n.chat_daily_cap)}">
      <label>Paste this one line into your website (before &lt;/body&gt;)</label><input readonly value="${esc(a.embed)}" onclick="this.select()"></div>
    <p class="err" hidden></p><button class="btn gold" style="width:100%">Save AI Control</button></form>`);
  const f = $('#af');
  f.onsubmit = async (e) => {
    e.preventDefault(); const err = $('.err', f); err.hidden = true;
    const g = (k) => f.elements[k] ? f.elements[k].value : undefined;
    const body = { on: {}, text: {}, num: {}, secrets: {}, mail_mode: g('mail_mode'), mail_ai_disclose: f.elements.mail_ai_disclose.checked };
    $$('[data-sw]').forEach((c) => (body.on[c.dataset.sw] = c.checked));
    ['ai_model', 'ai_draft_model', 'ai_drafting_rules', 'mail_imap_host', 'mail_imap_user', 'mail_smtp_host', 'mail_smtp_user', 'mail_from_name', 'mail_signature', 'chat_greeting', 'chat_origins', 'chat_firm_info'].forEach((k) => (body.text[k] = g(k)));
    body.text.chat_origins = body.text.chat_origins.split(/[\s,]+/).filter(Boolean).join(',');
    ['mail_imap_port', 'mail_smtp_port', 'mail_poll_min', 'mail_auto_delay_min', 'chat_daily_cap'].forEach((k) => (body.num[k] = g(k)));
    ['ai_key', 'mail_imap_pass', 'mail_smtp_pass'].forEach((k) => (body.secrets[k] = g(k)));
    try { await PUT('/api/ai-admin', body); toast('Saved'); await loadMe(); layout(); go(); } catch (ex) { err.hidden = false; err.textContent = ex.message; }
  };
  $('#tai').onclick = async () => { $('#tair').textContent = 'Testing…'; try { const r = await POST('/api/ai-admin/test-ai'); $('#tair').textContent = r.ok ? 'Connected ✓ (save first if you just typed a key)' : 'Unexpected reply'; } catch (ex) { $('#tair').textContent = ex.message; } };
  $('#titan').onclick = () => ask('Titan Mail', [{ name: 'user', label: 'Mailbox address', type: 'email', required: true, ph: 'name@yourfirm.com' }, { name: 'pass', label: 'Mailbox password', type: 'password', required: true }], 'Fill in', async (v) => {
    const f = $('#af'), set = (n, val) => { const el = f.elements[n]; if (el) el.value = val; };
    set('mail_imap_host', 'imap.titan.email'); set('mail_imap_port', '993'); set('mail_smtp_host', 'smtp.titan.email'); set('mail_smtp_port', '465');
    set('mail_imap_user', v.user); set('mail_smtp_user', v.user); set('mail_imap_pass', v.pass); set('mail_smtp_pass', v.pass); if (!f.elements.mail_from_name.value) set('mail_from_name', FIRM);
    toast('Titan details filled in. Press Save, then Test mail.');
  });
  $('#tml').onclick = async () => { $('#tmlr').textContent = 'Testing…'; try { const r = await POST('/api/ai-admin/test-mail'); $('#tmlr').textContent = `Incoming: ${r.imap} · Outgoing: ${r.smtp} (save first if you just typed details)`; } catch (ex) { $('#tmlr').textContent = ex.message; } };
});

/* ---------- Tickets raised by the chat assistant ---------- */
route(/^\/tickets$/, async (_, q) => {
  const st = q.get('s') || 'open', list = await GET('/api/tickets?status=' + st);
  view(`<h1>Tickets</h1><p class="mute">Chats the assistant could not settle, or where the person asked for someone from the office. Their contact details are saved so you can call or write back.</p>
    <div class="row" style="margin-bottom:.8rem"><a class="btn sm ${st === 'open' ? '' : 'ghost'}" href="#/tickets?s=open">Open</a><a class="btn sm ${st === 'closed' ? '' : 'ghost'}" href="#/tickets?s=closed">Closed</a></div>
    <div class="card">${list.length ? `<ul class="list">${list.map((k) => `<li><span><a href="#/ticket/${k.id}"><b>${esc(k.subject || 'Chat follow-up')}</b></a> ${k.priority === 'high' ? pill('urgent', 'bad') : ''} ${k.existing_client ? pill('existing client?') : ''}<div>${esc(k.name || 'Name not given')} · ${esc(k.phone || '')} ${esc(k.email || '')}</div><div class="mute">${esc(k.source)} · ${dtm(k.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">Nothing here.</p>'}</div>`);
});
route(/^\/ticket\/(\d+)$/, async ([id]) => {
  const k = await GET('/api/tickets/' + id);
  view(`<a class="btn ghost sm" href="#/tickets">← Tickets</a>
    <div class="card"><h2>${esc(k.subject || 'Chat follow-up')} ${k.priority === 'high' ? pill('urgent', 'bad') : ''} ${pill(k.status, k.status === 'open' ? 'bad' : '')}</h2>
      <p><b>${esc(k.name || 'Name not given')}</b>${k.client_name ? ` · <a href="#/client/${k.client_id}">${esc(k.client_name)} (client file)</a>` : ''}</p>
      <p>${k.phone ? `<a href="tel:${esc(k.phone)}">${esc(k.phone)}</a> · <a href="https://wa.me/${esc(String(k.phone).replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : 'No phone'} ${k.email ? ` · <a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : ''}</p>
      ${k.address ? `<p>${esc(k.address)}</p>` : ''}${k.existing_client ? `<p class="mute">${esc(k.existing_client)}</p>` : ''}
      <h3>What they need</h3><p style="white-space:pre-wrap">${esc(k.summary || '')}</p>
      <label>Your note</label><textarea id="sn" rows="3">${esc(k.staff_note || '')}</textarea>
      <div class="row" style="margin-top:.8rem"><button class="btn gold" id="sv">Save note</button><button class="btn ghost" id="st">${k.status === 'open' ? 'Mark as done' : 'Reopen'}</button></div></div>
    ${k.messages.length ? `<div class="card"><h3>Chat</h3>${k.messages.map((m) => `<p><b>${m.role === 'user' ? 'Visitor' : 'Assistant'}:</b> ${esc(m.content)}</p>`).join('')}</div>` : ''}`);
  $('#sv').onclick = async () => { await PATCH('/api/tickets/' + id, { staff_note: $('#sn').value }); toast('Saved'); };
  $('#st').onclick = async () => { await PATCH('/api/tickets/' + id, { status: k.status === 'open' ? 'closed' : 'open', staff_note: $('#sn').value }); location.hash = '#/tickets'; };
});

/* ---------- Live chat for signed-in clients ---------- */
route(/^\/livechat$/, async () => {
  const c = await GET('/api/client-chat');
  view(`<h1>Live chat</h1><p class="mute">Ask about your cases, next dates, documents or fees. If it needs your advocate, a note is passed to them.</p>
    <div class="card" style="padding:0"><div id="lcm" style="height:55vh;min-height:300px;overflow:auto;padding:1rem;background:#f6f7fb"></div>
    <form id="lcf" class="row" style="border-top:1px solid #e1e5ee;padding:.6rem"><input name="t" maxlength="1000" placeholder="Type your message…" autocomplete="off" style="flex:1" ${c.enabled ? '' : 'disabled'}><button class="btn gold" ${c.enabled ? '' : 'disabled'}>Send</button></form></div>
    ${c.enabled ? '' : '<p class="mute">Live chat is not switched on yet. Please use the Messages page to reach your advocate.</p>'}`);
  const box = $('#lcm');
  const add = (who, text) => { const d = document.createElement('div'); d.style.cssText = 'margin:.35rem 0;display:flex;justify-content:' + (who === 'u' ? 'flex-end' : 'flex-start'); const b = document.createElement('div'); b.style.cssText = 'max-width:80%;padding:.55rem .8rem;border-radius:12px;white-space:pre-wrap;border:1px solid #e1e5ee;background:' + (who === 'u' ? '#1f2a44;color:#fff' : '#fff'); b.textContent = text; d.appendChild(b); box.appendChild(d); box.scrollTop = box.scrollHeight; return b; };
  if (!c.messages.length) add('a', c.greeting); else c.messages.forEach((m) => add(m.role === 'user' ? 'u' : 'a', m.content));
  $('#lcf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, text = f.t.value.trim(); if (!text) return; f.t.value = ''; add('u', text);
    const w = add('a', '…'), t0 = Date.now(); f.t.disabled = true;
    try { const r = await POST('/api/client-chat', { text }); const wait = Math.max(0, Math.min(3500, 700 + r.reply.length * 18) - (Date.now() - t0)); await new Promise((ok) => setTimeout(ok, wait)); w.textContent = r.reply; }
    catch (ex) { w.textContent = ex.message; }
    f.t.disabled = false; f.t.focus(); box.scrollTop = box.scrollHeight;
  };
}, { client: true });
