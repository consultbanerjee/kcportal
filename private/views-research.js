'use strict';
/* ===== Research Desk: ask in plain words (Indian law only), search the firm's judgments, check a precedent, official sources ===== */
const RMODES = [['ask', 'Ask AI'], ['keyword', 'Keyword'], ['citation', 'Citation'], ['party', 'Party name'], ['act', 'Act / section'], ['judge', 'Judge'], ['overruled', 'Overruled?'], ['history', 'My research']];
function researchBox() {
  return `<div class="card rbox"><form id="rq" class="row" style="flex-wrap:nowrap"><input id="rqi" placeholder="Ask a legal question. It is answered under Indian law, with precedents checked." maxlength="3000"><button class="btn">Ask</button></form>
    <div class="chips">${RMODES.filter((m) => m[0] !== 'history').map(([k, l]) => `<a class="chip" href="#/research?mode=${k}">${l}</a>`).join('')}</div></div>`;
}
function researchBoxWire() { const f = $('#rq'); if (f) f.onsubmit = (e) => { e.preventDefault(); const q = $('#rqi').value.trim(); location.hash = '#/research?mode=ask' + (q ? '&q=' + encodeURIComponent(q) : ''); }; }

route(/^\/research$/, async (_m, p) => {
  const mode = RMODES.some((m) => m[0] === p.get('mode')) ? p.get('mode') : 'ask', q0 = p.get('q') || '';
  const st = await GET('/api/research/status').catch(() => ({ on: false }));
  const tabs = `<div class="tabs">${RMODES.map(([k, l]) => `<a href="#/research?mode=${k}" class="${mode === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const head = `<div class="row sp"><h1>Research Desk</h1>${can('admin') ? `<label class="chk mute"><input type="checkbox" id="rson" ${st.on ? 'checked' : ''}> On for this firm</label>` : ''}</div>${tabs}`;
  if (!st.on) { view(head + '<div class="card"><p class="mute">The Research Desk is switched off for this firm.</p></div>'); wireSwitch(); return; }
  function wireSwitch() { const t = $('#rson'); if (t) t.onchange = async () => { await PUT('/api/research/settings', { on: t.checked }); toast(t.checked ? 'Research Desk is on.' : 'Research Desk is off.'); MODS = await GET('/api/modules'); go(); }; }
  const note = '<p class="mute">Answers are prepared by AI under Indian law. Verify every citation on the official report before you rely on it.</p>';
  const out = (a, id) => `<div class="paper" style="white-space:pre-wrap">${esc(a)}</div><div class="row" style="margin-top:.5rem"><button class="btn sm ghost" id="rcp">Copy</button><button class="btn sm ghost" id="rsv" data-id="${id}">Save to a case</button></div>`;
  const hook = (id, a) => {
    const c = $('#rcp'); if (c) c.onclick = () => { try { navigator.clipboard.writeText(a); toast('Copied.'); } catch (e) { toast('Select the text and copy.', true); } };
    const s = $('#rsv'); if (s) s.onclick = async () => { const ms = await GET('/api/matters'); ask('Save to a case', [{ name: 'matter_id', label: 'Case', type: 'select', options: ms.map((m) => [m.id, m.file_no + ' — ' + m.title]) }], 'Save', async (v) => { await POST('/api/research/save', { id, matter_id: v.matter_id }); toast('Saved in the case notings.'); }); };
  };
  if (mode === 'ask' || mode === 'overruled') {
    const ov = mode === 'overruled';
    view(`${head}<div class="card"><form id="rf"><label for="rt">${ov ? 'Case name or citation' : 'Your question'}</label>${ov ? '<input id="rt" maxlength="300" placeholder="e.g. a case name, or AIR / SCC citation">' : '<textarea id="rt" rows="3" maxlength="3000" placeholder="Write the facts and the question in a few sentences."></textarea>'}
      <div class="row" style="margin-top:.5rem"><button class="btn" id="rgo">${ov ? 'Check' : 'Ask'}</button>${!ov && !st.ai ? '<span class="mute">AI is not switched on for your firm.</span>' : ''}</div></form><div id="ro" style="margin-top:.7rem"></div>${note}</div>`);
    wireSwitch(); const t = $('#rt'); t.value = q0;
    const run = async () => { const v = t.value.trim(); if (!v) return; $('#rgo').disabled = true; $('#ro').innerHTML = '<p class="mute">Working…</p>';
      try { const r = await POST(ov ? '/api/research/overruled' : '/api/research/ask', ov ? { case: v } : { q: v }); $('#ro').innerHTML = out(r.answer, r.id); hook(r.id, r.answer); } catch (e) { $('#ro').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
      $('#rgo').disabled = false; };
    $('#rf').onsubmit = (e) => { e.preventDefault(); run(); };
    if (q0 && !ov) run();
    return;
  }
  if (mode === 'history') {
    const h = await GET('/api/research/history');
    view(`${head}<div class="card">${h.length ? `<ul class="list">${h.map((x) => `<li><span><b>${esc(x.query.slice(0, 140))}</b><div class="mute">${esc(x.kind === 'overruled' ? 'Overruled check' : 'Question')} · ${dtm(x.created_at)}</div></span><button class="btn sm ghost" data-h="${x.id}">Open</button></li>`).join('')}</ul>` : '<p class="mute">Nothing yet. Your questions will be listed here.</p>'}</div>`);
    wireSwitch(); $$('[data-h]').forEach((b) => (b.onclick = () => { const x = h.find((r) => String(r.id) === b.dataset.h); const m = show(x.query.slice(0, 80), `<div class="paper" style="white-space:pre-wrap">${esc(x.answer || '')}</div>`, true); }));
    return;
  }
  view(`${head}<div class="card"><form id="rf" class="row" style="flex-wrap:nowrap"><input id="rt" placeholder="${{ keyword: 'Words, subject, court, case number', citation: 'Citation or case number', party: 'Name of a party', act: 'Act, section or subject', judge: 'Name of the judge' }[mode]}" maxlength="120"><button class="btn">Search</button></form></div><div id="rr"></div>`);
  wireSwitch(); const t = $('#rt'); t.value = q0;
  const run = async () => {
    const v = t.value.trim(); if (v.length < 3) { $('#rr').innerHTML = '<p class="mute">Type at least three letters.</p>'; return; }
    const r = await GET('/api/research/search?' + qs({ mode, q: v }));
    $('#rr').innerHTML = `<div class="card"><h2>Your judgments library <span class="mute">${r.judgments.length}</span></h2>${r.judgments.length ? `<ul class="list">${r.judgments.map((j) => `<li><span><b>${esc(j.title)}</b><div class="mute">${esc(j.court)} ${j.case_no ? '· ' + esc(j.case_no) : ''} ${j.citation ? '· ' + esc(j.citation) : ''} ${j.judge ? '· ' + esc(j.judge) : ''} ${j.decided_on ? '· ' + dt(j.decided_on) : ''}</div></span>${j.source_url ? `<a class="btn sm ghost" href="${esc(j.source_url)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`).join('')}</ul>` : '<p class="mute">Nothing in your library. Try the official sources below, and add useful judgments under Judgments.</p>'}</div>
      ${r.matters.length ? `<div class="card"><h2>Your cases with this party</h2><ul class="list">${r.matters.map((m) => `<li><a href="#/matter/${m.id}">${esc(m.file_no)} — ${esc(m.title)}</a><span class="mute">${esc(m.opposite_party || '')}</span></li>`).join('')}</ul></div>` : ''}
      <div class="card"><h2>Official sources</h2><ul class="list">${r.sources.map((s) => `<li><a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])}</a></li>`).join('')}</ul></div>`;
  };
  $('#rf').onsubmit = (e) => { e.preventDefault(); run(); };
  if (q0) run();
}, { office: true });
