/* ===== Filing forums (e-filing guide): catalogue + the firm's own forums + PDF size check ===== */
route(/^\/forums$/, async (_m, p) => {
  const d = await GET('/api/filing-forums'), edit = can('admin', 'advocate', 'staff'), q = (p.get('q') || '').toLowerCase();
  const LV = { A: 'Assisted filing', B: 'Online complaint', C: 'No online filing found', '?': 'Not yet checked' };
  const all = [...d.catalog.map((f) => ({ ...f, std: true })), ...d.custom.map((f) => ({ ...f, std: false, automation: '?', status: 'yours', max_file_mb: f.max_file_mb }))];
  const rows = all.filter((f) => !q || (f.name + ' ' + (f.type || '') + ' ' + (f.notes || '')).toLowerCase().includes(q));
  const lvPill = (f) => pill(LV[f.automation] || '—', f.automation === 'A' ? 'ok' : f.automation === 'C' ? 'bad' : '');
  const card = (f) => `<div class="card"><div class="row sp"><h3 style="margin:0">${esc(f.name)}</h3><span>${f.std ? lvPill(f) + (f.status === 'to_verify' ? ' ' + pill('to verify') : '') : pill('yours')}</span></div>
    <div class="mute">${esc(f.type || '')}</div>
    ${f.portal_url ? `<p style="margin:.4rem 0"><a href="${esc(f.portal_url)}" target="_blank" rel="noopener noreferrer">${esc(f.portal_url)}</a></p>` : ''}
    <table class="kv"><tr><td class="mute">Login</td><td>${esc(f.login || '—')}</td></tr><tr><td class="mute">Signing</td><td>${esc(f.signing || '—')}</td></tr>
    <tr><td class="mute">Largest file</td><td>${f.max_file_mb ? f.max_file_mb + ' MB' : 'not confirmed'}</td></tr>${f.format ? `<tr><td class="mute">Format</td><td>${esc(f.format)}</td></tr>` : ''}${f.payment ? `<tr><td class="mute">Fees</td><td>${esc(f.payment)}</td></tr>` : ''}</table>
    ${f.notes ? `<p class="mute" style="margin:.4rem 0">${esc(f.notes)}</p>` : ''}
    ${!f.std && edit ? `<button class="btn sm ghost" data-rm="${f.id}">Remove</button>` : ''}</div>`;
  view(`<div class="row sp"><h1>Filing forums</h1>${edit ? '<button class="btn" id="af">Add a forum</button>' : ''}</div>
    <p class="mute">Courts, tribunals and forums with their e-filing portal, login, signing method and file-size limit. ${esc(d.region || '')} list as checked on ${esc(d.updated || '')}; forums marked <b>to verify</b> have not been checked yet.</p>
    <div class="card"><h3>How filing works here</h3><p class="mute" style="margin:.2rem 0">The portal never stores your login passwords. Log in on the court's own site yourself (captcha and OTP), prepare the filing, then sign with your DSC or Aadhaar e-Sign, pay the fee and submit. The portal prepares and checks your PDFs.</p></div>
    <div class="card"><h3>Prepare for filing</h3><p class="mute" style="margin:.2rem 0 .5rem">Join your PDFs in the order you want into one filing set with an index, bookmarks and page numbers. If the forum has a size limit, the set is shrunk or split to fit.</p>
      <div class="row noprint" style="flex-wrap:wrap"><select id="pf">${all.map((f) => `<option value="${esc(f.std ? f.id : 'f' + f.id)}">${esc(f.name)}${f.max_file_mb ? ' — ' + f.max_file_mb + ' MB' : ''}</option>`).join('')}</select><input id="pt" placeholder="Title of the set (e.g. Writ Petition with annexures)" style="flex:1;min-width:200px"><input type="file" id="pp" accept="application/pdf" multiple></div>
      <div id="pl" style="margin:.5rem 0"></div>
      <label class="chk"><input type="checkbox" id="pi" checked> Add an index page</label> <label class="chk"><input type="checkbox" id="pn" checked> Number the pages</label>
      <div class="row noprint" style="margin-top:.5rem"><button class="btn" id="pb" disabled>Prepare</button><span id="ps" class="mute"></span></div><div id="po" style="margin-top:.6rem"></div></div>
    <div class="card"><h3>PDF size check</h3><div class="row noprint"><select id="fz">${all.filter((f) => f.max_file_mb).map((f) => `<option value="${f.max_file_mb}">${esc(f.name)} — ${f.max_file_mb} MB</option>`).join('')}</select><input type="file" id="fp" accept="application/pdf" multiple></div><div id="fr" class="mute" style="margin-top:.4rem">Choose a forum and your PDF(s). Nothing is uploaded; the check happens on your computer.</div></div>
    <div class="row noprint" style="margin-bottom:.8rem"><input id="q" placeholder="Search forums" value="${esc(p.get('q') || '')}" style="flex:1;min-width:180px"></div>
    ${rows.map(card).join('') || '<div class="card mute">Nothing matches.</div>'}`);
  const chk = () => { const lim = parseFloat($('#fz').value) || 0, fs = [...($('#fp').files || [])]; if (!fs.length) { $('#fr').textContent = 'Choose a forum and your PDF(s). Nothing is uploaded; the check happens on your computer.'; return; }
    $('#fr').innerHTML = fs.map((f) => { const mb = f.size / 1048576, okk = mb <= lim, pdf = /\.pdf$/i.test(f.name); return `<div>${esc(f.name)} — <b>${mb.toFixed(2)} MB</b> ${!pdf ? pill('not a PDF', 'bad') : okk ? pill('within ' + lim + ' MB', 'ok') : pill('over ' + lim + ' MB — compress or split', 'bad')}</div>`; }).join(''); };
  const fz = $('#fz'), fp = $('#fp'); if (fz) fz.onchange = chk; if (fp) fp.onchange = chk;
  let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = '#/forums' + (e.target.value ? '?q=' + encodeURIComponent(e.target.value) : ''); }, 300); });
  // ---- Prepare for filing
  let pfiles = [];
  const plist = () => { $('#pl').innerHTML = pfiles.length ? `<ol class="list" style="padding-left:1.2rem">${pfiles.map((f, i) => `<li style="display:flex;gap:.4rem;align-items:center"><span style="flex:1;min-width:0">${esc(f.file.name)} <span class="mute">${(f.file.size / 1048576).toFixed(2)} MB</span><input data-t="${i}" value="${esc(f.title)}" style="width:100%" title="Name shown in the index and bookmarks"></span><button class="btn sm ghost" data-up="${i}">↑</button><button class="btn sm ghost" data-dn="${i}">↓</button><button class="btn sm ghost" data-x="${i}">✕</button></li>`).join('')}</ol>` : '<span class="mute">No PDFs chosen yet.</span>'; $('#pb').disabled = !pfiles.length;
    $$('[data-t]').forEach((x) => (x.oninput = () => { pfiles[+x.dataset.t].title = x.value; })); const mv = (i, d) => { const j = i + d; if (j < 0 || j >= pfiles.length) return; [pfiles[i], pfiles[j]] = [pfiles[j], pfiles[i]]; plist(); };
    $$('[data-up]').forEach((b) => (b.onclick = () => mv(+b.dataset.up, -1))); $$('[data-dn]').forEach((b) => (b.onclick = () => mv(+b.dataset.dn, 1))); $$('[data-x]').forEach((b) => (b.onclick = () => { pfiles.splice(+b.dataset.x, 1); plist(); })); };
  plist();
  $('#pp').onchange = (e) => { for (const f of e.target.files) pfiles.push({ file: f, title: f.name.replace(/\.pdf$/i, '').replace(/_+/g, ' ') }); e.target.value = ''; plist(); };
  $('#pb').onclick = async () => {
    const fd = new FormData(); fd.append('forum', $('#pf').value); fd.append('title', $('#pt').value); fd.append('index', $('#pi').checked ? '1' : '0'); fd.append('numbers', $('#pn').checked ? '1' : '0'); fd.append('titles', JSON.stringify(pfiles.map((f) => f.title))); pfiles.forEach((f) => fd.append('files', f.file, f.file.name));
    $('#pb').disabled = true; $('#ps').textContent = 'Working… large sets can take a minute.'; $('#po').innerHTML = '';
    try { const r = await POST('/api/filing-prep', fd); $('#ps').textContent = '';
      if (r.mode === 'each') { $('#po').innerHTML = `<p><b>${esc(r.forum)}</b> — limit ${r.limit_mb} MB for each document</p><ul class="list">${r.rows.map((x) => `<li><span>${esc(x.name)} <span class="mute">${x.mb} MB</span></span>${x.ok ? pill('within limit', 'ok') : pill('over the limit', 'bad')}</li>`).join('')}</ul>${r.notes.map((n) => `<p class="mute">${esc(n)}</p>`).join('')}`; }
      else $('#po').innerHTML = `<p><b>${r.pages} pages</b>${r.limit_mb ? ' · limit ' + r.limit_mb + ' MB' : ''}${r.forum ? ' · ' + esc(r.forum) : ''}</p><ul class="list">${r.parts.map((x) => `<li><span>${esc(x.name)} <span class="mute">${x.mb} MB · pages ${x.from}–${x.to}</span></span><span>${x.ok ? pill('fits', 'ok') : pill('over the limit', 'bad')} <a class="btn sm" href="/api/filing-prep/${r.token}/${x.n}">Download</a></span></li>`).join('')}</ul>${r.notes.map((n) => `<p class="mute">${esc(n)}</p>`).join('')}<details><summary class="mute">Index of this set</summary><ol class="list">${r.contents.map((c) => `<li><span>${esc(c.title)}</span><span class="mute">page ${c.from}${c.pages > 1 ? '–' + (c.from + c.pages - 1) : ''}</span></li>`).join('')}</ol></details>`;
    } catch (e) { $('#ps').textContent = ''; $('#po').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    $('#pb').disabled = !pfiles.length;
  };
  const af = $('#af'); if (af) af.onclick = () => ask('Add a forum', [{ name: 'name', label: 'Court / forum name', required: true }, { name: 'type', label: 'Type (e.g. Tribunal)' }, { name: 'portal_url', label: 'E-filing portal address', ph: 'https://' }, { name: 'login', label: 'How you log in' }, { name: 'signing', label: 'Signing (DSC / e-Sign)' }, { name: 'max_file_mb', label: 'Largest file in MB (optional)' }, { name: 'notes', label: 'Notes (optional)' }], 'Add', async (v) => { await POST('/api/filing-forums', v); go(); });
  $$('[data-rm]').forEach((b) => (b.onclick = async () => { if (sure('Remove this forum?')) { await DEL('/api/filing-forums/' + b.dataset.rm); go(); } }));
}, { office: true });
