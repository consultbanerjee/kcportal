/* ===== Case arguments: Argument note + Drawbacks note, researched authorities, nightly update ===== */
/* Word / PDF download of a table shown on screen (registers, chat and activity records) */
async function dlTable(fmt, title, subtitle, cols, rows, restricted) {
  try {
    const r = await fetch('/api/export/' + fmt, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kcportal' }, body: JSON.stringify({ title, subtitle, cols, rows, restricted }) });
    if (!r.ok) { let m = 'Could not make the file.'; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = title.replace(/[\\/:*?"<>|]+/g, '-') + '.' + fmt; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { toast(e.message, true); }
}
const dlBtns = (id, label) => `<button class="btn sm ghost" data-dl="docx" data-for="${id}">Word</button><button class="btn sm ghost" data-dl="pdf" data-for="${id}">PDF</button>`;
const ARG_NAMES = { argument: 'Argument', drawback: 'Drawbacks' };
const argDl = (mid, k, a) => (a && a.has ? `<a class="btn sm" href="/api/matters/${mid}/args/${k}/download/docx">Word</a><a class="btn sm" href="/api/matters/${mid}/args/${k}/download/pdf">PDF</a>` : '');
const precBadge = (x) => { const st = String(x.treatment_status || 'unclear'); const bad = /overrul|revers|set aside/.test(st), warn = /doubt|distinguish|larger bench|per incuriam/.test(st), good = st === 'good law';
  return bad ? `<b class="err">✖ ${esc(st.toUpperCase())}</b>` : warn ? `<b style="color:#b26a00">⚠ ${esc(st)}</b>` : good ? '✔ still good law' : '<span class="mute">status not clear — check</span>'; };
const argState = (a) => (!a ? '<span class="mute">Not prepared yet</span>' : a.status === 'working' ? '<span class="mute">Being prepared… (a few minutes)</span>' : a.status === 'failed' ? `<span class="err">Could not be prepared: ${esc(a.error || '')}</span>` : `<span class="mute">Updated ${dt((a.updated_at || '').slice(0, 10))}</span>`);

async function argCard(mid) {
  const host = $('#acard'); if (!host) return; let a; try { a = await GET(`/api/matters/${mid}/args`); } catch (e) { host.remove(); return; }
  const col = (k) => `<div style="flex:1;min-width:230px"><b>${ARG_NAMES[k]}</b><div>${argState(a[k])}</div><div class="row" style="margin-top:.4rem">${argDl(mid, k, a[k])}</div></div>`;
  const hist = `<div style="flex:1;min-width:230px"><b>Case history</b><div><span class="mute">Dated chronology of the case, always current</span></div><div class="row" style="margin-top:.4rem"><a class="btn sm" href="/api/matters/${mid}/history/docx">Word</a><a class="btn sm" href="/api/matters/${mid}/history/pdf">PDF</a><button class="btn sm ghost" id="hsv">Keep a copy in Files</button></div></div>`;
  host.innerHTML = `<div class="row sp"><h2>Case history, arguments and drawbacks</h2><a class="btn sm gold" href="#/args/${mid}">${a.argument || a.drawback ? 'Open arguments' : 'Prepare arguments'}</a></div>
    <div class="row" style="gap:1.2rem;flex-wrap:wrap;align-items:flex-start">${hist}${col('argument')}${col('drawback')}</div>
    <p class="mute">Prepared from ${a.files} document${a.files === 1 ? '' : 's'} in this case's folder.</p>`;
  if ($('#hsv')) $('#hsv').onclick = async (e) => { e.target.disabled = true; try { await POST(`/api/matters/${mid}/history/save`, {}); toast('Saved in Files → Case history (Word and PDF). It is refreshed every night.'); } catch (x) { toast(x.message, true); } e.target.disabled = false; };
  if ((a.argument && a.argument.status === 'working') || (a.drawback && a.drawback.status === 'working')) setTimeout(() => { if ($('#acard')) argCard(mid); }, 8000);
}

route(/^\/args\/(\d+)$/, async ([id]) => {
  let m, a; try { [m, a] = await Promise.all([GET('/api/matters/' + id), GET(`/api/matters/${id}/args`)]); } catch (e) { view(`<div class="card"><p class="err">${esc(e.message)}</p></div>`); return; }
  const mm = m.matter || m, busy = [a.argument, a.drawback].some((x) => x && x.status === 'working');
  const block = (k) => { const x = a[k]; return `<div class="card" style="flex:1;min-width:300px"><div class="row sp"><h2>${ARG_NAMES[k]}</h2><div class="row">${argDl(id, k, x)}</div></div><div>${argState(x)}</div>
    ${x && x.has ? `<details data-k="${k}"><summary>Read it here</summary><pre class="argtxt" style="white-space:pre-wrap;font-family:inherit;max-height:60vh;overflow:auto">Loading…</pre></details>` : ''}
    ${x && x.notes ? `<details><summary>Notes for the advocate</summary><pre style="white-space:pre-wrap;font-family:inherit">${esc(x.notes)}</pre></details>` : ''}</div>`; };
  const auth = a.authorities || [];
  view(`<a class="btn ghost sm" href="#/matter/${id}">← ${esc(mm.file_no || 'Case')}</a>
    <div class="row sp"><h1>Arguments — ${esc(mm.title || '')}</h1></div>
    <div class="card"><p>The portal reads <b>${a.files}</b> document${a.files === 1 ? '' : 's'} in this case's folder (petition, annexures, orders, judgments), looks for supporting and adverse judgments, and prepares the <b>Argument</b> for the prayer and a separate <b>Drawbacks</b> note showing what the other side may argue. Both are saved under <i>Files → Arguments</i>. Every night at 3 am they are redone if anything in the case has changed (new order, new document, new date).</p>
      ${a.ready ? '' : '<p class="err">AI is not set up yet. Please ask the portal provider to activate it.</p>'}
      <form id="af"><label>Anything to stress or avoid (optional)<textarea name="instruction" rows="2" placeholder="e.g. rely mainly on Section 16B; the other side will raise limitation">${esc(a.cfg.instruction || '')}</textarea></label>
        <div class="row"><button class="btn gold" id="go" ${busy || !a.ready ? 'disabled' : ''}>${busy ? 'Being prepared…' : a.argument || a.drawback ? 'Prepare again now' : 'Prepare now'}</button></div></form></div>
    <div class="row" style="gap:1rem;flex-wrap:wrap;align-items:flex-start">${block('argument')}${block('drawback')}</div>
    <div class="card"><h2>Precedents relied on in this case <span class="mute">(${(a.precedents || []).length})</span></h2>${(a.precedents || []).length ? `<div class="tw"><table><tr><th>Precedent</th><th>Relied on for</th><th>Is it still good law?</th><th>Saved in Files as</th></tr>${a.precedents.map((x) => `<tr${/overrul|revers|set aside/.test(x.treatment_status || '') ? ' style="background:#fff3f1"' : ''}><td><b>${esc(x.title)}</b><br><span class="mute">${esc([x.court, x.citation, x.jdate && dt(x.jdate)].filter(Boolean).join(' · '))}</span>${x.url && /^https/.test(x.url) ? ` <a target="_blank" rel="noopener" href="${esc(x.url)}">read</a>` : ''}</td><td>${esc(x.relied_for || '—')}</td>
      <td>${precBadge(x)}<br><span class="mute">${esc(x.treatment || '')}</span>${x.treatment_url ? ` <a target="_blank" rel="noopener" href="${esc(x.treatment_url)}">later judgment</a>` : ''}<br><span class="mute">${x.confirmed ? 'confirmed by reading the later judgment' : /overrul|revers|set aside|doubt|distinguish/.test(x.treatment_status || '') ? 'reported by search — verify before acting' : ''}</span></td><td>${esc(x.saved_name || (x.verified ? '—' : x.note || 'not found'))}</td></tr>`).join('')}</table></div><p class="mute">The portal reads each precedent the papers rely on and checks later Indian judgments for overruling, reversal or distinguishing. If one has been overruled, the Argument says so and builds the alternative route.</p>` : '<p class="mute">The papers do not seem to rely on any reported precedent, or none has been checked yet.</p>'}</div>
    <div class="card"><h2>Judgments found <span class="mute">(${auth.length})</span></h2>${auth.length ? `<div class="tw"><table><tr><th>For / against</th><th>Case</th><th>Checked</th><th>Saved in Files as</th></tr>${auth.map((x) => `<tr><td>${x.side === 'for' ? 'Supports us' : 'Other side'}${x.scope ? `<br><span class="mute">${esc(x.scope)}</span>` : ''}${x.kind === 'overruling' ? '<br><b class="err">affects a precedent</b>' : ''}${x.kind === 'solution' ? '<br><b>way forward</b>' : ''}</td>
      <td><b>${esc(x.title)}</b><br><span class="mute">${esc([x.court, x.citation, x.jdate && dt(x.jdate)].filter(Boolean).join(' · '))}</span><br>${esc(x.proposition || '')} ${x.url ? `<a target="_blank" rel="noopener" href="${esc(x.url)}">source</a>` : ''}</td>
      <td>${x.verified ? '✔ matches the source page' : '<span class="err">not verified</span>'}<br><span class="mute">${esc(x.note || '')}</span></td><td>${esc(x.saved_name || (x.side === 'for' ? '—' : 'not saved (adverse)'))}</td></tr>`).join('')}</table></div><p class="mute">Only Indian courts and tribunals are searched (the same tribunal first in tribunal cases). Supporting judgments that match their source are saved as "Party vs Party _ date" in Files → Judgements → this case → Authorities. Always check a judgment against the certified copy before citing it in court.</p>` : '<p class="mute">None yet.</p>'}</div>`);
  const read = () => ({ instruction: $('#af').instruction.value });
  $('#af').onsubmit = async (e) => { e.preventDefault(); const v = read(); try { await POST(`/api/matters/${id}/args/generate`, { instruction: v.instruction }); toast('Started. This takes a few minutes; you can leave this page.'); go(); } catch (x) { toast(x.message, true); } };
  $$('details[data-k]').forEach((d) => d.addEventListener('toggle', async () => { if (!d.open || d.dataset.done) return; d.dataset.done = 1; try { const r = await GET(`/api/matters/${id}/args/${d.dataset.k}`); d.querySelector('pre').textContent = r.output; } catch (x) { d.querySelector('pre').textContent = x.message; } }));
  if (busy) setTimeout(() => { if (location.hash === '#/args/' + id) go(); }, 8000);
});
