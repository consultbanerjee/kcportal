'use strict';
/* ===== helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (p) => '₹' + ((p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s) => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const dtm = (s) => s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
const STATUS_PILL = { paid: 'ok', confirmed: 'ok', sent: '', part_paid: 'warn', draft: 'warn', awaiting_payment: 'warn', cancelled: 'bad', expired: 'bad', open: 'ok', closed: '', matched: 'ok', suggested: 'warn', unmatched: 'warn', ignored: '' };
const sp = (s) => pill(String(s).replace(/_/g, ' '), STATUS_PILL[s] || '');

let ME = null, FIRM = 'KC LEGAL', FIRMQ = '', FEAT = {};
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
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/me')) { ME = null; location.hash = '#/login'; throw new Error('Please sign in.'); }
  if (!r.ok) throw new Error((j && j.error) || 'Something went wrong.');
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
  else inp = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}"${req} ${f.step ? `step="${f.step}"` : ''} ${f.accept ? `accept="${f.accept}"` : ''} placeholder="${esc(f.ph || '')}" ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
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
function sheetFor(T, inner) {
  const s = T.settings, lh = T.has_letterhead, pg = PAGES[s.page_size] || PAGES.a4;
  const font = s.font === 'serif' ? 'Georgia,"Bookman Old Style",serif' : 'Poppins,"Helvetica Neue",Arial,sans-serif';
  const contact = [s.phone, s.email, s.website].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const art = lh ? `<img class="lh" src="/api/template/letterhead?v=${T.v}" alt="">` : `<div class="topbar"></div><div class="botbar"></div>`;
  const text = lh ? '' : `<div class="thead"><div class="tname">${esc(s.header_name)}</div>${s.tagline ? `<div class="ttag">${esc(s.tagline)}</div>` : ''}${s.address ? `<div class="tcon">${esc(s.address)}</div>` : ''}${contact ? `<div class="tcon">${contact}</div>` : ''}</div>`;
  const top = lh ? s.top_mm : 16, bot = lh ? s.bottom_mm : 12, l = s.left_mm ?? s.side_mm ?? 20, r = s.right_mm ?? s.side_mm ?? 20;
  // the table's header/footer rows repeat on every printed page, so the top/bottom margin holds on page 2, 3 ...
  return `<style>@page{size:${pg[0]};margin:0}</style><div class="sheet" style="--pri:${s.primary};--acc:${s.accent};--ttl:${s.title_color};--pw:${pg[1]}mm;--ph:${pg[2]}mm;font-family:${font}">${art}<table class="flow"><thead><tr><td style="height:${top}mm"></td></tr></thead><tfoot><tr><td style="height:${bot}mm"></td></tr></tfoot><tbody><tr><td class="sbody" style="padding:0 ${r}mm 0 ${l}mm">${text}${inner}</td></tr></tbody></table></div>`;
}
const signBlock = (s) => `<div class="isign"><div>For <b>${esc(s.header_name)}</b></div><div class="gap"></div><div>Authorised Signatory${s.signatory_name ? `<br>${esc(s.signatory_name)}${s.signatory_title ? ', ' + esc(s.signatory_title) : ''}` : ''}</div></div>`;

/* ===== router ===== */
const routes = [];
const route = (re, fn, opts = {}) => routes.push({ re, fn, ...opts });
const view = (html) => { const v = $('#view'); if (v) { v.innerHTML = html; window.scrollTo(0, 0); } return v; };
function on(root, ev, sel, fn) { root.addEventListener(ev, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); }); }

function navItems() {
  if (ME.role === 'superadmin') return [['#/firms', 'Firms'], ['#/account', 'Account']];
  if (isClient()) return [['#/', 'Home'], ['#/matters', 'My cases'], ['#/letters', 'Letters'], ['#/messages', 'Messages'], ['#/invoices', 'Fees'], ['#/book', 'Book']];
  const r = ME.role, n = [['#/', 'Home']];
  if (r !== 'accounts') n.push(['#/clients', 'Clients']);
  if (['admin', 'advocate', 'staff'].includes(r)) n.push(['#/matters', 'Matters']);
  if (r === 'accounts') n.push(['#/clients', 'Clients']);
  n.push(['#/tasks', 'Tasks']);
  if (['admin', 'advocate', 'staff'].includes(r)) n.push(['#/letters', 'Letters'], ['#/dak', 'Inward']);
  if (FEAT.drafting && ['admin', 'advocate', 'staff'].includes(r)) n.push(['#/draft', 'AI Drafting']);
  if (FEAT.email && ['admin', 'advocate', 'staff'].includes(r)) n.push(['#/mail', 'Mail']);
  if (FEAT.chat && ['admin', 'advocate', 'staff', 'telecaller'].includes(r)) n.push(['#/chats', 'Chats']);
  if (r !== 'accounts') n.push(['#/messages', 'Messages']);
  if (['admin', 'advocate', 'staff', 'telecaller'].includes(r)) n.push(['#/leads', 'Leads']);
  if (r !== 'accounts') n.push(['#/appointments', 'Calls']);
  if (['admin', 'advocate', 'accounts'].includes(r)) n.push(['#/billing', 'Billing']);
  if (r !== 'telecaller' && r !== 'accounts') n.push(['#/judgments', 'Judgments']);
  if (r === 'admin') n.push(['#/team', 'Team'], ['#/ai', 'AI Control'], ['#/template', 'Design'], ['#/settings', 'Settings']);
  return n;
}
function layout() {
  const items = navItems(), cur = location.hash.split('?')[0] || '#/';
  const active = (h) => (h === '#/' ? cur === '#/' || cur === '' : cur.startsWith(h) || cur.startsWith(h.replace(/s$/, ''))) ? 'on' : '';
  $('#app').innerHTML = `<div class="shell"><nav class="side"><div class="brand">${esc(FIRM)}<small>${ME.role === 'superadmin' ? 'SUPER ADMIN' : isClient() ? 'CLIENT PORTAL' : 'OFFICE PORTAL'}</small></div>
    ${items.map(([h, l]) => `<a href="${h}" class="${active(h)}">${l}</a>`).join('')}
    <div class="who">${esc(ME.name)}<br><a href="#/account" style="padding:0;display:inline">Account</a> · <a href="#/logout" style="padding:0;display:inline">Sign out</a></div></nav>
    <div style="flex:1;min-width:0"><div class="top"><b>${esc(FIRM)}</b><span><a href="#/account">${esc(ME.name.split(' ')[0])}</a> · <a href="#/logout">Sign out</a></span></div>
    <main class="main" id="view"></main></div>
    <nav class="bottom">${items.slice(0, isClient() ? 6 : 12).map(([h, l]) => `<a href="${h}" class="${active(h)}">${l}</a>`).join('')}</nav></div>`;
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
      if (ME.role === 'superadmin' && !['/firms', '/account', '/logout'].includes(path)) { location.hash = '#/firms'; return; }
      if (r.roles && !r.roles.includes(ME.role)) { layout(); view('<div class="card">You do not have access to this page.</div>'); return; }
      if (r.office && isClient()) { location.hash = '#/'; return; }
      if (r.client && !isClient()) { location.hash = '#/'; return; }
      layout();
    }
    try { view('<p class="mute">Loading…</p>'); if (r.public) $('#app').innerHTML = ''; await r.fn(m.slice(1), new URLSearchParams(hash.split('?')[1] || ''), tok); }
    catch (e) { if (tok === navToken && $('#view')) view(`<div class="card"><p class="err">${esc(e.message)}</p></div>`); else if (tok === navToken) toast(e.message, true); }
    return;
  }
  view('<div class="card">Page not found.</div>');
}
window.addEventListener('hashchange', go);

/* ===== auth views ===== */
function authShell(inner) {
  $('#app').innerHTML = `<div class="login"><div class="pubhead"><h1 style="margin:0">${esc(FIRM)}</h1></div><div class="card">${inner}</div>
    <p class="mute" style="text-align:center"><a href="#/book${FIRMQ ? '?firm=' + encodeURIComponent(FIRMQ) : ''}">Book a paid online consultation</a></p></div>`;
}
route(/^\/login$/, async () => {
  if (ME) { location.hash = '#/'; return; }
  authShell(`<h2>Sign in</h2><form id="lf"><label>Email</label><input name="email" type="email" autocomplete="username" required>
    <label>Password</label><input name="password" type="password" autocomplete="current-password" required><p class="err" hidden></p>
    <div style="margin-top:1rem"><button class="btn" style="width:100%">Sign in</button></div></form>
    <p class="mute" style="margin-top:1rem">Clients receive a private invitation link from the office to set their password.</p>`);
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('.err', f), b = $('button', f); b.disabled = true; err.hidden = true;
    try { await POST('/api/login', { email: f.email.value, password: f.password.value }); await loadMe(); location.hash = '#/'; go(); }
    catch (ex) { err.hidden = false; err.textContent = ex.message; b.disabled = false; }
  };
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

route(/^\/logout$/, async () => { try { await POST('/api/logout'); } catch (e) {} ME = null; location.hash = '#/login'; }, { public: true });

route(/^\/account$/, async () => {
  view(`<h1>Account</h1><div class="card"><b>${esc(ME.name)}</b><div class="mute">${esc(ME.email)} · ${esc(ME.role)}</div></div>
    <div class="card"><h2>Change password</h2><button class="btn" id="cp">Change password</button></div>`);
  $('#cp').onclick = () => ask('Change password', [
    { name: 'current', label: 'Current password', type: 'password', required: true },
    { name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters with letters and numbers.' }],
    'Change', async (v) => { await POST('/api/password', { current: v.current, next: v.next }); toast('Password changed.'); });
});

async function loadMe() { const r = await GET('/api/me'); ME = r.user; FIRM = r.tenant.name; FEAT = {}; if (ME && ME.role !== 'client' && ME.role !== 'superadmin') { try { FEAT = await GET('/api/features'); } catch (e) {} } }
