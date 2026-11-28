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
/* ===== Judgment reader: preview panel with download / save tabs, pen + highlighter + eraser with undo / redo, and a notes window ===== */
const JPENS = [['Deep red', '#8b0000'], ['Green', '#1b7a2b'], ['Navy blue', '#000080'], ['Black', '#000000']];
const JHILS = [['Fluorescent green', '#39ff14'], ['Yellow', '#ffff00'], ['Orange', '#ff9f1c'], ['Blue', '#4dd2ff']];
const jStamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `[${z(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}, ${h}:${z(d.getMinutes())} ${ap}]`; };
const jLS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
async function jBlob(url, body, name) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kcportal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not make the file.');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
async function jClientAsk(title, okLabel, extra, fn) {
  let cs = []; try { cs = await GET('/api/clients'); } catch (e) { toast(e.message, true); return; }
  if (!cs.length) { toast('Add a client first.', true); return; }
  const last = jLS('kc-jclient');
  return ask(title, [{ name: 'client_id', label: 'Client', type: 'select', value: last, options: cs.map((c) => [c.id, c.name]) }, ...extra], okLabel, async (v) => { jLS('kc-jclient', String(v.client_id)); await fn(v); });
}
async function judgmentPanel(host, folder, id, opt = {}) {
  host.innerHTML = '<div class="card"><p class="mute">Opening the judgment…</p></div>';
  let r, marks = [];
  try { [r, marks] = await Promise.all([GET(`/api/research/caselaw/doc/${folder}/${id}`), GET(`/api/research/caselaw/marks/${folder}/${id}`).then((x) => x.marks).catch(() => [])]); }
  catch (e) { host.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p></div>`; return; }
  const d = r.doc, base = `/api/research/caselaw/doc/${folder}/${id}`, key = folder + '/' + id, body = String(d.body || ''), Q = (x) => $(x, host);
  const meta = [d.court, d.case_no, d.citation, d.decision_date, d.judge].filter(Boolean).join(' · ');
  const sw = (list, k) => list.map(([n, c]) => `<button type="button" class="jsw" data-k="${k}" data-c="${c}" data-n="${esc(n)}" title="${k === 'u' ? 'Pen' : 'Highlighter'}: ${esc(n)}" aria-label="${k === 'u' ? 'Pen' : 'Highlighter'} ${esc(n)}" style="background:${c}"></button>`).join('');
  host.innerHTML = `<style>
    .jp .jtabs{display:flex;flex-wrap:wrap;gap:.3rem;margin:.5rem 0;padding-bottom:.5rem;border-bottom:1px solid var(--line)}
    .jp .jbar{display:flex;flex-wrap:wrap;gap:.35rem .8rem;align-items:center;margin:.3rem 0 .5rem;padding:.4rem .5rem;background:#f4f1e8;border-radius:8px}
    .jp .jgrp{display:flex;align-items:center;gap:.3rem;font-size:12px;color:var(--mute)}
    .jp .jsw{width:24px;height:24px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #9a958a;cursor:pointer;padding:0;min-height:0}
    .jp .jsw.on{box-shadow:0 0 0 2px var(--navy),0 0 0 4px var(--gold2)}
    .jp .jbar .btn{min-height:30px;padding:.25rem .6rem;font-size:13px}.jp .jbar .btn.on{background:var(--gold);color:#fff}
    .jp .jtext{white-space:pre-wrap;max-height:46vh;overflow:auto;font-size:14px;line-height:1.65;padding:1rem}
    .jp .jtext.t-u,.jp .jtext.t-h{cursor:text}.jp .jtext.t-e{cursor:crosshair}
    .jp .jnote{margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--line)}.jp .jnote textarea{width:100%;min-height:90px;resize:vertical}
  </style><div class="card jp">
    <div class="row sp" style="align-items:flex-start;gap:.5rem"><div><b>${esc(d.title || 'Judgment')}</b><div class="mute">${esc(meta)}</div></div>${opt.onClose ? '<button class="btn sm ghost" id="jx">Close</button>' : ''}</div>
    <div class="jtabs">
      <a class="btn sm" href="${base}/docx">Download Word</a><a class="btn sm" href="${base}/pdf">Download PDF</a>
      <button class="btn sm" id="jaw" hidden>Marked Word</button><button class="btn sm" id="jap" hidden>Marked PDF</button>
      <button class="btn sm ghost" id="jb">Bookmark</button><button class="btn sm ghost" id="jc">Save to a case</button><button class="btn sm ghost" id="jcl">Save in client folder</button>
    </div>
    <div class="jbar" ${body ? '' : 'hidden'}>
      <span class="jgrp">Pen ${sw(JPENS, 'u')}</span><span class="jgrp">Highlighter ${sw(JHILS, 'h')}</span>
      <span class="jgrp"><button type="button" class="btn ghost" id="je" title="Rub out underlines and highlights: drag over the text, or click a marked place">Eraser</button>
      <button type="button" class="btn ghost" id="ju">Undo</button><button type="button" class="btn ghost" id="jr">Redo</button><button type="button" class="btn ghost" id="jclr">Clear all</button></span>
      <span class="mute" id="jhint" style="font-size:12px">Choose a pen or highlighter, then select the words.</span>
    </div>
    <div class="paper jtext" id="jt"></div>
    <p class="mute" style="margin:.3rem 0 0">${esc(r.credit || '')}</p>
    <div class="jnote"><div class="row sp"><b>Notes</b><label class="chk" style="display:flex;gap:.35rem;align-items:center;font-weight:400;margin:0"><input type="checkbox" id="jns"> Date and time stamp</label></div>
      <textarea id="jn" placeholder="Type your note on this judgment…"></textarea>
      <div class="row" style="gap:.4rem;flex-wrap:wrap;margin-top:.4rem"><button class="btn sm" id="jnsave">Save note</button><button class="btn sm ghost" id="jnc">Save note in client folder</button><button class="btn sm ghost" id="jnst">Add stamp</button><button class="btn sm ghost" id="jnx">Clear</button></div>
    </div></div>`;
  const tx = Q('#jt'); let tool = null, hist = [], fut = [], saveT = null;
  const cover = (arr, k, p) => { for (let i = arr.length - 1; i >= 0; i--) { const m = arr[i]; if (m.k === k && m.s <= p && m.e > p) return m; } return null; };
  const cut = (list, s, e, kind) => list.flatMap((m) => { if ((kind && m.k !== kind) || m.e <= s || m.s >= e) return [m]; const o = []; if (m.s < s) o.push({ ...m, e: s }); if (m.e > e) o.push({ ...m, s: e }); return o; });
  const merge = (list) => { const out = []; for (const k of ['u', 'h']) { const g = list.filter((m) => m.k === k).sort((a, b) => a.s - b.s); const o = []; for (const m of g) { const p = o[o.length - 1]; if (p && p.c === m.c && p.e >= m.s) p.e = Math.max(p.e, m.e); else o.push({ ...m }); } out.push(...o); } return out; };
  const paint = () => {
    if (!body) { tx.textContent = 'The full text of this judgment is not stored here. Download the PDF to read the original.'; return; }
    const cuts = new Set([0, body.length]); marks.forEach((m) => { cuts.add(Math.min(m.s, body.length)); cuts.add(Math.min(m.e, body.length)); });
    const pts = [...cuts].sort((a, b) => a - b); let out = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]; if (a === b) continue; const seg = esc(body.slice(a, b)), h = cover(marks, 'h', a), u = cover(marks, 'u', a);
      out += h || u ? `<span style="${h ? 'background:' + h.c + ';color:#000;' : ''}${u ? 'text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;text-decoration-color:' + u.c + ';' : ''}">${seg}</span>` : seg;
    }
    tx.innerHTML = out;
    Q('#ju').disabled = !hist.length; Q('#jr').disabled = !fut.length; Q('#jclr').disabled = !marks.length;
    Q('#jaw').hidden = Q('#jap').hidden = !marks.length;
  };
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => PUT(`/api/research/caselaw/marks/${key}`, { marks }).catch(() => {}), 700); };
  const commit = (nm) => { if (nm.length > 3000) { toast('Too many marks on one judgment. Erase some first.', true); return; } hist.push(marks); if (hist.length > 100) hist.shift(); fut = []; marks = nm; paint(); persist(); };
  const setTool = (t) => {
    tool = t; $$('.jsw', host).forEach((b) => b.classList.toggle('on', !!t && t.k !== 'e' && b.dataset.k === t.k && b.dataset.c === t.c)); Q('#je').classList.toggle('on', !!t && t.k === 'e');
    tx.className = 'paper jtext' + (t ? ' t-' + t.k : ''); Q('#jhint').textContent = !t ? 'Choose a pen or highlighter, then select the words.' : t.k === 'e' ? 'Eraser: drag over marked words, or click a marked place.' : (t.k === 'u' ? 'Pen' : 'Highlighter') + ' ' + t.n.toLowerCase() + ': select the words to mark them.';
  };
  const onUp = () => {
    if (!tool) return; const sel = getSelection(); if (!sel || !sel.rangeCount) return; const rg = sel.getRangeAt(0); if (!tx.contains(rg.commonAncestorContainer)) return;
    const pre = document.createRange(); pre.selectNodeContents(tx); pre.setEnd(rg.startContainer, rg.startOffset);
    let s = pre.toString().length, e = Math.min(s + rg.toString().length, body.length);
    if (rg.collapsed) { if (tool.k === 'e') { const nm = marks.filter((m) => !(m.s <= s && m.e > s)); if (nm.length !== marks.length) commit(nm); } return; }
    while (s < e && /\s/.test(body[s])) s++; while (e > s && /\s/.test(body[e - 1])) e--; if (e <= s) return;
    commit(tool.k === 'e' ? cut(marks, s, e, null) : merge([...cut(marks, s, e, tool.k), { s, e, k: tool.k, c: tool.c }])); sel.removeAllRanges();
  };
  tx.addEventListener('mouseup', onUp); tx.addEventListener('touchend', () => setTimeout(onUp, 60));
  $$('.jsw', host).forEach((b) => (b.onclick = () => { const same = tool && tool.k === b.dataset.k && tool.c === b.dataset.c; setTool(same ? null : { k: b.dataset.k, c: b.dataset.c, n: b.dataset.n }); }));
  Q('#je').onclick = () => setTool(tool && tool.k === 'e' ? null : { k: 'e' });
  Q('#ju').onclick = () => { if (!hist.length) return; fut.push(marks); marks = hist.pop(); paint(); persist(); };
  Q('#jr').onclick = () => { if (!fut.length) return; hist.push(marks); marks = fut.pop(); paint(); persist(); };
  Q('#jclr').onclick = () => { if (marks.length && confirm('Remove all underlines and highlights from this judgment?')) commit([]); };
  paint(); setTool(null);
  if (opt.onClose) Q('#jx').onclick = opt.onClose;
  // download the marked copy, bookmark, save to a case / client folder
  const mk = (fm) => async () => { try { await jBlob(`${base}/annotated/${fm}`, { marks }, (d.title || 'Judgment').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + ' - marked.' + fm); } catch (e) { toast(e.message, true); } };
  Q('#jaw').onclick = mk('docx'); Q('#jap').onclick = mk('pdf');
  Q('#jb').onclick = async () => { try { await saveResearch({ title: d.title || 'Judgment', body: meta, kind: 'Judgment', ref: key }); } catch (e) { toast(e.message, true); } };
  Q('#jc').onclick = async () => { const ms = await GET('/api/matters'); ask('Save to a case', [{ name: 'matter_id', label: 'Case', type: 'select', options: ms.map((x) => [x.id, x.file_no + ' — ' + x.title]) }], 'Save', async (v) => { await POST('/api/research/caselaw/to-case', { matter_id: v.matter_id, folder, id }); toast('Saved as a noting on the case.'); }); };
  const note = Q('#jn'), stampOn = () => Q('#jns').checked;
  Q('#jcl').onclick = () => jClientAsk('Save judgment in a client folder', 'Save', [
    { name: 'kind', label: 'What to save (goes into the Judgements folder of the client)', type: 'select', value: marks.length ? 'annotated_pdf' : 'pdf', options: [['pdf', 'Judgment — PDF'], ['docx', 'Judgment — Word'], ...(marks.length ? [['annotated_pdf', 'Judgment with my marks — PDF'], ['annotated_docx', 'Judgment with my marks — Word']] : [])] },
    ...(note.value.trim() ? [{ name: 'withnote', label: 'Also save my note', type: 'checkbox', value: true }] : [])], async (v) => {
    const rr = await POST('/api/research/caselaw/to-client', { client_id: v.client_id, folder, id, kind: v.kind, marks });
    if (v.withnote && note.value.trim()) await POST('/api/research/caselaw/note-to-client', { client_id: v.client_id, title: d.title || 'Judgment', sub: meta, note: note.value });
    toast('Saved in the client\'s Judgements folder' + (rr.name ? ': ' + rr.name : '') + '.');
  });
  // notes: kept as a draft on this device, saved separately or into a client folder; the date and time stamp can be switched on or off
  note.value = jLS('kc-jn:' + key) || ''; Q('#jns').checked = jLS('kc-jstamp') !== '0';
  const draft = () => jLS('kc-jn:' + key, note.value.trim() ? note.value : null);
  const put = (txt, a, b) => { note.setRangeText(txt, a, b, 'end'); draft(); };
  note.addEventListener('input', draft);
  note.addEventListener('focus', () => { if (stampOn() && !note.value.trim()) { note.value = jStamp() + ' '; note.setSelectionRange(note.value.length, note.value.length); draft(); } });
  note.addEventListener('keydown', (e) => {
    if (!stampOn() || e.key !== 'Enter' || e.shiftKey || e.isComposing) return; e.preventDefault();
    const v = note.value, p = note.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1;
    if (/^\[[^\]]*\]\s*$/.test(v.slice(ls, p))) { note.setRangeText('', ls, p, 'end'); put('\n', ls, ls); } else put('\n' + jStamp() + ' ', p, note.selectionEnd);
  });
  Q('#jns').onchange = () => jLS('kc-jstamp', stampOn() ? '1' : '0');
  Q('#jnst').onclick = () => { note.focus(); const p = note.selectionStart, pre = p && note.value[p - 1] !== '\n' && note.value[p - 1] !== ' ' ? ' ' : ''; put(pre + jStamp() + ' ', p, note.selectionEnd); };
  Q('#jnx').onclick = () => { if (!note.value.trim() || confirm('Clear this note?')) { note.value = ''; draft(); } };
  Q('#jnsave').onclick = async () => { const t = note.value.trim(); if (!t) { toast('Write a note first.', true); return; } try { await POST('/api/research/saved', { title: ('Note: ' + (d.title || 'Judgment')).slice(0, 240), body: t, kind: 'Note', ref: key }); toast('Note saved in My research.'); } catch (e) { toast(e.message, true); } };
  Q('#jnc').onclick = () => { const t = note.value.trim(); if (!t) { toast('Write a note first.', true); return; } jClientAsk('Save note in a client folder', 'Save', [], async (v) => { const rr = await POST('/api/research/caselaw/note-to-client', { client_id: v.client_id, title: d.title || 'Judgment', sub: meta, note: t }); toast('Note saved in the client\'s Judgements folder' + (rr.name ? ': ' + rr.name : '') + '.'); }); };
}
// the same reader in a pop-up (used from My research)
async function openJudgment(folder, id) {
  const m = show('Judgment', '<div id="jpm"></div>', true); judgmentPanel($('#jpm', m.el), folder, id);
}
async function caselawView(head, q0) {
  const st = await GET('/api/research/caselaw/status').catch(() => ({ on: false, courts: [] }));
  if (!st.on) { view(head + '<div class="card"><p class="mute">The case-law database is not connected yet. Please contact the portal provider.</p></div>'); return; }
  const picked = new Set(); let offset = 0, last = null;
  const MODES = [['text', 'Free text', ''], ['title', 'Case title / party', 'title:'], ['judge', 'Judge', 'judge:'], ['citation', 'Citation / case no.', 'citation:']]; let mode = 'text';
  const big = [...st.courts].sort((x, y) => (y.docs || 0) - (x.docs || 0));
  view(`${head}<div class="card"><form id="cf"><div class="tabs" id="cm2" style="margin-bottom:.5rem">${MODES.map(([k, l]) => `<a role="button" data-m="${k}" class="${k === mode ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="row" style="flex-wrap:nowrap"><input id="cq" placeholder="Words, “exact phrase”, AND / OR / NOT, w/5 for nearness" maxlength="300"><button class="btn">Search</button></div></form></div>
  <div style="display:grid;gap:1rem;align-items:start" class="clgrid" id="clg"><aside class="card" style="position:sticky;top:.5rem"><h3 style="margin:0 0 .5rem">Narrow by</h3>
    <label>Decided between</label><div class="row" style="gap:.4rem;flex-wrap:nowrap"><input id="cy1" type="number" placeholder="From" style="width:50%"><input id="cy2" type="number" placeholder="To" style="width:50%"></div>
    <label style="margin-top:.5rem">Sort</label><select id="cs"><option value="rank">Best match</option><option value="date">Newest first</option></select>
    <label style="margin-top:.5rem">Court <span class="mute" id="cn"></span></label><input id="cf2" placeholder="Find a court" style="margin-bottom:.3rem">
    <div id="cc" style="max-height:340px;overflow:auto">${big.map((c) => `<label class="chk" data-n="${esc((c.name || c.folder).toLowerCase())}" style="display:flex;gap:.4rem;margin:.15rem 0;font-weight:400"><input type="checkbox" data-f="${esc(c.folder)}"> <span style="flex:1">${esc(c.name || c.folder)}</span><span class="mute">${c.docs ? Number(c.docs).toLocaleString('en-IN') : ''}</span></label>`).join('')}</div>
    <button type="button" class="btn sm ghost" id="cclr" style="margin-top:.4rem">Clear courts</button><p class="mute" style="margin-top:.5rem">None ticked searches every court.</p></aside>
    <div><div id="cr"><div class="card"><p class="mute">Search Supreme Court and High Court judgments. Use the tabs to search only by title, judge or citation.</p></div></div><p class="mute">${esc(st.credit || '')}</p></div><div id="jpanel" hidden style="position:sticky;top:.5rem;max-height:calc(100vh - 1rem);overflow:auto"></div></div>
  <style>.clgrid{grid-template-columns:240px minmax(0,1fr)}.clgrid.pv{grid-template-columns:210px minmax(240px,.8fr) minmax(380px,1.5fr)}.main:has(.clgrid.pv){max-width:none}
  .clgrid.pv #cc{max-height:220px!important}.clgrid.pv .list .btn{padding:.3rem .6rem;min-height:32px}.clgrid.pv .list li.cur{background:#f4f1e8;margin:0 -.5rem;padding-left:.5rem;padding-right:.5rem;border-radius:6px}
  @media(max-width:1100px){.clgrid.pv{grid-template-columns:200px minmax(0,1fr)}.clgrid.pv #jpanel{grid-column:1/-1;position:static!important;max-height:none!important}}
  @media(max-width:800px){.clgrid,.clgrid.pv{grid-template-columns:1fr!important}}</style>`);
  const t = $('#cq'); t.value = q0 || '';
  const cnt = () => { $('#cn').textContent = picked.size ? '· ' + picked.size + ' chosen' : ''; };
  $$('#cc input').forEach((c) => (c.onchange = () => { c.checked ? picked.add(c.dataset.f) : picked.delete(c.dataset.f); cnt(); }));
  $('#cclr').onclick = () => { picked.clear(); $$('#cc input').forEach((c) => (c.checked = false)); cnt(); };
  $('#cf2').oninput = (e) => { const v = e.target.value.toLowerCase(); $$('#cc label').forEach((l) => (l.style.display = l.dataset.n.includes(v) ? 'flex' : 'none')); };
  $$('#cm2 a').forEach((a) => (a.onclick = () => { mode = a.dataset.m; $$('#cm2 a').forEach((x) => x.classList.toggle('on', x === a)); t.focus(); }));
  const card = (x) => `<li style="align-items:flex-start"><span style="flex:1"><b>${esc(x.title || 'Untitled')}</b><div class="mute">${esc([x.folder, x.case_no, x.decision_date || x.year, x.judge].filter(Boolean).join(' · '))}</div>${x.snip ? `<div style="margin-top:.25rem">${x.snip}</div>` : ''}</span><button class="btn sm ghost" data-o="${esc(x.folder)}/${x.id}">Open</button></li>`;
  const wire = () => $$('[data-o]').forEach((b) => (b.onclick = () => {
    const [f, i] = b.dataset.o.split('/'), pn = $('#jpanel'); $('#clg').classList.add('pv'); pn.hidden = false;
    $$('#cl li').forEach((li) => li.classList.toggle('cur', li.contains(b)));
    judgmentPanel(pn, f, i, { onClose: () => { pn.hidden = true; $('#clg').classList.remove('pv'); $$('#cl li').forEach((li) => li.classList.remove('cur')); } }); if (window.innerWidth <= 1100) pn.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const run = async (more) => {
    const v = t.value.trim(); if (v.length < 3) { $('#cr').innerHTML = '<p class="mute">Type at least three letters.</p>'; return; }
    if (!more) { offset = 0; $('#cr').innerHTML = '<p class="mute">Searching…</p>'; }
    try {
      const pre = (MODES.find((m) => m[0] === mode) || [])[2] || '', qv = pre && !/^(title|judge|citation):/i.test(v) ? pre + (/\s/.test(v) ? '"' + v.replace(/"/g, '') + '"' : v) : v;
      const r = await GET('/api/research/caselaw/search?' + qs({ q: qv, courts: [...picked].join(','), year_from: $('#cy1').value, year_to: $('#cy2').value, sort: $('#cs').value, offset, limit: 20 }));
      last = r; const items = r.results.map((x) => ({ ...x, folder: x.folder || (r.courts && r.courts.length === 1 ? r.courts[0] : x.folder) }));
      const list = items.map(card).join(''); offset += r.results.length;
      if (more) { $('#cl').insertAdjacentHTML('beforeend', list); } else $('#cr').innerHTML = `<div class="card"><h2>Judgments <span class="mute">${r.ms != null ? '· ' + r.ms + ' ms' : ''}${picked.size ? ' · ' + picked.size + ' court(s)' : ' · all courts'}</span></h2>${list ? `<ul class="list" id="cl">${list}</ul>` : '<p class="mute">No judgments matched. Try fewer words or another court.</p>'}<div id="cm"></div></div>`;
      $('#cm').innerHTML = r.more ? '<button class="btn sm ghost" id="cmore">Show more</button>' : ''; const mb = $('#cmore'); if (mb) mb.onclick = () => run(true); wire();
    } catch (e) { $('#cr').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#cf').onsubmit = (e) => { e.preventDefault(); run(false); };
  if (q0) run(false);
}
