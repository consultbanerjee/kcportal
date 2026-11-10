/* Embeddable website chat. Add to any page:  <script src="https://portal.example.com/chat.js?firm=SLUG" defer></script> */
(function () {
  'use strict';
  var s = document.currentScript; if (!s || window.__kcChat) return; window.__kcChat = 1;
  var u = new URL(s.src), API = u.origin, firm = u.searchParams.get('firm') || '', H = { 'Content-Type': 'application/json', 'X-Requested-With': 'kcportal' };
  var q = firm ? '?firm=' + encodeURIComponent(firm) : '', KEY = 'kcchat:' + firm;
  fetch(API + '/api/public/chat/config' + q).then(function (r) { return r.json(); }).then(function (c) { if (c && c.enabled) build(c); }).catch(function () {});
  function build(cfg) {
    var host = document.createElement('div'); host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000;font-family:system-ui,Segoe UI,Arial,sans-serif';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>*{box-sizing:border-box}.b{width:58px;height:58px;border-radius:50%;border:0;background:#1f2a44;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)}.p{display:none;position:absolute;right:0;bottom:70px;width:340px;max-width:calc(100vw - 28px);height:480px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);flex-direction:column;overflow:hidden}.p.o{display:flex}.h{background:#1f2a44;color:#fff;padding:12px 14px;font-weight:600;display:flex;justify-content:space-between}.h small{display:block;font-weight:400;opacity:.75;font-size:11px}.x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}.m{flex:1;overflow:auto;padding:12px;background:#f6f7fb}.r{margin:6px 0;display:flex}.r.u{justify-content:flex-end}.t{max-width:82%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;background:#fff;border:1px solid #e1e5ee;color:#1f2a44}.u .t{background:#1f2a44;color:#fff;border-color:#1f2a44}.bk{display:inline-block;margin:6px 0;padding:9px 14px;background:#f5a623;color:#1f2a44;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px}.f{display:flex;border-top:1px solid #e1e5ee}.f input{flex:1;border:0;padding:12px;font-size:14px;outline:0}.f button{border:0;background:#f5a623;color:#1f2a44;font-weight:700;padding:0 16px;cursor:pointer}.d{font-size:10.5px;color:#6b7488;padding:4px 10px;background:#fff;border-top:1px solid #eef0f6}</style><button class="b" aria-label="Chat with us">💬</button><div class="p"><div class="h"><div></div><button class="x" aria-label="Close">×</button></div><div class="m"></div><div class="d">Virtual assistant. General information only, not legal advice.</div><form class="f"><input maxlength="1000" placeholder="Type your message…" autocomplete="off"><button>Send</button></form></div>';
    var $ = function (x) { return root.querySelector(x); }, panel = $('.p'), msgs = $('.m'), inp = $('input'), tok = null, busy = false;
    $('.h div').innerHTML = '<span></span><small>Online assistant</small>'; $('.h span').textContent = cfg.name;
    try { tok = sessionStorage.getItem(KEY); } catch (e) {}
    function add(who, text) { var r = document.createElement('div'); r.className = 'r ' + who; var t = document.createElement('div'); t.className = 't'; t.textContent = text; r.appendChild(t); msgs.appendChild(r); msgs.scrollTop = msgs.scrollHeight; return r; }
    function book(url) { var a = document.createElement('a'); a.className = 'bk'; a.target = '_blank'; a.rel = 'noopener'; a.href = url; a.textContent = 'Book a paid online consultation'; var r = document.createElement('div'); r.className = 'r'; r.appendChild(a); msgs.appendChild(r); msgs.scrollTop = msgs.scrollHeight; }
    var greeted = false;
    function open() { panel.classList.add('o'); if (!greeted) { greeted = true; add('a', cfg.greeting); } inp.focus(); }
    $('.b').onclick = function () { panel.classList.contains('o') ? panel.classList.remove('o') : open(); };
    $('.x').onclick = function () { panel.classList.remove('o'); };
    function post(path, body) { return fetch(API + path, { method: 'POST', headers: H, body: JSON.stringify(body || {}) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Error'); e.data = j; throw e; } return j; }); }); }
    function ensure() { if (tok) return Promise.resolve(); return post('/api/public/chat/start' + q).then(function (j) { tok = j.token; try { sessionStorage.setItem(KEY, tok); } catch (e) {} }); }
    $('.f').onsubmit = function (e) {
      e.preventDefault(); var text = inp.value.trim(); if (!text || busy) return; inp.value = ''; busy = true; add('u', text); var wait = add('a', '…'), t0 = Date.now();
      ensure().then(function () { return post('/api/public/chat/' + tok + '/message', { text: text }); }).then(function (j) {
        var d = Math.max(0, Math.min(3500, 700 + j.reply.length * 18) - (Date.now() - t0)); return new Promise(function (ok) { setTimeout(ok, d); }).then(function () { wait.firstChild.textContent = j.reply; if (j.booking && j.url) book(j.url); });
      }).catch(function (err) {
        if (err.data && err.data.url) { wait.firstChild.textContent = err.message; book(err.data.url); return; }
        if (/ended|start again/i.test(err.message)) { tok = null; try { sessionStorage.removeItem(KEY); } catch (x) {} }
        wait.firstChild.textContent = err.message || 'Sorry, something went wrong. Please try again.';
      }).then(function () { busy = false; });
    };
    document.body.appendChild(host);
  }
})();
