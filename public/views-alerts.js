/* ===== Alerts (Settings) — weekly self-test results; the Admin ticks "Action taken" ===== */
route(/^\/alerts$/, async () => {
  if (ME.role !== 'admin') { view('<p class="mute">Only the firm administrator can see Alerts.</p>'); return; }
  const d = await GET('/api/alerts'), open = d.alerts.filter((a) => a.status === 'open'), rest = d.alerts.filter((a) => a.status !== 'open');
  const when = (s) => (s ? dt(String(s).slice(0, 10)) : '—');
  const SEV = { high: 'Serious', medium: 'Needs attention', low: 'Minor', info: 'For your information' };
  const card = (a) => `<div class="alrt ${a.severity} ${a.status === 'open' ? '' : 'done'}"><div class="row sp"><div><span class="sevtag">${SEV[a.severity] || ''}</span> <span class="mute">· ${esc(a.area || '')}</span></div><span class="mute" style="font-size:.78rem">First found ${when(a.first_seen)}${a.times > 1 ? ' · seen ' + a.times + ' times' : ''}${a.reopened && a.status === 'open' ? ' · <b>came back after being marked done</b>' : ''}</span></div>
    <h4>${esc(a.title)}</h4><div class="mute">${esc(a.detail || '')}</div>
    <div class="row sp" style="margin-top:.4rem"><label class="chk" style="margin:0"><input type="checkbox" class="act" data-id="${a.id}" ${a.status === 'open' ? '' : 'checked'}> <b>Action taken</b>${a.status !== 'open' ? ` <span class="mute">— ${esc(a.resolved_by || '')} · ${when(a.resolved_at)}</span>` : ''}</label>${a.href ? `<a class="btn sm ghost" href="${esc(a.href)}">Go there</a>` : ''}</div></div>`;
  view(`<div class="row sp"><h1>Alerts</h1><button class="btn gold sm" id="run">Run the test now</button></div>
    <p class="mute">The portal tests itself every week — clients, invoices and accounts, bank entries, settings, AI, team, links and the server — and lists every fault here. Tick <b>Action taken</b> when you have dealt with a fault. A fault that disappears is cleared automatically; one still present at the next test comes back marked.</p>
    <p class="mute">Last test: <b>${d.last_run ? esc(d.last_run.slice(0, 16)) + ' UTC' : 'not yet run'}</b>${d.next_due ? ' · next automatic test after ' + when(d.next_due) : ''}</p>
    <div class="card"><h3>To do <span class="mute">(${open.length})</span></h3>${open.length ? open.map(card).join('') : '<p class="mute">No faults found. ✔</p>'}</div>
    ${rest.length ? `<div class="card"><h3>Done and cleared <span class="mute">(${rest.length})</span></h3>${rest.map(card).join('')}</div>` : ''}`);
  $$('.act').forEach((c) => (c.onchange = async () => { try { await POST(`/api/alerts/${c.dataset.id}/action`, { done: c.checked }); go(); } catch (e) { toast(e.message, true); c.checked = !c.checked; } }));
  $('#run').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Testing…'; try { const r = await POST('/api/alerts/run', {}); toast(`Test finished: ${r.found} found, ${r.added} new, ${r.cleared} cleared`); go(); } catch (x) { toast(x.message, true); e.target.disabled = false; e.target.textContent = 'Run the test now'; } };
});
