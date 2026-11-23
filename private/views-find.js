/* ===== Finder: one search for everything (results page + Ctrl+K quick finder + saved searches) ===== */
const FIND_RECENT = 'kc-find-recent';
const findRecent = () => { try { return JSON.parse(localStorage.getItem(FIND_RECENT) || '[]'); } catch (e) { return []; } };
const findRemember = (q) => { try { const a = [q, ...findRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8); localStorage.setItem(FIND_RECENT, JSON.stringify(a)); } catch (e) { /* storage unavailable */ } };
const findHl = (text, tokens) => {
  const t = String(text == null ? '' : text); if (!tokens || !tokens.length) return esc(t);
  const re = new RegExp('(' + tokens.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return t.split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
};
const findItem = (it, tokens) => `<li class="fi"><span style="min-width:0"><a href="${it.ext ? esc(it.ext) : esc(it.href)}" ${it.ext ? 'target="_blank" rel="noopener noreferrer"' : ''} ${it.open ? `data-open="${esc(it.open)}" data-id="${esc(it.id)}"` : ''}><b>${findHl(it.title, tokens)}</b></a>${it.tag ? ' ' + pill(it.tag) : ''}
  ${it.sub ? `<div class="mute">${findHl(it.sub, tokens)}</div>` : ''}${it.snippet ? `<div class="mute fsn">${findHl(it.snippet, tokens)}</div>` : ''}</span>${it.date ? `<span class="mute" style="white-space:nowrap">${esc(dt(String(it.date).slice(0, 10)))}</span>` : ''}</li>`;
async function findOpenJudgment(id) {
  const j = await GET('/api/judgments/' + id);
  show(j.title, `<p class="mute">${esc(j.court)} · ${esc(j.case_no || '')} ${j.decided_on ? '· ' + dt(j.decided_on) : ''}<br>Judge: ${esc(j.judge || '—')} · ${esc(j.citation || '')}</p><div class="paper"><pre>${esc(j.summary || 'No summary entered.')}</pre></div>${j.source_url && /^https?:\/\//i.test(j.source_url) ? `<p><a href="${esc(j.source_url)}" target="_blank" rel="noopener noreferrer">Open the source</a></p>` : ''}`, true);
}
const findWire = (root) => on(root, 'click', '[data-open="judgment"]', (e, a) => { e.preventDefault(); findOpenJudgment(a.dataset.id).catch((x) => toast(x.message, true)); });

route(/^\/find$/, async (_m, p) => {
  const q = (p.get('q') || '').trim(), only = (p.get('types') || '').split(',').filter(Boolean);
  const saved = await GET('/api/find/saved').catch(() => []);
  view(`<h1>Search</h1><p class="mute">One search for cases, clients, hearings, notes, tasks, letters, the register, leads, invoices, files, judgments, saved research, repository links and filing forums. It shows only what you are allowed to see. Press <b>Ctrl+K</b> from any page.</p>
    <form class="row noprint" id="ff" style="margin-bottom:.6rem"><input id="q" type="search" placeholder="Name, case number, phone, invoice number, words from a note or letter…" value="${esc(q)}" style="flex:1;min-width:200px" autocomplete="off"><button class="btn">Search</button></form>
    <div id="chips" class="row noprint" style="flex-wrap:wrap;gap:.35rem;margin-bottom:.6rem"></div><div id="out"></div>
    ${saved.length ? `<div class="card noprint"><h3>Saved searches</h3><ul class="list">${saved.map((s) => `<li><a href="#/find?${qs({ q: s.q, types: s.types })}">${esc(s.q)}</a><span>${s.types ? '<span class="mute">' + esc(s.types.split(',').length + ' type(s)') + '</span> ' : ''}<button class="btn sm ghost" data-del="${s.id}">Remove</button></span></li>`).join('')}</ul></div>` : ''}
    <div class="card noprint" id="rc" ${q || !findRecent().length ? 'hidden' : ''}><h3>Recent searches</h3><div class="row" style="flex-wrap:wrap;gap:.4rem">${findRecent().map((r) => `<a class="btn sm ghost" href="#/find?q=${encodeURIComponent(r)}">${esc(r)}</a>`).join('')}</div></div>`);
  $('#ff').onsubmit = (e) => { e.preventDefault(); const v = $('#q').value.trim(); location.hash = '#/find' + (v ? '?' + qs({ q: v, types: only.join(',') }) : ''); };
  $$('[data-del]').forEach((b) => (b.onclick = async () => { await DEL('/api/find/saved/' + b.dataset.del); go(); }));
  findWire($('#out'));
  if (!q) { $('#out').innerHTML = ''; return; }
  $('#q').focus(); $('#out').innerHTML = '<p class="mute">Searching…</p>';
  let d; try { d = await GET('/api/find?' + qs({ q, types: only.join(','), per: 12 })); } catch (e) { $('#out').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  findRemember(q);
  $('#chips').innerHTML = (d.types || []).map(([k, l]) => { const on = only.includes(k); return `<a class="btn sm ${on ? '' : 'ghost'}" href="#/find?${qs({ q, types: (on ? only.filter((x) => x !== k) : [...only, k]).join(',') })}">${esc(l)}</a>`; }).join('');
  const head = `<div class="row sp noprint" style="margin-bottom:.4rem"><span class="mute">${d.total ? `${d.total}${d.groups.some((g) => g.capped) ? '+' : ''} result(s) in ${d.took_ms} ms` : ''}${d.relaxed ? ' · <b>nothing matched every word, so these match some of them</b>' : ''}</span>${d.total ? '<button class="btn sm ghost" id="sv">Save this search</button>' : ''}</div>`;
  $('#out').innerHTML = head + (d.groups.length ? d.groups.map((g) => `<div class="card"><div class="row sp"><h2 style="margin:0">${esc(g.label)} <span class="mute">(${g.count}${g.capped ? '+' : ''})</span></h2>${g.count > g.items.length ? `<a class="btn sm ghost noprint" href="#/find?${qs({ q, types: g.key })}">Show only ${esc(g.label.toLowerCase())}</a>` : ''}</div><ul class="list">${g.items.map((it) => findItem(it, d.tokens)).join('')}</ul></div>`).join('')
    : `<div class="card"><p>Nothing found for <b>${esc(q)}</b>.</p><p class="mute">Try fewer words, part of a name, or just the number of a case. Search matches pieces of words, so "sukho" finds "Sukhobrishti".</p></div>`);
  const sv = $('#sv'); if (sv) sv.onclick = async () => { try { const r = await POST('/api/find/saved', { q, types: only.join(',') }); toast(r.dup ? 'Already saved' : 'Search saved'); if (!r.dup) go(); } catch (e) { toast(e.message, true); } };
}, { office: true });

/* ---- Ctrl+K quick finder ---- */
function findQuick() {
  if (document.getElementById('qfo')) return;
  const o = document.createElement('div'); o.className = 'overlay'; o.id = 'qfo';
  o.innerHTML = `<div class="modal wide" role="dialog" aria-label="Search"><input id="qfi" type="search" placeholder="Search everything…  (Enter opens the full results, ↑ ↓ to move, Esc to close)" style="width:100%" autocomplete="off"><div id="qfr" style="margin-top:.6rem;max-height:60vh;overflow:auto"></div></div>`;
  document.body.appendChild(o); const inp = $('#qfi', o), box = $('#qfr', o); inp.focus(); let seq = 0, t, cur = -1;
  const close = () => { o.remove(); };
  const rows = () => [...box.querySelectorAll('a[href]')];
  const mark = () => rows().forEach((a, i) => a.classList.toggle('sel', i === cur));
  const draw = async () => {
    const v = inp.value.trim(), my = ++seq; cur = -1;
    if (v.length < 2) { const r = findRecent(); box.innerHTML = r.length ? `<p class="mute">Recent</p>${r.map((x) => `<div><a href="#/find?q=${encodeURIComponent(x)}">${esc(x)}</a></div>`).join('')}` : '<p class="mute">Type at least two letters.</p>'; return; }
    try {
      const d = await GET('/api/find?' + qs({ q: v, per: 4 })); if (my !== seq) return;
      box.innerHTML = d.groups.length ? d.groups.map((g) => `<div class="mute" style="margin-top:.5rem"><b>${esc(g.label)}</b> (${g.count}${g.capped ? '+' : ''})</div><ul class="list">${g.items.map((it) => findItem(it, d.tokens)).join('')}</ul>`).join('') + `<p><a href="#/find?q=${encodeURIComponent(v)}"><b>See all results</b></a></p>` : '<p class="mute">Nothing found.</p>';
    } catch (e) { if (my === seq) box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  inp.oninput = () => { clearTimeout(t); t = setTimeout(draw, 200); };
  inp.onkeydown = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const r = rows(); if (!r.length) return; cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + r.length) % r.length; mark(); r[cur].scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'Enter') { e.preventDefault(); const r = rows(); if (cur >= 0 && r[cur]) { r[cur].click(); return; } const v = inp.value.trim(); if (v.length >= 2) { location.hash = '#/find?q=' + encodeURIComponent(v); close(); } }
  };
  o.onclick = (e) => { if (e.target === o) close(); const a = e.target.closest('a[href]'); if (a) { if (a.dataset.open === 'judgment') { e.preventDefault(); findOpenJudgment(a.dataset.id).catch((x) => toast(x.message, true)); } close(); } };
  draw();
}
if (!window.__kcFind) {
  window.__kcFind = true;
  document.addEventListener('keydown', (e) => {
    if (typeof ME === 'undefined' || !ME || ['client', 'superadmin'].includes(ME.role)) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); findQuick(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); findQuick(); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#qf')) { e.preventDefault(); findQuick(); } });
}
