'use strict';
/* ===== Super Admin Dashboard (home): six compact boxes — date and time, disk, server, renewals, recurring usage and bills, case law engine ===== */
const dbSpark = (pts, max, col) => {
  if (!pts || pts.length < 2) return '<div class="mute" style="font-size:10px">Collecting data…</div>';
  const W = 200, H = 38, m = Math.max(max || 0, ...pts) || 1, xy = pts.map((v, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(H - 2 - (v / m) * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:38px;background:#f4f4f1;border-radius:5px;display:block"><polyline fill="none" stroke="${col || '#2a5db0'}" stroke-width="1.8" points="${xy}"/></svg>`;
};
const dbRing = (pc, big, small) => {
  const col = pc > 85 ? '#b3261e' : pc > 70 ? '#c77700' : '#1b7f4b', R = 26, C = 2 * Math.PI * R;
  return `<div style="display:flex;align-items:center;gap:.6rem"><svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="${R}" fill="none" stroke="#e6e6e6" stroke-width="8"/><circle cx="32" cy="32" r="${R}" fill="none" stroke="${col}" stroke-width="8" stroke-dasharray="${(C * pc / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="36" text-anchor="middle" font-size="13" font-weight="700" fill="#1c2230">${pc}%</text></svg><div><b style="font-size:13px">${big}</b><div class="mute" style="font-size:11px">${small}</div></div></div>`;
};
const dbMini = (label, used, total, extra) => {
  const pc = total ? Math.min(100, Math.round(used / total * 100)) : 0, col = pc > 85 ? '#b3261e' : pc > 70 ? '#c77700' : '#1b7f4b';
  return `<div style="margin:.3rem 0"><div class="row sp" style="font-size:11px"><span>${esc(label)}</span><span class="mute">${gb(used)} / ${total ? gb(total) : '—'} · ${pc}%${extra ? ' · ' + esc(extra) : ''}</span></div><div style="background:#e6e6e6;border-radius:5px;height:8px;overflow:hidden"><div style="width:${pc}%;background:${col};height:100%"></div></div></div>`;
};
const dbUp = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? d + ' d ' + h + ' h' : h + ' h ' + Math.floor((s % 3600) / 60) + ' m'; };
let dbClock = null, dbAgain = null;

route(/^\/dashboard$/, async () => {
  clearInterval(dbClock); clearInterval(dbAgain);
  view('<h1 style="margin:.1rem 0 .5rem">Dashboard</h1><p class="mute">Loading…</p>');
  const ok = (p) => p.catch(() => null);
  const [S, U, B, E] = await Promise.all([ok(GET('/api/platform/server')), ok(GET('/api/platform/usage')), ok(GET('/api/platform/billing')), ok(GET('/api/platform/caselaw/engine'))]);
  const box = (title, link, inner) => `<section class="dbx"><div class="row sp" style="margin-bottom:.35rem"><h3>${title}</h3>${link ? `<a href="${link[0]}" class="dbl">${link[1]}</a>` : ''}</div>${inner}</section>`;
  const n = S && S.now, h = (S && S.history) || [];
  // 1 date and time
  const b1 = box('Date and time', null, `<div id="dbt" style="font:700 30px/1.1 Georgia,serif;color:var(--navy)">--:--:--</div><div id="dbd" style="margin-top:.2rem;font-size:13px"></div><div class="mute" style="font-size:11px;margin-top:.3rem">Indian Standard Time${n ? ' · server up ' + dbUp(n.uptime) : ''}</div>
    ${(() => { const nx = ((S && S.renewals) || []).filter((r) => r.days !== null && r.days >= 0).sort((a, b) => a.days - b.days)[0]; return nx ? `<div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--line);font-size:11.5px"><span class="mute">Next renewal</span><br><b>${esc(nx.name)}</b> — ${dt(nx.due)} (${nx.days} day${nx.days === 1 ? '' : 's'})</div>` : ''; })()}
    <div class="mute" style="font-size:10px;margin-top:.4rem">Page loaded ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</div>`);
  // 2 disk
  const dk = n && n.disk, dr = S && S.drive;
  const b2 = box('Disk space', ['#/firms?tab=server', 'Details'], !S ? '<p class="mute">Not available.</p>' : `${dk ? dbRing(Math.round(dk.used / dk.total * 100), 'Server disk ' + gb(dk.used) + ' of ' + gb(dk.total), gb(dk.free) + ' free') : ''}
    <div style="margin-top:.4rem">${dr && !dr.error ? dbMini('Google Drive', dr.usage, dr.limit, 'bin ' + gb(dr.trash)) : '<div class="mute" style="font-size:11px">Google Drive figures not available.</div>'}</div>
    <div class="mute" style="font-size:10px;margin-top:.3rem">Disk used, last 3 days</div>${dbSpark(h.filter((x) => x.disk_pct != null).map((x) => x.disk_pct), 100, '#7a4fb0')}
    <div class="mute" style="font-size:11px;margin-top:.3rem">${(S.data || []).slice().sort((a, b) => b.mb - a.mb).slice(0, 3).map((x) => esc(x.name) + ' ' + (x.mb >= 1024 ? (x.mb / 1024).toFixed(1) + ' GB' : x.mb + ' MB')).join(' · ')}</div>`);
  // 3 server
  const cell = (k, v) => `<div style="background:#f4f1e8;border-radius:6px;padding:.25rem .4rem"><div class="mute" style="font-size:10px">${k}</div><b style="font-size:12.5px">${v}</b></div>`;
  const b3 = box('Server', ['#/firms?tab=server', 'Details'], !n ? '<p class="mute">Not available.</p>' : `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem">${cell('CPU load', n.load.map((x) => x.toFixed(2)).join(' / '))}${cell('CPUs', n.cpus)}${cell('Memory', gb(n.mem_total - n.mem_free) + ' / ' + gb(n.mem_total))}${cell('Portal uses', n.rss_mb + ' MB')}${cell('Database', n.db_mb + ' MB')}${cell('Portal up', dbUp(n.proc_up))}</div>
    <div class="mute" style="font-size:10px;margin:.4rem 0 .1rem">CPU load (peak ${h.length ? Math.max(...h.map((x) => x.load1)).toFixed(1) : '—'})</div>${dbSpark(h.map((x) => x.load1), n.cpus, '#2a5db0')}
    <div class="mute" style="font-size:10px;margin:.3rem 0 .1rem">Memory used % (peak ${h.length ? Math.max(...h.map((x) => x.mem_pct)).toFixed(0) : '—'})</div>${dbSpark(h.map((x) => x.mem_pct), 100, '#c77700')}`);
  // 4 renewals
  const rn = ((S && S.renewals) || []).slice().sort((a, b) => (a.days == null) - (b.days == null) || a.days - b.days);
  const over = rn.filter((r) => r.days !== null && r.days < 0).length, soon = rn.filter((r) => r.days !== null && r.days >= 0 && r.days <= 30).length;
  const b4 = box('Expiry and renewals', ['#/firms?tab=server', 'Manage'], !S ? '<p class="mute">Not available.</p>' : `<div style="margin-bottom:.3rem">${over ? pill(over + ' overdue', 'bad') + ' ' : ''}${soon ? pill(soon + ' within 30 days', 'warn') + ' ' : ''}${!over && !soon ? pill('nothing pending', 'ok') : ''}</div>
    <table class="dbt"><tbody>${rn.slice(0, 8).map((r) => `<tr><td>${esc(r.name)}</td><td class="mute">${r.due ? dt(r.due) : 'no date'}</td><td style="text-align:right">${r.days === null ? pill('set date', 'warn') : r.days < 0 ? pill('overdue ' + (-r.days) + ' d', 'bad') : pill(r.days + ' d', r.days <= 30 ? 'warn' : 'ok')}</td></tr>`).join('') || '<tr><td class="mute">No renewals added.</td></tr>'}</tbody></table>${rn.length > 8 ? `<div class="mute" style="font-size:10px">+ ${rn.length - 8} more</div>` : ''}`);
  // 5 recurring usage and bills
  const due = (B || []).filter((r) => r.status === 'due'), od = due.filter((r) => r.overdue), dueSum = due.reduce((s, r) => s + (r.total_paise || 0), 0);
  const b5 = box('Recurring usage and bills', ['#/firms?tab=billing', 'Billing'], `${U ? `<div class="mute" style="font-size:10px">Claude (AI), ${esc(U.month)}</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem;margin:.2rem 0 .4rem">${cell('Calls', U.firms.reduce((s, f) => s + (f.calls || 0), 0))}${cell('Our cost', inr(U.total_cost_paise))}${cell('To bill', inr(U.total_bill_paise))}</div>` : '<p class="mute">Usage not available.</p>'}
    ${B ? `<div class="mute" style="font-size:10px">Firm invoices</div><div style="margin:.2rem 0">${due.length ? pill(due.length + ' unpaid · ' + inr(dueSum), od.length ? 'warn' : '') : pill('none unpaid', 'ok')} ${od.length ? pill(od.length + ' overdue', 'bad') : ''}</div>
    <table class="dbt"><tbody>${B.slice(0, 4).map((r) => `<tr><td>${esc(r.firm)}</td><td class="mute">${esc(r.kind === 'monthly' ? r.period : (r.note || '').slice(0, 18))}</td><td style="text-align:right">${inr(r.total_paise)}</td><td>${r.status === 'paid' ? pill('paid', 'ok') : r.overdue ? pill('overdue', 'bad') : r.status === 'due' ? pill('due', 'warn') : pill(r.status)}</td></tr>`).join('') || '<tr><td class="mute">No invoices yet.</td></tr>'}</tbody></table>` : ''}`);
  // 6 case law engine
  const run = E && E.run, tot = E ? E.courts.reduce((s, c) => s + (c.docs || 0), 0) : 0, pdfs = E ? E.courts.reduce((s, c) => s + (c.pdfs || 0), 0) : 0;
  const b6 = box('Case law engine', ['#/firms?tab=caselaw', 'Open'], !E ? `<p class="mute">${pill('not reachable', 'bad')}</p>` : `<div style="margin-bottom:.35rem">${run.running ? pill('working on ' + run.current, 'ok') : run.paused ? pill('paused', 'warn') : pill('idle')} ${E.drive.connected ? pill('Drive linked', 'ok') : pill('Drive not linked', 'bad')}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem">${cell('Judgments', tot.toLocaleString('en-IN'))}${cell('PDFs in Drive', pdfs.toLocaleString('en-IN'))}${cell('Disk free', run.free_gb + ' GB')}</div>
    <div class="mute" style="font-size:11px;margin-top:.4rem">Last daily run: ${esc(run.last_run || 'never')}${run.queued && run.queued.length ? ' · queued: ' + esc(run.queued.join(', ')) : ''}</div>
    <div class="mute" style="font-size:11px">${E.courts.filter((c) => c.last_status && c.last_status !== 'ok' && c.tier !== 'off').slice(0, 3).map((c) => esc(c.name) + ': ' + esc(c.last_status)).join(' · ')}</div>`);
  view(`<style>.dbg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}.dbx{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.6rem .75rem;min-width:0;font-size:12px}
    .dbx h3{margin:0;font:700 13px Georgia,serif}.dbl{font-size:11px}.dbt{width:100%;border-collapse:collapse}.dbt td{padding:.12rem .2rem;border-bottom:1px solid #f0ede4;font-size:11.5px}.dbt tr:last-child td{border:0}
    @media(max-width:1000px){.dbg{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.dbg{grid-template-columns:1fr}}</style>
    <div class="row sp" style="margin-bottom:.4rem"><h1 style="margin:0;font-size:20px">Dashboard</h1><span class="mute" style="font-size:11px">Refreshes every minute</span></div>
    <div class="dbg">${b1}${b2}${b3}${b4}${b5}${b6}</div>`);
  const tick = () => { const t = $('#dbt'); if (!t) { clearInterval(dbClock); return; } const d = new Date(), o = { timeZone: 'Asia/Kolkata' };
    t.textContent = d.toLocaleTimeString('en-GB', { ...o, hour12: false }); $('#dbd').textContent = d.toLocaleDateString('en-IN', { ...o, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); };
  tick(); dbClock = setInterval(tick, 1000);
  dbAgain = setInterval(() => { if (!$('#dbt')) { clearInterval(dbAgain); return; } if (location.hash === '#/dashboard') go(); }, 60000);
});
