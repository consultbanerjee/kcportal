'use strict';
/* ===== helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (p) => '₹' + ((p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INV_SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['due', 'Highest balance due'], ['amt', 'Highest amount'], ['no', 'Invoice no. (A-Z)']];
const sortInv = (rows, k) => { const r = rows.slice(), d = (i) => (i.inv_date || ''), due = (i) => ['draft', 'cancelled'].includes(i.status) ? 0 : i.total_paise - i.paid_paise;
  const f = { new: (x, y) => d(y).localeCompare(d(x)) || String(y.inv_no).localeCompare(String(x.inv_no)), old: (x, y) => d(x).localeCompare(d(y)) || String(x.inv_no).localeCompare(String(y.inv_no)), due: (x, y) => due(y) - due(x), amt: (x, y) => y.total_paise - x.total_paise, no: (x, y) => String(x.inv_no).localeCompare(String(y.inv_no)) }[k] || null; return f ? r.sort(f) : r; };
const invSortSel = (k) => `<select id="invsort" class="sm" aria-label="Sort invoices" style="max-width:190px">${INV_SORTS.map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const invSortKey = () => { try { return localStorage.getItem('kc_invsort') || 'new'; } catch (e) { return 'new'; } };
const invSortSave = (k) => { try { localStorage.setItem('kc_invsort', k); } catch (e) {} };
const dt = (s) => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const dtm = (s) => s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
const STATUS_PILL = { tagged: 'ok', paid: 'ok', confirmed: 'ok', sent: '', part_paid: 'warn', draft: 'warn', awaiting_payment: 'warn', cancelled: 'bad', expired: 'bad', open: 'ok', closed: '', matched: 'ok', suggested: 'warn', unmatched: 'warn', ignored: '' };
const sp = (s) => pill(String(s).replace(/_/g, ' '), STATUS_PILL[s] || '');

let ME = null, FIRM = 'KC LEGAL', FIRMQ = '', FEAT = {}, MODS = { off: [], powered: '', product: '' };
const isClient = () => ME && ME.role === 'client';
const can = (...roles) => ME && roles.includes(ME.role);

function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3200);
}

async function api(method, url, body) {
  const opt = { method, headers: { 'X-Requested-With': 'kcportal' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch (e) { throw new Error('No connection. Please check your internet and try again.'); }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (r.status === 403 && ME && ME.role === 'client' && !url.startsWith('/api/login')) { const j403 = await r.clone().json().catch(() => ({})); if (j403.blocked) { ME = null; location.hash = '#/login'; toast(j403.error, true); throw new Error(j403.error); } }
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/me')) { ME = null; location.hash = '#/login'; throw new Error('Please sign in.'); }
  if (!r.ok) { const er = new Error((j && j.error) || 'Something went wrong.'); if (j && j.choices) er.choices = j.choices; if (j && j.need_code) er.need_code = true; throw er; }
  return j;
}
const GET = (u) => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b), PATCH = (u, b) => api('PATCH', u, b), DEL = (u) => api('DELETE', u);
const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

/* ===== modal form ===== */
function fieldHtml(f) {
  const v = f.value ?? '', id = 'f_' + f.name, req = f.required ? ' required' : '';
  if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  let inp;
  if (f.type === 'textarea') inp = `<textarea id="${id}" name="${f.name}"${req} placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else if (f.type === 'select') inp = `<select id="${id}" name="${f.name}"${req}>${(f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  else inp = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}"${req} ${f.step ? `step="${f.step}"` : ''} ${f.accept ? `accept="${f.accept}"` : ''} placeholder="${esc(f.ph || '')}" ${f.type === 'password' ? 'autocomplete="new-password"' : ''} ${f.list ? `list="dl_${f.name}"` : ''}>${f.list ? `<datalist id="dl_${f.name}">${f.list.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
  return `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${inp}${f.hint ? `<div class="mute">${esc(f.hint)}</div>` : ''}`;
}
function ask(title, fields, okLabel, fn, wide) {
  return new Promise((resolve) => {
    const o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate><h3>${esc(title)}</h3>${fields.map(fieldHtml).join('')}
      <p class="err" hidden></p><div class="row end" style="margin-top:1rem"><button type="button" class="btn ghost" data-x>Cancel</button>${okLabel ? `<button class="btn">${esc(okLabel)}</button>` : ''}</div></form>`;
    document.body.appendChild(o);
    const form = $('form', o), err = $('.err', o);
    const close = (v) => { o.remove(); resolve(v); };
    $('[data-x]', o).onclick = () => close(false);
    o.addEventListener('mousedown', (e) => { if (e.target === o) close(false); });
    const first = $('input,select,textarea', form); if (first) first.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        vals[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'file' ? el.files[0] : el.value.trim ? el.value.trim() : el.value;
        if (f.required && (vals[f.name] === '' || vals[f.name] == null || vals[f.name] === false && f.type !== 'checkbox')) { err.hidden = false; err.textContent = f.label + ' is required.'; el.focus(); return; }
      }
      const btn = $('.btn:not(.ghost)', form); if (btn) btn.disabled = true; err.hidden = true;
      try { await fn(vals); close(true); } catch (ex) { err.hidden = false; err.textContent = ex.message; if (btn) btn.disabled = false; }
    };
  });
}
function show(title, html, wide) {
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="row sp"><h3>${esc(title)}</h3><button class="btn ghost sm" data-x>Close</button></div>${html}</div>`;
  document.body.appendChild(o);
  const close = () => o.remove();
  $('[data-x]', o).onclick = close; o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
  return { el: o, close };
}
const sure = (msg) => confirm(msg);


/* ===== document template (letter pad) used by invoices, receipts, letters ===== */
let TPLC = null;
async function getTpl(force) { if (!TPLC || force) TPLC = await GET('/api/template'); return TPLC; }
function inWords(paise) {
  const n = Math.round((paise || 0) / 100), ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'], tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  if (!n) return 'Zero Rupees Only';
  const parts = []; let r = n;
  [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']].forEach(([v, name]) => { if (r >= v) { parts.push(three(Math.floor(r / v)) + ' ' + name); r %= v; } });
  if (r) parts.push(three(r));
  return 'Rupees ' + parts.join(' ') + ' Only';
}
const PAGES = { a4: ['A4', 210, 297], legal: ['legal', 216, 356], letter: ['letter', 216, 279] };
const tplUrl = (T, k) => { const v = k === 'letterhead' ? T.v : k === 'logo' ? T.lv : k === 'qr' ? T.qv : T.sv; return T.pub ? `/api/public/invoice/${T.pub}/asset/${k}?v=${v}` : `/api/template/${k}?v=${v}`; };
function sheetFor(T, inner) {
  const s = T.settings, lh = T.has_letterhead, pg = PAGES[s.page_size] || PAGES.a4;
  const font = s.font === 'serif' ? 'Georgia,"Bookman Old Style",serif' : 'Poppins,"Helvetica Neue",Arial,sans-serif';
  const contact = [s.phone, s.email, s.website].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const art = lh ? `<img class="lh" src="${tplUrl(T, 'letterhead')}" alt="">` : `<div class="topbar"></div><div class="botbar"></div>`;
  const text = lh ? '' : `<div class="thead">${T.has_logo ? `<img class="tlogo" src="${tplUrl(T, 'logo')}" alt="">` : ''}<div class="tname">${esc(s.header_name)}</div>${s.tagline ? `<div class="ttag">${esc(s.tagline)}</div>` : ''}${s.address ? `<div class="tcon">${esc(s.address)}</div>` : ''}${contact ? `<div class="tcon">${contact}</div>` : ''}</div>`;
  const top = lh ? s.top_mm : 16, bot = lh ? s.bottom_mm : 12, l = s.left_mm ?? s.side_mm ?? 20, r = s.right_mm ?? s.side_mm ?? 20;
  // the table's header/footer rows repeat on every printed page, so the top/bottom margin holds on page 2, 3 ...
  return `<style>@page{size:${pg[0]};margin:0}</style><div class="sheet" style="--pri:${s.primary};--acc:${s.accent};--ttl:${s.title_color};--pw:${pg[1]}mm;--ph:${pg[2]}mm;font-family:${font}">${art}${s.inv_hide_footer && String(inner).includes('class="vi"') ? '<div class="fmask"></div>' : ''}<table class="flow"><thead><tr><td style="height:${top}mm"></td></tr></thead><tfoot><tr><td style="height:${bot}mm"></td></tr></tfoot><tbody><tr><td class="sbody" style="padding:0 ${r}mm 0 ${l}mm">${text}${inner}</td></tr></tbody></table></div>`;
}
const signBlock = (s) => `<div class="isign"><div>For <b>${esc(s.header_name)}</b></div><div class="gap"></div><div>Authorised Signatory${s.signatory_name ? `<br>${esc(s.signatory_name)}${s.signatory_title ? ', ' + esc(s.signatory_title) : ''}` : ''}</div></div>`;

/* ===== router ===== */
const routes = [];
const route = (re, fn, opts = {}) => routes.push({ re, fn, ...opts });
const view = (html) => { const v = $('#view'); if (v) { v.innerHTML = html; window.scrollTo(0, 0); } return v; };
function on(root, ev, sel, fn) { root.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); }); }

// Each item is [href, label, group]. Items with a group are shown under that group's heading in the left panel.
function navItems() {
  if (ME.role === 'superadmin') return [['#/firms', 'Firms and services'], ['#/journal', 'Build Journal'], ['#/account', 'Account']];
  if (isClient()) return [['#/', 'Home'], ['#/matters', 'My cases'], ['#/myfiles', 'My files'], ['#/letters', 'Letters'], ['#/messages', 'Messages'], ['#/livechat', 'Live chat'], ['#/invoices', 'Fees'], ['#/book', 'Book']];
  const r = ME.role, LG = 'Litigation', n = [['#/', 'Home']], pro = ['admin', 'advocate', 'staff'].includes(r), mod = (k) => !(MODS.off || []).includes(k);
  n.push(['#/clients', 'Clients', LG]);
  if (pro) n.push(['#/matters', 'Cases', LG]);
  if (pro && FEAT.courtdata) n.push(['#/ecourts', 'Court search', LG], ['#/causelist', 'Cause list', LG]);
  n.push(['#/tasks', 'Tasks', LG], ['#/moves', 'File movement', LG]);
  if (mod('calendar')) n.push(['#/calendar', 'Calendar', LG]);
  if (pro || r === 'accounts') n.push(['#/files', 'Files', LG]);
  if (pro) n.push(['#/letters', 'Letters', LG], ['#/register', 'In-Out Register', LG]);
  if (FEAT.drafting && pro) n.push(['#/draft', 'AI Drafting', LG]);
  if (pro) n.push(['#/limitation', 'Limitation', LG]);
  if (r !== 'accounts') n.push(['#/messages', 'Messages', LG]);
  if (FEAT.email && pro) n.push(['#/mail', 'Mail', 'CRM']);
  if (FEAT.chat && [...['admin', 'advocate', 'staff'], 'telecaller'].includes(r)) n.push(['#/chats', 'Chats', 'CRM']);
  if (mod('crm')) {
    if (['admin', 'advocate', 'staff', 'telecaller'].includes(r)) n.push(['#/followups', 'Follow-ups', 'CRM'], ['#/tickets', 'Tickets', 'CRM'], ['#/leads', 'Leads', 'CRM']);
    if (r !== 'accounts') n.push(['#/appointments', 'Calls', 'CRM']);
  }
  if (pro) n.push(['#/consents', 'Consents', 'CRM']);
  if (mod('accounts') && ['admin', 'advocate', 'accounts'].includes(r)) n.push(['#/accounts', 'Accounts']);
  if (mod('judgments') && r !== 'telecaller' && r !== 'accounts') n.push(['#/judgments', 'Judgments']);
  if (mod('repository')) REPO_CATS.forEach(([sl, nm]) => n.push(['#/repository/' + sl, nm, 'Repository']));
  if (r === 'admin') n.push(['#/alerts', 'Alerts', 'Settings'], ['#/template', 'Design', 'Settings'], ['#/team', 'Team', 'Settings'], ['#/settings', 'Firm settings', 'Settings'], ['#/plan', 'Plan and usage', 'Settings']);
  return n;
}
const REPO_CATS = [['all', 'All sections'], ['courts', 'Courts'], ['high-courts', 'All High Courts'], ['tribunals', 'Tribunals'], ['forums', 'Forums'], ['authorities', 'Authorities'], ['legislatures', 'Parliament and Assemblies'], ['intl-india', 'International courts (India)'], ['intl-other', 'International courts (other)'], ['elibrary', 'eLibrary & Research'], ['govt-repos', 'Government repositories'], ['news-world', 'Newspapers: world'], ['news-india', 'Newspapers: India'], ['news-legal', 'Legal news'], ['central-services', 'Central Govt Services'], ['wb-services', 'West Bengal Govt Services'], ['bodies', 'Professional bodies']];
const REPO_MAP = { courts: 'Courts', 'high-courts': 'All High Courts', tribunals: 'Tribunals', forums: 'Forums (consumer, ADR and grievance)', authorities: 'Authorities and commissions', legislatures: 'Parliament and Legislatures', 'intl-india': 'International courts with a link to India', 'intl-other': 'International courts and bodies (no jurisdiction over India)', elibrary: 'eLibrary & Research', 'govt-repos': 'Government repositories (public)', 'news-world': 'Newspapers — world (free to read)', 'news-india': 'Newspapers — India', 'news-legal': 'News and legal updates', 'central-services': 'Central Government Services', 'wb-services': 'West Bengal Government Services', bodies: 'Professional bodies' };
function navHtml(items, active) {
  let out = '', last = null, gi = 0;
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('kc-nav-' + k); localStorage.setItem('kc-nav-' + k, v); } catch (e) {} };
  const open = (g) => items.some(([h, , gg]) => gg === g && active(h)) || store(g) === '1';
  for (const [h, l, g] of items) {
    if (g && g !== last) {
      if (last) out += '</div>';
      const o = open(g);
      out += `<div class="ngrp tg" role="button" tabindex="0" data-g="${esc(g)}" aria-expanded="${o}">${esc(g)} <span class="car">${o ? '▾' : '▸'}</span></div><div class="gbody" ${o ? '' : 'hidden'}>`;
    }
    if (!g && last) { out += '</div><div class="ngrp" style="padding:0;height:6px"></div>'; }
    last = g || null;
    out += `<a href="${h}" class="${active(h)}${g ? ' sub' : ''}">${l}</a>`;
  }
  if (last) out += '</div>';
  return out;
}
function layout() {
  const items = navItems(), cur = location.hash.split('?')[0] || '#/';
  const active = (h) => (h === '#/' ? cur === '#/' || cur === '' : cur.startsWith(h) || cur.startsWith(h.replace(/s$/, ''))) ? 'on' : '';
  $('#app').innerHTML = `<div class="shell"><nav class="side"><div class="brand">${TPLC && TPLC.has_logo ? `<img class="blogo" src="/api/template/logo?v=${TPLC.lv}" alt="">` : ''}${esc(FIRM)}<small>${ME.role === 'superadmin' ? 'SUPER ADMIN' : isClient() ? 'CLIENT PORTAL' : 'OFFICE PORTAL'}</small></div>
    ${navHtml(items, active)}
    <div class="who">${esc(ME.name)}<br><a href="#/account" style="padding:0;display:inline">Account</a> · <a href="#/logout" style="padding:0;display:inline">Sign out</a></div></nav>
    <div style="flex:1;min-width:0"><div class="top"><b>${esc(FIRM)}</b><span><a href="#/account">${esc(ME.name.split(' ')[0])}</a> · <a href="#/logout">Sign out</a></span></div>
    <main class="main" id="view"></main>${MODS.powered ? `<div class="mute noprint" style="text-align:center;padding:.6rem;font-size:.78rem">${esc(MODS.powered)}</div>` : ''}</div>
    <nav class="bottom">${items.slice(0, isClient() ? 6 : 14).map(([h, l]) => `<a href="${h}" class="${active(h)}">${l}</a>`).join('')}</nav></div>`;
  $$('.side .tg').forEach((t) => { const tg = () => { const b = t.nextElementSibling, o = b.hidden; b.hidden = !o; t.setAttribute('aria-expanded', o); $('.car', t).textContent = o ? '▾' : '▸'; try { localStorage.setItem('kc-nav-' + t.dataset.g, o ? '1' : '0'); } catch (e) {} }; t.onclick = tg; t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tg(); } }; });
  if (ME.role === 'admin') GET('/api/alerts/count').then((c) => { const a = $('.side a[href="#/alerts"]'); if (a && c.open && !$('.abadge', a)) a.insertAdjacentHTML('beforeend', ` <span class="abadge${c.high ? ' hi' : ''}">${c.open}</span>`); }).catch(() => {});
  // firm logo in the side brand (loaded once; harmless if the firm has none)
  getTpl().then((t) => { const b = $('.side .brand'); if (t && t.has_logo && b && !$('.blogo', b)) b.insertAdjacentHTML('afterbegin', `<img class="blogo" src="/api/template/logo?v=${t.lv}" alt="">`); }).catch(() => {});
}

let navToken = 0;
async function go() {
  const tok = ++navToken;
  const hash = location.hash.replace(/^#/, '') || '/';
  const path = hash.split('?')[0];
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    if (!r.public) {
      if (!ME) { location.hash = '#/login'; return; }
      if (ME.role === 'superadmin' && !/^\/(firms|account|logout|journal|fcfg\/\d+)$/.test(path)) { location.hash = '#/firms'; return; }
      if (r.roles && !r.roles.includes(ME.role)) { layout(); view('<div class="card">You do not have access to this page.</div>'); return; }
      if (r.office && isClient()) { location.hash = '#/'; return; }
      if (r.client && !isClient()) { location.hash = '#/'; return; }
      layout();
    }
    try { view('<p class="mute">Loading…</p>'); if (r.public) $('#app').innerHTML = ''; await r.fn(m.slice(1), new URLSearchParams(hash.split('?')[1] || ''), tok); }
    catch (e) { if (tok === navToken && $('#view')) view(`<div class="card"><p class="err">${esc(e.message)}</p></div>`); else if (tok === navToken) toast(e.message, true); }
    return;
  }
  if (!ME) { location.hash = '#/login'; return; }
  if (ME.role === 'superadmin' && !/^\/(firms|account|logout|journal|fcfg\/\d+)$/.test(path)) { location.hash = '#/firms'; return; }
  layout(); view('<div class="card">Page not found.</div>');
}
window.addEventListener('hashchange', go);

/* ===== auth views ===== */
function authShell(inner) {
  $('#app').innerHTML = `<div class="login"><div class="pubhead"><h1 style="margin:0">${esc(FIRM)}</h1></div><div class="card">${inner}</div></div>`;
}
const LOGIN_KINDS = {
  client: { h: 'Client Login', p: 'Clients receive a private invitation link from the office to set their password.' },
  firm: { h: 'Law Firm Login', p: 'For advocates and office staff of the firm.' },
  admin: { h: 'Administrator Login', p: 'Restricted to firm administrators.' },
};
route(/^\/login(?:\/(client|firm|admin))?$/, async ([kind]) => {
  if (ME) { location.hash = '#/'; return; }
  const hq = (location.hash.split('?')[1] || ''); const qf = new URLSearchParams(hq).get('firm'); if (qf) FIRMQ = qf;
  if (FIRMQ) { try { const pf = await GET('/api/public/firm?firm=' + encodeURIComponent(FIRMQ)); if (pf && pf.name) FIRM = pf.name; } catch (e) {} }
  const k = LOGIN_KINDS[kind] || { h: 'Login', p: 'One login for everyone: clients, advocates, staff, administrators and law firms. After you sign in you are taken to your own pages. New clients receive a private invitation link from the office to set a password.' };
  authShell(`<h2>${k.h}</h2><form id="lf"><label>Email</label><input name="email" type="email" autocomplete="username" required>
    <label>Password</label><input name="password" type="password" autocomplete="current-password" required><div id="cdw" hidden><label>6-digit code from your authenticator app</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"></div><p class="err" hidden></p>
    <div style="margin-top:1rem"><button class="btn" style="width:100%">Sign in</button></div></form>
    <p style="margin:.8rem 0 0"><a href="#/forgot${FIRMQ ? '?firm=' + encodeURIComponent(FIRMQ) : ''}">Forgot password?</a></p>`);
  const doLogin = async (f, firm) => { await POST('/api/login', { email: f.email.value, password: f.password.value, code: f.code ? f.code.value : '', as: kind || '', firm: firm || FIRMQ || '' }); try { Object.keys(localStorage).filter((k) => k.startsWith('kc-nav-')).forEach((k) => localStorage.removeItem(k)); } catch (e) {} await loadMe(); location.hash = '#/'; go(); };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('.err', f), b = $('button', f); b.disabled = true; err.hidden = true;
    try { await doLogin(f); }
    catch (ex) {
      if (ex.choices) {
        err.hidden = false; err.innerHTML = 'This email is registered with more than one firm. Which firm do you want to open?<br>' + ex.choices.map((c) => `<button type="button" class="btn ghost pick" data-s="${esc(c.slug)}" style="margin:.3rem .3rem 0 0">${esc(c.name)}</button>`).join('');
        $$('.pick', f).forEach((x) => { x.onclick = async () => { try { await doLogin(f, x.dataset.s); } catch (e2) { err.textContent = e2.message; } }; });
      } else { err.hidden = false; err.textContent = ex.message; if (ex.need_code) { $('#cdw').hidden = false; f.code.focus(); } }
      b.disabled = false;
    }
  };
}, { public: true });

route(/^\/forgot$/, async () => {
  const qf = new URLSearchParams(location.hash.split('?')[1] || '').get('firm'); if (qf) FIRMQ = qf;
  authShell(`<h2>Forgot password</h2><p class="mute">Enter your email. If it is registered, we send a link to set a new password.</p>
    <form id="ff"><label>Email</label><input name="email" type="email" required><p class="err" hidden></p><div style="margin-top:1rem"><button class="btn" style="width:100%">Send link</button></div></form>
    <p style="margin-top:1rem"><a href="#/login${FIRMQ ? '?firm=' + encodeURIComponent(FIRMQ) : ''}">Back to login</a></p>`);
  $('#ff').onsubmit = async (e) => { e.preventDefault(); const f = e.target, err = $('.err', f); try { const r = await POST('/api/forgot', { email: f.email.value, firm: FIRMQ }); err.hidden = false; err.style.color = 'inherit'; err.textContent = r.message; } catch (ex) { err.hidden = false; err.textContent = ex.message; } };
}, { public: true });

route(/^\/invite\/([a-f0-9]+)$/, async ([tok]) => {
  let info; try { info = await GET('/api/invite/' + tok); } catch (e) { authShell(`<h2>Link not valid</h2><p>${esc(e.message)}</p><p class="mute">Ask the office to send a fresh invitation.</p>`); return; }
  authShell(`<h2>Welcome, ${esc(info.name)}</h2><p class="mute">Choose a password for ${esc(info.email)}. At least 10 characters with letters and numbers.</p>
    <form id="pf"><label>New password</label><input name="p1" type="password" autocomplete="new-password" required><label>Repeat password</label>
    <input name="p2" type="password" autocomplete="new-password" required><p class="err" hidden></p><div style="margin-top:1rem"><button class="btn" style="width:100%">Set password</button></div></form>`);
  $('#pf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('.err', f); err.hidden = true;
    if (f.p1.value !== f.p2.value) { err.hidden = false; err.textContent = 'The two passwords do not match.'; return; }
    try { await POST('/api/invite/' + tok, { password: f.p1.value }); toast('Password set. Please sign in.'); location.hash = '#/login'; }
    catch (ex) { err.hidden = false; err.textContent = ex.message; }
  };
}, { public: true });

route(/^\/logout$/, async () => { try { await POST('/api/logout'); } catch (e) {} ME = null; location.replace('/#/login'); location.reload(); }, { public: true });

route(/^\/account$/, async () => {
  const tf = await GET('/api/2fa').catch(() => ({ on: false }));
  view(`<h1>Account</h1><div class="card"><b>${esc(ME.name)}</b><div class="mute">${esc(ME.email)} · ${esc(ME.role)}</div></div>
    <div class="card"><h2>Change password</h2><button class="btn" id="cp">Change password</button></div>
    <div class="card"><h2>Two-step sign-in</h2><p class="mute">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) to your password. Strongly recommended for administrators.</p>
      <p>Status: ${tf.on ? pill('on', 'ok') : pill('off', 'warn')}</p><button class="btn ${tf.on ? 'ghost' : 'gold'}" id="tf">${tf.on ? 'Turn off' : 'Turn on'}</button></div>`);
  $('#cp').onclick = () => ask('Change password', [
    { name: 'current', label: 'Current password', type: 'password', required: true },
    { name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters with letters and numbers.' }],
    'Change', async (v) => { await POST('/api/password', { current: v.current, next: v.next }); toast('Password changed.'); });
  $('#tf').onclick = async () => {
    if (tf.on) { ask('Turn off two-step sign-in', [{ name: 'password', label: 'Password', type: 'password', required: true }, { name: 'code', label: 'Current 6-digit code', required: true }], 'Turn off', async (v) => { await POST('/api/2fa/disable', v); toast('Two-step sign-in is off.'); go(); }); return; }
    const r = await POST('/api/2fa/start');
    ask('Turn on two-step sign-in', [{ name: 'code', label: 'Enter the 6-digit code shown in the app', required: true, hint: 'Scan this QR in your authenticator app, or type the key: ' + r.secret }], 'Turn on', async (v) => { await POST('/api/2fa/enable', { code: v.code }); toast('Two-step sign-in is on.'); go(); });
    const m = $('.modal'); if (m) m.querySelector('h3').insertAdjacentHTML('afterend', `<div style="text-align:center"><img src="${r.qr}" alt="QR code" width="200" height="200"></div>`);
  };
});

/* application scripts are delivered only after sign-in (Super Admin scripts only to the Super Admin) */
let BUNDLED = false;
async function loadBundle() {
  if (BUNDLED || !ME) return;
  const files = (await GET('/api/bundle')).files || [];
  await Promise.all(files.map((n) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/x/' + n + '.js'; s.async = false; s.onload = ok; s.onerror = () => no(new Error('Could not load the application.')); document.body.appendChild(s); })));
  BUNDLED = true;
}
async function loadMe() { const r = await GET('/api/me'); ME = r.user; FIRM = r.tenant.name; FEAT = {}; MODS = { off: [], powered: '', product: '' }; if (ME) { try { MODS = await GET('/api/modules'); } catch (e) {} } if (ME && ME.role !== 'client' && ME.role !== 'superadmin') { try { FEAT = await GET('/api/features'); } catch (e) {} } if (ME) await loadBundle(); }
