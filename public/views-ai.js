'use strict';
/* ===== AI: drafting desk, mail assistant, website chats, admin control ===== */
const busy = (btn, on, txt) => { if (!btn) return; btn.disabled = on; if (txt) btn.dataset.t = on ? btn.textContent : btn.dataset.t, btn.textContent = on ? txt : btn.dataset.t || btn.textContent; };
const kindLabel = (k) => String(k || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* ---------- Drafting Desk ---------- */
route(/^\/draft$/, async () => {
  const [kinds, list] = await Promise.all([GET('/api/ai/kinds'), GET('/api/ai/drafts')]);
  view(`<h1>AI Drafting Desk</h1><p class="mute">Upload the client's papers (Word, PDF, photos of documents) and say what you need. Claude prepares a first draft for the advocate to review. Always check facts, sections and citations before use.</p>
    <form class="card" id="df"><label>What to draft</label><select name="kind">${kinds.map((k) => `<option value="${k.id}">${esc(kindLabel(k.id))}</option>`).join('')}</select>
      <label>Title (optional)</label><input name="title" maxlength="150">
      <label>Instructions / facts</label><textarea name="instruction" rows="6" placeholder="e.g. Draft a legal notice to the opposite party for dishonour of cheque dated … Demand ₹… within 15 days."></textarea>
      <label>Documents (up to 6; Word .docx, PDF, JPG/PNG, text; 12 MB each)</label><input type="file" name="files" multiple accept=".docx,.pdf,.jpg,.jpeg,.png,.webp,.txt">
      <p class="err" hidden></p><div style="margin-top:1rem"><button class="btn gold">Prepare draft</button></div></form>
    <div class="card"><h2>Saved drafts</h2>${list.length ? `<ul class="list">${list.map((d) => `<li><span><a href="#/draft/${d.id}"><b>${esc(d.title)}</b></a><div class="mute">${esc(kindLabel(d.kind))} · ${esc(d.by)} · ${dtm(d.created_at)}</div></span></li>`).join('')}</ul>` : '<p class="mute">No drafts yet.</p>'}</div>`);
  $('#df').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('.err', f), b = $('button', f); err.hidden = true; b.disabled = true; b.textContent = 'Drafting… this can take up to a minute';
    try { const r = await POST('/api/ai/draft', new FormData(f)); location.hash = '#/draft/' + r.id; }
    catch (ex) { err.hidden = false; err.textContent = ex.message; b.disabled = false; b.textContent = 'Prepare draft'; }
  };
});
route(/^\/draft\/(\d+)$/, async ([id]) => {
  const d = await GET('/api/ai/drafts/' + id);
  view(`<div class="row sp"><a class="btn ghost sm" href="#/draft">← Drafting Desk</a><div class="row"><a class="btn ghost sm" href="#/draft/${id}/print">Print on letter pad</a><button class="btn ghost sm" id="dw">Download Word</button><button class="btn ghost sm" id="cp">Copy</button><button class="btn ghost sm" id="dl">Delete</button></div></div>
    <div class="card"><label>Title</label><input id="tt" value="${esc(d.title)}"><label>Draft (you can edit directly)</label><textarea id="ot" rows="30" style="font-family:Georgia,serif;line-height:1.5">${esc(d.output)}</textarea>
      <div class="row" style="margin-top:.8rem"><button class="btn gold" id="sv">Save changes</button><span class="mute">${esc(kindLabel(d.kind))}</span></div></div>
    ${d.notes ? `<div class="card"><h3>Notes for the advocate</h3><div style="white-space:pre-wrap">${esc(d.notes)}</div></div>` : ''}
    <div class="card"><h3>Ask Claude to revise</h3><textarea id="ri" rows="3" placeholder="e.g. Add a paragraph on interest at 12% p.a.; make the tone firmer; shorten the facts."></textarea><p class="err" hidden></p><button class="btn" id="rv">Revise</button><p class="mute">Revising replaces the text above with the new version.</p></div>`);
  const save = async () => { await PATCH('/api/ai/drafts/' + id, { title: $('#tt').value, output: $('#ot').value }); toast('Saved'); };
  $('#sv').onclick = save;
  $('#cp').onclick = async () => { try { await navigator.clipboard.writeText($('#ot').value); toast('Copied'); } catch (e) { toast('Copy failed', true); } };
  $('#dl').onclick = async () => { if (sure('Delete this draft?')) { await DEL('/api/ai/drafts/' + id); location.hash = '#/draft'; } };
  $('#dw').onclick = () => {
    const html = '<html><head><meta charset="utf-8"><style>@page{size:A4;margin:1in}body{font-family:"Bookman Old Style",Georgia,serif;font-size:12pt;text-align:justify}p{margin:0 0 12pt}</style></head><body>' + $('#ot').value.split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') + '</body></html>';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' })); a.download = ($('#tt').value || 'draft').replace(/[^\w\- ]+/g, '').trim() + '.doc'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $('#rv').onclick = async (e) => {
    const err = $('.err', e.target.parentNode); err.hidden = true; if (!$('#ri').value.trim()) return;
    e.target.disabled = true; e.target.textContent = 'Revising…';
    try { await save(); const r = await POST(`/api/ai/drafts/${id}/refine`, { instruction: $('#ri').value }); go(); } catch (ex) { err.hidden = false; err.textContent = ex.message; e.target.disabled = false; e.target.textContent = 'Revise'; }
  };
});
route(/^\/draft\/(\d+)\/print$/, async ([id]) => {
  const [d, T] = await Promise.all([GET('/api/ai/drafts/' + id), getTpl()]);
  view(`<div class="row sp noprint"><a class="btn ghost sm" href="#/draft/${id}">← Back to draft</a><button class="btn sm" data-print>Print</button></div>
    ${sheetFor(T, `<div class="lbody">${esc(d.output)}</div>`)}`);
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
  view(`<h1>AI Control</h1><p class="mute">Switch AI features on or off for your whole firm. Everything stays off until you turn it on.</p>
    <form id="af"><div class="card"><h2>Switches</h2>
      ${sw('drafting', 'AI Drafting Desk', 'Advocates and staff can generate notices, petitions, FIR complaints etc. from uploaded papers.')}
      ${sw('email', 'Email assistant', 'Reads your mailbox, drafts replies, and sends approved or scheduled replies.')}
      ${sw('chat', 'Website chat assistant', 'Answers visitors on your website, saves leads, and sends them to book a paid consultation.')}</div>
    <div class="card"><h2>Claude connection</h2><p class="mute">Status: ${a.key_set ? 'your own key is saved (' + esc(a.key_hint) + ')' : a.key_env ? 'using the server-wide key' : '<b>no key yet</b> — AI will not work until a key is added'}. Keys are stored encrypted and never shown again.</p>
      <label>Anthropic API key (leave blank to keep the current one; type <code>__clear__</code> to remove)</label><input name="ai_key" type="password" autocomplete="off" placeholder="sk-ant-…">
      <label>Model (blank = ${esc(a.model_default)})</label><input name="ai_model" value="${esc(t.ai_model)}"><div class="row" style="margin-top:.6rem"><button type="button" class="btn sm ghost" id="tai">Test connection</button><span id="tair" class="mute"></span></div>
      <h3 style="margin-top:1rem">Usage this month</h3>${a.usage.length ? `<div class="tw"><table><tr><th>Feature</th><th class="n">Calls</th><th class="n">Input tokens</th><th class="n">Output tokens</th></tr>${a.usage.map((u) => `<tr><td>${esc(u.feature)}</td><td class="n">${u.calls}</td><td class="n">${u.in_tok}</td><td class="n">${u.out_tok}</td></tr>`).join('')}</table></div>` : '<p class="mute">No use yet.</p>'}</div>
    <div class="card"><h2>Drafting rules</h2><p class="mute">Standing instructions Claude follows in every draft (formats, fonts, who signs, how annexures are marked, house style).</p><textarea name="ai_drafting_rules" rows="8">${esc(t.ai_drafting_rules)}</textarea></div>
    <div class="card"><h2>Email assistant</h2><div class="grid2"><div><label>Incoming mail server (IMAP)</label><input name="mail_imap_host" value="${esc(t.mail_imap_host)}" placeholder="imap.titan.email"><label>IMAP port</label><input name="mail_imap_port" type="number" value="${esc(n.mail_imap_port)}"><label>Mailbox login</label><input name="mail_imap_user" value="${esc(t.mail_imap_user)}"><label>Password ${a.secrets.mail_imap_pass ? '(saved)' : ''}</label><input name="mail_imap_pass" type="password" autocomplete="off"></div>
      <div><label>Outgoing mail server (SMTP)</label><input name="mail_smtp_host" value="${esc(t.mail_smtp_host)}" placeholder="smtp.titan.email"><label>SMTP port</label><input name="mail_smtp_port" type="number" value="${esc(n.mail_smtp_port)}"><label>Login</label><input name="mail_smtp_user" value="${esc(t.mail_smtp_user)}"><label>Password ${a.secrets.mail_smtp_pass ? '(saved)' : ''}</label><input name="mail_smtp_pass" type="password" autocomplete="off"></div></div>
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
    ['ai_model', 'ai_drafting_rules', 'mail_imap_host', 'mail_imap_user', 'mail_smtp_host', 'mail_smtp_user', 'mail_from_name', 'mail_signature', 'chat_greeting', 'chat_origins', 'chat_firm_info'].forEach((k) => (body.text[k] = g(k)));
    body.text.chat_origins = body.text.chat_origins.split(/[\s,]+/).filter(Boolean).join(',');
    ['mail_imap_port', 'mail_smtp_port', 'mail_poll_min', 'mail_auto_delay_min', 'chat_daily_cap'].forEach((k) => (body.num[k] = g(k)));
    ['ai_key', 'mail_imap_pass', 'mail_smtp_pass'].forEach((k) => (body.secrets[k] = g(k)));
    try { await PUT('/api/ai-admin', body); toast('Saved'); await loadMe(); layout(); go(); } catch (ex) { err.hidden = false; err.textContent = ex.message; }
  };
  $('#tai').onclick = async () => { $('#tair').textContent = 'Testing…'; try { const r = await POST('/api/ai-admin/test-ai'); $('#tair').textContent = r.ok ? 'Connected ✓ (save first if you just typed a key)' : 'Unexpected reply'; } catch (ex) { $('#tair').textContent = ex.message; } };
  $('#tml').onclick = async () => { $('#tmlr').textContent = 'Testing…'; try { const r = await POST('/api/ai-admin/test-mail'); $('#tmlr').textContent = `Incoming: ${r.imap} · Outgoing: ${r.smtp} (save first if you just typed details)`; } catch (ex) { $('#tmlr').textContent = ex.message; } };
});
