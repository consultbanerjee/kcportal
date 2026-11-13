'use strict';
/* ===== v5.2: case labels, saved research, usage summary ===== */
const labelChips = (s) => (s ? ' ' + String(s).split(',').filter(Boolean).map((l) => `<span class="chip" style="padding:.02rem .5rem;font-size:11px;margin-left:.2rem">${esc(l)}</span>`).join('') : '');
async function labelBar(onPick) {
  const host = $('#lbar'); if (!host) return; let ls = []; try { ls = await GET('/api/labels'); } catch (e) { return; }
  if (!ls.length) return; let on = '';
  const draw = () => { host.innerHTML = `<div class="chips noprint" style="margin-bottom:.6rem"><style>#lbar .chip{text-decoration:none}#lbar .chip.on{background:var(--navy);color:#fff}</style><a class="chip ${on ? '' : 'on'}" href="#" data-l="">All</a>${ls.map((x) => `<a class="chip ${on === x.label ? 'on' : ''}" href="#" data-l="${esc(x.label)}">${esc(x.label)} · ${x.count}</a>`).join('')}</div>`;
    $$('#lbar [data-l]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); on = a.dataset.l; draw(); onPick(on); })); };
  draw();
}
function editLabels(id, cur) {
  ask('Case labels', [{ name: 'labels', label: 'Labels, separated by commas (up to 8). Example: ROC, Private, Urgent', value: cur || '' }], 'Save', async (v) => { await PUT('/api/matters/' + id + '/labels', { labels: v.labels }); toast('Labels saved.'); go(); });
}
async function usageCard() {
  if (!ME || ME.role !== 'admin') return '';
  try { const u = await GET('/api/usage'); const mb = (u.bytes / 1048576).toFixed(u.bytes > 1073741824 ? 0 : 1);
    return `<div class="card"><h2>Your firm at a glance</h2><div class="grid"><div class="stat"><b>${u.cases}</b><span>Cases (${u.open_cases} open)</span></div><div class="stat"><b>${u.clients}</b><span>Clients</span></div><div class="stat"><b>${u.files}</b><span>Files · ${mb} MB</span></div><div class="stat"><b>${u.users}</b><span>Team members</span></div></div></div>`; } catch (e) { return ''; }
}
async function saveResearch(o) { await POST('/api/research/saved', o); toast('Saved to your research notes.'); }
async function savedResearchView(head) {
  const rows = await GET('/api/research/saved');
  view(`${head}<div class="card">${rows.length ? `<ul class="list">${rows.map((x) => `<li style="align-items:flex-start"><span style="flex:1"><b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</b><div class="mute">${esc(x.kind || 'Saved')} · ${dtm(x.created_at)}</div>${x.note ? `<div style="margin-top:.25rem;white-space:pre-wrap">${esc(x.note)}</div>` : ''}</span><span class="row" style="gap:.3rem">${x.ref ? `<button class="btn sm ghost" data-j="${esc(x.ref)}">Judgment</button>` : ''}${x.body ? `<button class="btn sm ghost" data-v="${x.id}">Open</button>` : ''}<button class="btn sm ghost" data-n="${x.id}">Note</button><button class="btn sm ghost" data-d="${x.id}">Remove</button></span></li>`).join('')}</ul>` : '<p class="mute">Nothing saved yet. Use “Bookmark” on an answer or a judgment to keep it here with your own note.</p>'}</div>`);
  $$('[data-j]').forEach((b) => (b.onclick = () => { const [f, i] = b.dataset.j.split('/'); openJudgment(f, i); }));
  $$('[data-v]').forEach((b) => (b.onclick = () => { const x = rows.find((r) => String(r.id) === b.dataset.v); show(x.title.slice(0, 80), `<div class="paper" style="white-space:pre-wrap">${esc(x.body || '')}</div>`, true); }));
  $$('[data-n]').forEach((b) => (b.onclick = () => { const x = rows.find((r) => String(r.id) === b.dataset.n); ask('Your note', [{ name: 'note', label: 'Note', type: 'textarea', value: x.note || '' }], 'Save', async (v) => { await PUT('/api/research/saved/' + x.id, { note: v.note }); go(); }); }));
  $$('[data-d]').forEach((b) => (b.onclick = async () => { await DEL('/api/research/saved/' + b.dataset.d); go(); }));
}

/* ===== Case law: search the judgments database (KC Search service), open, download, bookmark, save to a case ===== */
async function openJudgment(folder, id) {
  let r; try { r = await GET(`/api/research/caselaw/doc/${folder}/${id}`); } catch (e) { toast(e.message, true); return; }
  const d = r.doc, base = `/api/research/caselaw/doc/${folder}/${id}`;
  const m = show((d.title || 'Judgment').slice(0, 90), `<div class="mute">${esc([d.court, d.case_no, d.citation, d.decision_date, d.judge].filter(Boolean).join(' · '))}</div>
    <div class="row" style="margin:.6rem 0;gap:.4rem;flex-wrap:wrap"><a class="btn sm" href="${base}/docx">Download Word</a><a class="btn sm" href="${base}/pdf">Download PDF</a><button class="btn sm ghost" id="cjb">Bookmark</button><button class="btn sm ghost" id="cjc">Save to a case</button></div>
    <div class="paper" style="white-space:pre-wrap;max-height:55vh;overflow:auto">${d.body ? esc(d.body.slice(0, 30000)) + (d.body.length > 30000 ? '\n\n… Download the Word or PDF file for the complete judgment.' : '') : 'The full text is not stored here. Download the PDF to read the original.'}</div>
    <p class="mute">${esc(r.credit || '')}</p>`, true);
  $('#cjb', m.el).onclick = async () => { try { await saveResearch({ title: d.title || 'Judgment', body: [d.court, d.case_no, d.citation, d.decision_date].filter(Boolean).join(' · '), kind: 'Judgment', ref: folder + '/' + id }); } catch (e) { toast(e.message, true); } };
  $('#cjc', m.el).onclick = async () => { const ms = await GET('/api/matters'); ask('Save to a case', [{ name: 'matter_id', label: 'Case', type: 'select', options: ms.map((x) => [x.id, x.file_no + ' — ' + x.title]) }], 'Save', async (v) => { await POST('/api/research/caselaw/to-case', { matter_id: v.matter_id, folder, id }); toast('Saved as a noting on the case.'); }); };
}
async function caselawView(head, q0) {
  const st = await GET('/api/research/caselaw/status').catch(() => ({ on: false, courts: [] }));
  if (!st.on) { view(head + '<div class="card"><p class="mute">The case-law database is not connected yet. Please contact the portal provider.</p></div>'); return; }
  const picked = new Set(); let offset = 0, last = null;
  view(`${head}<div class="card"><form id="cf"><div class="row" style="flex-wrap:nowrap"><input id="cq" placeholder="Words, “exact phrase”, AND / OR / NOT, judge:Name, title:Party, citation:…" maxlength="300"><button class="btn">Search</button></div>
    <div class="row" style="gap:.5rem;margin-top:.5rem;flex-wrap:wrap"><input id="cy1" type="number" placeholder="From year" style="width:7.5rem"><input id="cy2" type="number" placeholder="To year" style="width:7.5rem"><select id="cs"><option value="rank">Best match</option><option value="date">Newest first</option></select></div>
    <div class="chips" id="cc" style="margin-top:.5rem">${st.courts.map((c) => `<a class="chip" role="button" tabindex="0" style="cursor:pointer" data-f="${esc(c.folder)}" title="${esc(c.name)}">${esc(c.folder)}${c.docs ? ' · ' + Number(c.docs).toLocaleString('en-IN') : ''}</a>`).join('')}</div></form>
    <p class="mute" style="margin-top:.4rem">Tap courts to limit the search. None selected searches all.</p></div><div id="cr"></div><p class="mute">${esc(st.credit || '')}</p>`);
  const t = $('#cq'); t.value = q0 || '';
  $$('#cc .chip').forEach((c) => (c.onclick = () => { const f = c.dataset.f; if (picked.has(f)) { picked.delete(f); c.classList.remove('on'); } else { picked.add(f); c.classList.add('on'); } }));
  const card = (x) => `<li style="align-items:flex-start"><span style="flex:1"><b>${esc(x.title || 'Untitled')}</b><div class="mute">${esc([x.folder, x.case_no, x.decision_date || x.year, x.judge].filter(Boolean).join(' · '))}</div>${x.snip ? `<div style="margin-top:.25rem">${x.snip}</div>` : ''}</span><button class="btn sm ghost" data-o="${esc(x.folder)}/${x.id}">Open</button></li>`;
  const wire = () => $$('[data-o]').forEach((b) => (b.onclick = () => { const [f, i] = b.dataset.o.split('/'); openJudgment(f, i); }));
  const run = async (more) => {
    const v = t.value.trim(); if (v.length < 3) { $('#cr').innerHTML = '<p class="mute">Type at least three letters.</p>'; return; }
    if (!more) { offset = 0; $('#cr').innerHTML = '<p class="mute">Searching…</p>'; }
    try {
      const r = await GET('/api/research/caselaw/search?' + qs({ q: v, courts: [...picked].join(','), year_from: $('#cy1').value, year_to: $('#cy2').value, sort: $('#cs').value, offset, limit: 20 }));
      last = r; const items = r.results.map((x) => ({ ...x, folder: x.folder || (r.courts && r.courts.length === 1 ? r.courts[0] : x.folder) }));
      const list = items.map(card).join(''); offset += r.results.length;
      if (more) { $('#cl').insertAdjacentHTML('beforeend', list); } else $('#cr').innerHTML = `<div class="card"><h2>Judgments <span class="mute">${r.ms != null ? r.ms + ' ms' : ''}</span></h2>${list ? `<ul class="list" id="cl">${list}</ul>` : '<p class="mute">No judgments matched. Try fewer words or another court.</p>'}<div id="cm"></div></div>`;
      $('#cm').innerHTML = r.more ? '<button class="btn sm ghost" id="cmore">Show more</button>' : ''; const mb = $('#cmore'); if (mb) mb.onclick = () => run(true); wire();
    } catch (e) { $('#cr').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#cf').onsubmit = (e) => { e.preventDefault(); run(false); };
  if (q0) run(false);
}
