'use strict';
/* ===== Super Admin: configure everything for one firm (services, Claude, mail, chat, court data, WhatsApp, reminders, Drive, case arguments, calendar, weather) =====
   Firms never see any of this. Every call goes through /api/platform/f/<firm>/… which only the Super Admin can reach. */
const CFG_TABS = [['services', 'Services'], ['claude', 'Claude AI'], ['mail', 'Mail'], ['chat', 'Website chat'], ['court', 'Court data'], ['wa', 'WhatsApp'], ['rem', 'Reminders'], ['drive', 'Google Drive'], ['args', 'Case arguments'], ['cal', 'Calendar and home']];

route(/^\/fcfg\/(\d+)$/, async ([id], p) => {
  const tab = CFG_TABS.some((t) => t[0] === p.get('tab')) ? p.get('tab') : 'services', P = '/api/platform/f/' + id;
  const [S, firms] = await Promise.all([GET('/api/platform/services'), GET('/api/platform/firms')]);
  const f = firms.find((x) => String(x.id) === String(id));
  if (!f) { view('<div class="card"><p class="err">Firm not found.</p></div><a class="btn ghost" href="#/firms">← Firms</a>'); return; }
  const head = `<div class="row sp"><h1>Configure — ${esc(f.name)}</h1><a class="btn ghost sm" href="#/firms">← All firms</a></div>
    <p class="mute">Only you can see and change these settings. The firm sees nothing of how its services are connected — only whether a service is available.</p>
    <div class="tabs">${CFG_TABS.map(([k, l]) => `<a href="#/fcfg/${id}?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const body = (h) => view(head + h);
  const sec = (k) => (el) => el;  // placeholder to keep the layout simple
  if (tab === 'services') return cfgServices(id, S, body);
  if (tab === 'claude') return cfgClaude(id, P, body);
  if (tab === 'mail') return cfgMail(id, P, body);
  if (tab === 'chat') return cfgChat(id, P, body);
  if (tab === 'court') return cfgCourt(id, P, body);
  if (tab === 'wa') return cfgWa(id, P, body, f);
  if (tab === 'rem') return cfgRem(id, P, body);
  if (tab === 'drive') return cfgDrive(id, P, body, p);
  if (tab === 'args') return cfgArgs(id, P, body);
  return cfgCal(id, P, body, f);
});

/* ---- services: master switch + this firm's switch for each running-cost service ---- */
function cfgServices(id, S, body) {
  body(`<div class="card"><h2>Services for this firm</h2><p class="mute">Switch a running-cost service on or off for this firm. A service needs <b>both</b> the platform switch (set on the Firms page) and this firm's switch. Claude features also need the firm's “Claude AI” switch on. New firms start with everything off.</p>
    <div class="tw"><table><tr><th>Service</th><th>Who pays</th><th>Platform</th><th>This firm</th></tr>${S.services.map((s) => `<tr><td>${esc(s.label)}${s.note ? `<br><span class="mute">${esc(s.note)}</span>` : ''}</td><td class="mute">${esc(s.cost)}</td><td>${s.master ? pill('on', 'ok') : pill('off', 'bad')}</td>
      <td><label class="chk"><input type="checkbox" data-s="${s.id}" ${s.firms[id] ? 'checked' : ''}> ${s.firms[id] ? 'On' : 'Off'}</label></td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:.8rem"><button class="btn ghost" id="allon">Switch all on</button><button class="btn ghost" id="alloff">Switch all off</button></div></div>`);
  const set = async (m) => { try { await PUT(`/api/platform/firms/${id}/services`, { services: m }); toast('Saved.'); go(); } catch (x) { toast(x.message, true); } };
  $$('[data-s]').forEach((c) => (c.onchange = () => set({ [c.dataset.s]: c.checked })));
  $('#allon').onclick = () => set(Object.fromEntries(S.services.map((s) => [s.id, true])));
  $('#alloff').onclick = () => { if (sure('Switch every service off for this firm?')) set(Object.fromEntries(S.services.map((s) => [s.id, false]))); };
}

/* ---- shared helpers ---- */
const cfgSecret = (name, saved) => `<input name="${name}" type="text" autocomplete="off" data-lpignore="true" data-1p-ignore style="-webkit-text-security:disc" placeholder="${saved ? 'saved — leave blank to keep' : ''}">`;
const cfgForm = (inner) => `<form id="cf">${inner}<p class="err" hidden></p><p><button class="btn gold">Save</button></p></form>`;
async function cfgSave(P, path, body, then) { const err = $('.err', $('#cf')); err.hidden = true; try { await PUT(P + path, body); toast('Saved'); if (then) await then(); go(); } catch (ex) { err.hidden = false; err.textContent = ex.message; } }

/* ---- Claude connection, drafting rules, model ---- */
async function cfgClaude(id, P, body) {
  const a = await GET(P + '/ai-admin'), t = a.text;
  body(`<div class="card"><h2>Claude connection</h2><p class="mute">Status: ${a.key_set ? 'this firm\'s own key is saved (' + esc(a.key_hint) + ')' : a.key_env ? 'using the platform key' : '<b>no key yet</b> — AI will not work until a key is set (Platform settings, or here)'}. Keys are stored encrypted and never shown again.</p>
    ${cfgForm(`<label>Anthropic API key for this firm only (blank = keep; <code>__clear__</code> = remove; leave empty to use the platform key)</label>${cfgSecret('ai_key', a.key_set)}
      <label>Model (blank = ${esc(a.model_default)})</label><input name="ai_model" value="${esc(t.ai_model)}">
      <label>Model for drafting only (blank = same)</label><input name="ai_draft_model" value="${esc(t.ai_draft_model)}" placeholder="e.g. claude-opus-5-5">
      <h3>Drafting rules</h3><p class="mute">Standing instructions Claude follows in every draft for this firm (formats, fonts, who signs, annexure marking, house style).</p><textarea name="ai_drafting_rules" rows="10">${esc(t.ai_drafting_rules)}</textarea>`)}
    <div class="row"><button class="btn sm ghost" id="tai">Test connection</button><span id="tair" class="mute"></span></div>
    <h3 style="margin-top:1rem">Usage this month</h3>${a.usage.length ? `<div class="tw"><table><tr><th>Feature</th><th class="n">Calls</th><th class="n">Input tokens</th><th class="n">Output tokens</th></tr>${a.usage.map((u) => `<tr><td>${esc(u.feature)}</td><td class="n">${u.calls}</td><td class="n">${u.in_tok}</td><td class="n">${u.out_tok}</td></tr>`).join('')}</table></div>` : '<p class="mute">No use yet.</p>'}</div>`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/ai-admin', { text: { ai_model: f.ai_model.value, ai_draft_model: f.ai_draft_model.value, ai_drafting_rules: f.ai_drafting_rules.value }, secrets: { ai_key: f.ai_key.value } }); };
  $('#tai').onclick = async () => { $('#tair').textContent = 'Testing…'; try { const r = await POST(P + '/ai-admin/test-ai'); $('#tair').textContent = r.ok ? 'Connected ✓ (save first if you just typed a key)' : 'Unexpected reply'; } catch (ex) { $('#tair').textContent = ex.message; } };
}

/* ---- mailbox ---- */
async function cfgMail(id, P, body) {
  const a = await GET(P + '/ai-admin'), t = a.text, n = a.num;
  body(`<div class="card"><h2>Mailbox (Titan Mail or any IMAP/SMTP)</h2><div class="row sp"><p class="mute" style="margin:0">Using Titan? Press the button, enter the mailbox address and password; the server details are filled in for you.</p><button type="button" class="btn gold" id="titan">Use Titan Mail</button></div>
    ${cfgForm(`<div class="grid2"><div><label>Incoming server (IMAP)</label><input name="mail_imap_host" value="${esc(t.mail_imap_host)}" placeholder="imap.titan.email"><label>IMAP port</label><input name="mail_imap_port" type="number" value="${esc(n.mail_imap_port)}"><label>Login</label><input name="mail_imap_user" value="${esc(t.mail_imap_user)}"><label>Password ${a.secrets.mail_imap_pass ? '✓ saved' : '— not saved'}</label>${cfgSecret('mail_imap_pass', a.secrets.mail_imap_pass)}</div>
      <div><label>Outgoing server (SMTP)</label><input name="mail_smtp_host" value="${esc(t.mail_smtp_host)}" placeholder="smtp.titan.email"><label>SMTP port</label><input name="mail_smtp_port" type="number" value="${esc(n.mail_smtp_port)}"><label>Login</label><input name="mail_smtp_user" value="${esc(t.mail_smtp_user)}"><label>Password ${a.secrets.mail_smtp_pass ? '✓ saved' : '— not saved'}</label>${cfgSecret('mail_smtp_pass', a.secrets.mail_smtp_pass)}</div></div>
      <label>Sender name</label><input name="mail_from_name" value="${esc(t.mail_from_name)}"><label>Signature added to every reply</label><textarea name="mail_signature" rows="3">${esc(t.mail_signature)}</textarea>
      <label>When a reply is ready</label><select name="mail_mode"><option value="review" ${a.mail_mode === 'review' ? 'selected' : ''}>Wait for staff to approve (safest)</option><option value="auto" ${a.mail_mode === 'auto' ? 'selected' : ''}>Send routine enquiry replies automatically after a delay (court, urgent and legal matters always wait for a person)</option></select>
      <div class="grid2"><div><label>Automatic reply delay (minutes)</label><input name="mail_auto_delay_min" type="number" value="${esc(n.mail_auto_delay_min)}"></div><div><label>Check mailbox every (minutes)</label><input name="mail_poll_min" type="number" value="${esc(n.mail_poll_min)}"></div></div>
      <label class="chk"><input type="checkbox" name="mail_ai_disclose" ${a.mail_ai_disclose ? 'checked' : ''}> Add a “prepared by the firm's AI assistant” note to automatic replies</label>`)}
    <div class="row"><button class="btn sm ghost" id="tml">Test mailbox login</button><span id="tmlr" class="mute"></span></div>${a.mail_last_error ? `<p class="err">Last mailbox error: ${esc(a.mail_last_error)}</p>` : ''}</div>`);
  const f = $('#cf'), g = (k) => f.elements[k].value;
  f.onsubmit = (e) => { e.preventDefault(); const text = {}, num = {}, secrets = {};
    ['mail_imap_host', 'mail_imap_user', 'mail_smtp_host', 'mail_smtp_user', 'mail_from_name', 'mail_signature'].forEach((k) => (text[k] = g(k)));
    ['mail_imap_port', 'mail_smtp_port', 'mail_poll_min', 'mail_auto_delay_min'].forEach((k) => (num[k] = g(k)));
    ['mail_imap_pass', 'mail_smtp_pass'].forEach((k) => (secrets[k] = g(k)));
    cfgSave(P, '/ai-admin', { text, num, secrets, mail_mode: g('mail_mode'), mail_ai_disclose: f.elements.mail_ai_disclose.checked }); };
  $('#titan').onclick = () => ask('Titan Mail', [{ name: 'user', label: 'Mailbox address', type: 'email', required: true }, { name: 'pass', label: 'Mailbox password', type: 'password', required: true }], 'Fill in', async (v) => {
    const set = (k, val) => { if (f.elements[k]) f.elements[k].value = val; };
    set('mail_imap_host', 'imap.titan.email'); set('mail_imap_port', '993'); set('mail_smtp_host', 'smtp.titan.email'); set('mail_smtp_port', '465');
    set('mail_imap_user', v.user); set('mail_smtp_user', v.user); set('mail_imap_pass', v.pass); set('mail_smtp_pass', v.pass); toast('Filled in. Press Save, then Test.'); });
  $('#tml').onclick = async () => { $('#tmlr').textContent = 'Testing…'; try { const r = await POST(P + '/ai-admin/test-mail'); $('#tmlr').textContent = `Incoming: ${r.imap} · Outgoing: ${r.smtp}`; } catch (ex) { $('#tmlr').textContent = ex.message; } };
}

/* ---- website chat ---- */
async function cfgChat(id, P, body) {
  const a = await GET(P + '/ai-admin'), t = a.text, n = a.num;
  body(`<div class="card"><h2>Website chat assistant</h2>${cfgForm(`<label>Opening message</label><textarea name="chat_greeting" rows="2">${esc(t.chat_greeting)}</textarea>
    <label>Information the assistant may use (practice areas, office hours, courts, languages…)</label><textarea name="chat_firm_info" rows="6">${esc(t.chat_firm_info)}</textarea>
    <label>Websites allowed to show the chat (one per line)</label><textarea name="chat_origins" rows="2">${esc((t.chat_origins || '').split(',').join('\n'))}</textarea>
    <label>Daily message limit (cost control)</label><input name="chat_daily_cap" type="number" value="${esc(n.chat_daily_cap)}">`)}
    <label>One line to give the firm for its website (before &lt;/body&gt;)</label><input readonly value="${esc(a.embed)}" onclick="this.select()"></div>`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/ai-admin', { text: { chat_greeting: f.chat_greeting.value, chat_firm_info: f.chat_firm_info.value, chat_origins: f.chat_origins.value.split(/[\s,]+/).filter(Boolean).join(',') }, num: { chat_daily_cap: f.chat_daily_cap.value } }); };
}

/* ---- court data (eCourts) ---- */
async function cfgCourt(id, P, body) {
  const c = await GET(P + '/ecourts/config');
  body(`<div class="card"><h2>Court data (eCourts)</h2><p class="mute">Searches every court in India, tracks cases daily and fetches orders, through the licensed data service. It charges per lookup.</p>
    <p class="mute">Key: ${c.key_own ? 'this firm\'s own key (' + esc(c.key_hint) + ')' : c.key_platform ? 'using the platform key (billed to the firm per your plan)' : '<b>no key yet</b>'}.</p>
    ${cfgForm(`<label class="chk"><input type="checkbox" name="on" ${c.on ? 'checked' : ''}> Court data on for this firm</label>
      <label>Key for this firm only (blank = keep; <code>__clear__</code> = remove)</label>${cfgSecret('key', c.key_own)}
      <label class="chk"><input type="checkbox" name="archive" ${c.archive ? 'checked' : ''}> Save a Court record PDF and every order into the client's Judgements folder (daily, 2 am)</label>
      <label class="chk"><input type="checkbox" name="autosync" ${c.autosync ? 'checked' : ''}> Update every linked open case daily and create a task on any change</label>
      <div class="grid2"><div><label>Most cases to update per day</label><input name="daily_cap" type="number" min="1" max="200" value="${esc(c.daily_cap)}"></div><div><label>Estimated cost of one lookup (₹)</label><input name="rate" type="number" step="0.01" min="0" value="${esc(c.rate)}"></div></div>`)}
    <div class="row"><button class="btn sm ghost" id="tc">Test the key</button><span id="tr" class="mute"></span></div>
    <p>This month (${esc(c.usage.month)}): ${c.usage.calls} lookups · estimated <b>${inr(c.usage.est_cost_paise)}</b> · ${c.linked} case(s) linked${c.last_sync ? ' · last daily update ' + esc(c.last_sync.slice(0, 16).replace('T', ' ')) + ' UTC' : ''}</p></div>`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/ecourts/config', { on: f.on.checked, autosync: f.autosync.checked, archive: f.archive.checked, daily_cap: f.daily_cap.value, rate: f.rate.value, key: f.key.value.trim() }); };
  $('#tc').onclick = async () => { $('#tr').textContent = 'Testing…'; try { const r = await POST(P + '/ecourts/test', {}); $('#tr').textContent = '✔ Connected — ' + r.states + ' states available.'; } catch (x) { $('#tr').textContent = '✖ ' + x.message; } };
}

/* ---- WhatsApp (Meta) ---- */
async function cfgWa(id, P, body) {
  const wa = await GET(P + '/whatsapp');
  body(`<div class="card"><h2>WhatsApp (Meta WhatsApp Business)</h2><p>Status: ${wa.configured ? pill('connected', 'ok') : pill('not set up — messages open in WhatsApp for staff to send by hand', 'warn')}</p>
    ${cfgForm(`<label>Phone number ID</label><input name="phone_id" value="${esc(wa.phone_id || '')}" autocomplete="off"><label>WhatsApp Business Account ID</label><input name="waba" value="${esc(wa.waba || '')}" autocomplete="off">
      <label>Permanent access token ${wa.has_token ? '(saved — leave blank to keep)' : ''}</label>${cfgSecret('token', wa.has_token)}<label>App secret ${wa.has_secret ? '(saved — leave blank to keep)' : ''}</label>${cfgSecret('app_secret', wa.has_secret)}
      <label>Template language code</label><input name="lang" value="${esc(wa.lang || 'en')}" style="max-width:8rem">
      <label class="chk"><input type="checkbox" name="welcome" ${wa.welcome ? 'checked' : ''}> Greet a client on WhatsApp when the number is first added</label>
      <label class="chk"><input type="checkbox" name="auto" ${wa.auto_booking ? 'checked' : ''}> Send the client a WhatsApp (with the video link) when a consultation is confirmed</label>`)}
    <details><summary>How to set up</summary><ol class="mute"><li>developers.facebook.com › create a Business app › add WhatsApp; link the firm's Meta Business account and add its number (not in use in ordinary WhatsApp).</li>
      <li>Create a System User, give it the WhatsApp account and generate a permanent token (whatsapp_business_messaging, whatsapp_business_management). Paste it with the Phone number ID and account ID.</li>
      <li>In WhatsApp Manager create and get approved these templates: ${(wa.templates || []).map((t) => `<b>${esc(t.name)}</b> — <i>${esc(t.text)}</i>`).join('; ')}.</li>
      <li>Webhook: callback URL <code>${esc(wa.webhook_url || '')}</code>, verify token <code>${esc(wa.verify || '(save once to generate)')}</code>; subscribe to <b>messages</b>.</li></ol></details></div>`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/whatsapp', { phone_id: f.phone_id.value, waba: f.waba.value, token: f.token.value, app_secret: f.app_secret.value, lang: f.lang.value, welcome: f.welcome.checked, auto_booking: f.auto.checked }); };
}

/* ---- automatic payment reminders ---- */
async function cfgRem(id, P, body) {
  const rm = await GET(P + '/reminders');
  body(`<div class="card"><h2>Automatic payment reminders</h2>${cfgForm(`<label class="chk"><input type="checkbox" name="on" ${rm.on ? 'checked' : ''}> Send reminders automatically for unpaid invoices (10 am – 6 pm India time)</label>
    <div class="row" style="gap:1rem;flex-wrap:wrap"><div><label>Only invoices dated on/after</label><input type="date" name="since" value="${rm.since || ''}" style="max-width:11rem"></div><div><label>First reminder, days after due date</label><input type="number" min="0" name="first" value="${rm.first}" style="max-width:8rem"></div><div><label>Repeat every (days)</label><input type="number" min="1" name="every" value="${rm.every}" style="max-width:8rem"></div><div><label>At most (per invoice)</label><input type="number" min="1" name="max" value="${rm.max}" style="max-width:8rem"></div></div>
    <label class="chk"><input type="checkbox" name="wa" ${rm.wa ? 'checked' : ''}> WhatsApp ${rm.wa_ready ? '' : '<span class="mute">(not set up — skipped)</span>'}</label>
    <label class="chk"><input type="checkbox" name="email" ${rm.email ? 'checked' : ''}> E-mail ${rm.email_ready ? '' : '<span class="mute">(mailbox not set up — skipped)</span>'}</label>`)}
    <p class="mute">Reminders carry a Google Pay / UPI link ${rm.link_ready ? '' : '— <b>the firm has not set its UPI ID yet</b>, so the link only opens the portal'}. ${rm.pending} invoice(s) due now.</p><button class="btn ghost" id="rmr">Send due reminders now</button></div>
    ${rm.log.length ? `<div class="card"><h3>Recent reminders</h3><div class="tw"><table><tr><th>When</th><th>Invoice</th><th>Client</th><th>Via</th><th>Result</th></tr>${rm.log.map((l) => `<tr><td>${esc(String(l.created_at).slice(0, 16))}</td><td>${esc(l.inv_no)}</td><td>${esc(l.client || '')}</td><td>${esc(l.channel || '')}</td><td>${esc(l.result || l.status || '')}</td></tr>`).join('')}</table></div></div>` : ''}`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/reminders', { on: f.on.checked, since: f.since.value, first: f.first.value, every: f.every.value, max: f.max.value, wa: f.wa.checked, email: f.email.checked }); };
  $('#rmr').onclick = async () => { try { const r = await POST(P + '/reminders/run'); toast(r.invoices ? `${r.messages} message(s) sent for ${r.invoices} invoice(s).` : 'Nothing is due right now.'); go(); } catch (x) { toast(x.message, true); } };
}

/* ---- Google Drive, Calendar, Meet, Contacts ---- */
async function cfgDrive(id, P, body, p) {
  const s = await GET(P + '/storage'), ct = s.connected ? await GET(P + '/contacts').catch(() => ({})) : {};
  body(`${p.get('ok') ? '<div class="card"><b style="color:var(--ok)">Google Drive connected.</b></div>' : ''}${p.get('err') ? `<div class="card"><p class="err">${esc(p.get('err'))}</p></div>` : ''}
    <div class="card"><h2>Google Drive, Calendar, Meet and Contacts</h2><p>Status: ${s.connected ? pill('connected' + (s.email ? ' · ' + s.email : ''), 'ok') : s.configured ? pill('ready to connect', 'warn') : pill('not set up', 'warn')}
      ${s.connected ? `<br><span class="mute">Waiting to sync: ${s.waiting} · Failed: ${s.failed}${s.last_error ? ' · Last problem: ' + esc(s.last_error) : ''}</span>` : ''}</p>
      ${s.connected ? `<p>Google Meet: ${s.meet_ready ? pill('ready', 'ok') : pill('press Reconnect Google Drive to allow it', 'warn')}</p>` : ''}${s.pull_error ? `<p class="err">Could not read changes from Drive: ${esc(s.pull_error)}</p>` : ''}
      ${cfgForm(`<label>OAuth Client ID</label><input name="client_id" value="${esc(s.client_id)}" autocomplete="off" data-lpignore="true"><label>OAuth Client secret ${s.has_secret ? '(saved — leave blank to keep)' : ''}</label>${cfgSecret('client_secret', s.has_secret)}`)}
      <div class="row">${s.configured ? `<a class="btn gold" href="${P}/storage/connect">${s.connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}</a>` : ''}${s.connected ? '<button class="btn ghost" id="sync">Sync now</button><button class="btn ghost" id="disc">Disconnect</button>' : ''}</div></div>
    ${s.connected ? `<div class="card"><h2>Google Contacts</h2><p>Status: ${ct.ready ? pill('ready', 'ok') + ` <span class="mute">${ct.linked} client(s) linked${ct.error ? ' · last problem: ' + esc(ct.error) : ''}</span>` : pill('permission needed — Reconnect Google Drive', 'warn')}</p>
      ${ct.ready ? `<p><button class="btn" id="cts">Sync contacts now</button> <label class="chk" style="display:inline-flex"><input type="checkbox" id="cta" ${ct.auto ? 'checked' : ''}> Keep in sync automatically</label></p>` : ''}</div>` : ''}
    <div class="card"><h2>One-time Google set-up (done once for this firm's Google account)</h2><ol>
      <li>console.cloud.google.com › new project. Enable Google Drive API, Google Calendar API, Google Meet REST API and People API.</li>
      <li>OAuth consent screen: External; add the account's e-mail; scopes <b>.../auth/drive</b>, <b>.../auth/calendar.events</b>, <b>.../auth/meetings.space.created</b>, <b>.../auth/meetings.space.readonly</b>, and the contacts scope.</li>
      <li>Credentials › OAuth client ID › Web application › Authorised redirect URI exactly:<br><input readonly value="${esc(s.redirect_uri)}" onclick="this.select()"></li>
      <li>Paste the Client ID and secret above, Save, then Connect. Google shows “not verified” (it is the firm's own private app): Advanced › Go to … › Allow.</li></ol></div>`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/storage', { client_id: f.client_id.value.trim(), client_secret: f.client_secret.value.trim() }); };
  const sy = $('#sync'); if (sy) sy.onclick = async () => { try { const r = await POST(P + '/storage/sync'); toast(`Synced ${r.done}, failed ${r.failed}.`, r.failed > 0); go(); } catch (x) { toast(x.message, true); } };
  const d = $('#disc'); if (d) d.onclick = async () => { if (sure('Disconnect Google Drive for this firm?')) { await POST(P + '/storage/disconnect'); go(); } };
  const cts = $('#cts'); if (cts) cts.onclick = async () => { try { cts.disabled = true; const r = await POST(P + '/contacts/sync'); toast(`Contacts synced — ${r.created_in_google || 0} added, ${r.linked || 0} linked.`); go(); } catch (x) { toast(x.message, true); cts.disabled = false; } };
  const cta = $('#cta'); if (cta) cta.onchange = () => PUT(P + '/contacts', { auto: cta.checked }).catch((x) => toast(x.message, true));
}

/* ---- nightly case arguments / research ---- */
async function cfgArgs(id, P, body) {
  const a = await GET(P + '/args-admin');
  body(`<div class="card"><h2>Case arguments and judgment research</h2><p class="mute">Runs at 3 am for open cases that have documents. Uses Claude tokens and web search; the limit below caps the cost per night.</p>
    ${cfgForm(`<label class="chk"><input type="checkbox" name="auto" ${a.auto ? 'checked' : ''}> Prepare and refresh arguments nightly</label>
      <label class="chk"><input type="checkbox" name="research" ${a.research ? 'checked' : ''}> Search for supporting and adverse judgments (tribunal first, India only)</label>
      <label>Most cases per night</label><input name="cap" type="number" min="1" max="40" value="${esc(a.cap)}" style="max-width:8rem">
      <label>Model for this work (blank = the firm's default)</label><input name="model" value="${esc(a.model)}">`)}</div>`);
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/args-admin', { auto: f.auto.checked, research: f.research.checked, cap: f.cap.value, model: f.model.value }); };
}

/* ---- birthday greetings, holiday list, weather city on the start page ---- */
async function cfgCal(id, P, body) {
  const [S, w] = await Promise.all([GET(P + '/calendar/settings'), GET(P + '/wx')]);
  body(`<div class="card"><h2>Start page weather</h2><p class="mute">Shown on the firm's start page with the live India time. Currently: <b>${esc(w.city)}</b>.</p>
    <form id="wf" class="row"><input name="city" placeholder="City, e.g. Kolkata" style="max-width:16rem" value="${esc(w.city)}"><button class="btn">Set city</button></form></div>
    <div class="card"><h2>Birthday greetings</h2>${cfgForm(`<label class="chk"><input type="checkbox" name="auto" ${S.auto ? 'checked' : ''}> Send greetings automatically (every morning after 9 am)</label>
      <label class="chk"><input type="checkbox" name="email" ${S.email ? 'checked' : ''}> by e-mail</label><label class="chk"><input type="checkbox" name="wa" ${S.wa ? 'checked' : ''}> by WhatsApp ${S.wa_api ? '' : '<span class="mute">(API not connected)</span>'}</label>
      <label>E-mail subject</label><input name="subject" value="${esc(S.subject)}"><label>Message — use {name} and {firm}</label><textarea name="msg" rows="5">${esc(S.msg)}</textarea>`)}</div>
    <div class="card"><h2>Holiday list</h2><p class="mute">Updated automatically every month${S.refreshed ? '. Last update: ' + esc(String(S.refreshed).slice(0, 10)) + ' (' + esc(S.source) + ')' : ''}.</p><button class="btn ghost" id="rf">Update the holiday list now</button></div>`);
  $('#wf').onsubmit = async (e) => { e.preventDefault(); try { const r = await PUT(P + '/wx', { city: e.target.city.value }); toast('Weather city set to ' + r.city); go(); } catch (x) { toast(x.message, true); } };
  const f = $('#cf');
  f.onsubmit = (e) => { e.preventDefault(); cfgSave(P, '/calendar/settings', { auto: f.auto.checked, email: f.email.checked, wa: f.wa.checked, subject: f.subject.value, msg: f.msg.value }); };
  $('#rf').onclick = async (e) => { e.target.disabled = true; try { const r = await POST(P + '/calendar/refresh'); toast(`Updated (${r.count} entries, ${r.source}).`); go(); } catch (x) { toast(x.message, true); e.target.disabled = false; } };
}
