'use strict';
/* ===== consultation booking: public visitors and signed-in clients ===== */
function pubShell(inner) {
  const inApp = !!ME && !!$('#view');
  if (inApp) { view(inner); return; }
  $('#app').innerHTML = `<div class="pubwrap"><div class="pubhead"><h1 style="margin:0">${esc(FIRM)}</h1></div>${inner}
    <p class="mute" style="text-align:center"><a href="#/login">${ME ? 'Back to portal' : 'Client / staff sign in'}</a></p></div>`;
}
const pf = (u) => u + (FIRMQ ? (u.includes('?') ? '&' : '?') + 'firm=' + encodeURIComponent(FIRMQ) : '');
route(/^\/book$/, async (_, q) => {
  if (q && q.get('firm')) FIRMQ = q.get('firm');
  if (ME) layout();
  const info = await GET(pf('/api/public/booking')); if (!ME) FIRM = info.firm;
  let sel = { type: info.types[0], adv: info.advocates[0] || null, date: '', slot: null };
  const feeOf = () => (sel.adv && sel.type ? sel.adv.fees[sel.type.id] : sel.type ? sel.type.fee_paise : 0);
  const paint = () => {
    pubShell(`<div class="card"><h2>Book an online consultation</h2><p class="mute">Choose a time, pay the fee, and receive your private video-call link. The time is held for 15 minutes while you pay.</p>
      <label>Advocate</label><select id="ad">${info.advocates.map((a) => `<option value="${a.id}" ${sel.adv && a.id === sel.adv.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <label>Type of consultation</label><select id="ty">${info.types.map((t) => `<option value="${t.id}" ${sel.type && t.id === sel.type.id ? 'selected' : ''}>${esc(t.name)} — ${t.minutes} min — ${inr(sel.adv ? sel.adv.fees[t.id] : t.fee_paise)}</option>`).join('')}</select>
      <label>Date</label><input type="date" id="dd" min="${today()}" value="${sel.date}"><div id="sl" style="margin-top:.8rem"></div></div>
      <form class="card" id="bf" ${sel.slot ? '' : 'hidden'}><h3>Your details</h3><p><b>${sel.slot ? dtm(sel.slot.start_at) : ''}</b> · ${esc(sel.adv ? sel.adv.name : '')} · ${inr(feeOf())}</p>
      <label>Full name</label><input name="name" required value="${ME ? esc(ME.name) : ''}"><label>Mobile number</label><input name="phone" type="tel" required value="${ME && ME.phone ? esc(ME.phone) : ''}"><label>Email</label><input name="email" type="email" required value="${ME ? esc(ME.email) : ''}">
      <label>Briefly, what is your legal issue?</label><textarea name="issue"></textarea><p class="err" hidden></p><div style="margin-top:1rem"><button class="btn gold" style="width:100%">Continue to payment</button></div></form>`);
    const ad = $('#ad'); if (ad) ad.onchange = (e) => { sel.adv = info.advocates.find((a) => a.id == e.target.value); sel.slot = null; paint(); if (sel.date) loadSlots(); };
    $('#ty').onchange = (e) => { sel.type = info.types.find((t) => t.id == e.target.value); sel.slot = null; paint(); if (sel.date) loadSlots(); };
    $('#dd').onchange = (e) => { sel.date = e.target.value; sel.slot = null; paint(); loadSlots(); };
    if (sel.date) loadSlots(true);
    $('#bf').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, err = $('.err', f), b = $('button', f); err.hidden = true; b.disabled = true;
      try { const r = await POST(pf('/api/public/book'), { name: f.name.value, phone: f.phone.value, email: f.email.value, issue: f.issue.value, type_id: sel.type.id, advocate_id: sel.adv ? sel.adv.id : null, start_at: sel.slot.start_at }); location.hash = '#/pay/' + r.pay_ref; }
      catch (ex) { err.hidden = false; err.textContent = ex.message; b.disabled = false; }
    };
  };
  const loadSlots = async (keep) => {
    const box = $('#sl'); box.innerHTML = '<span class="mute">Checking availability…</span>';
    const slots = await GET(pf(`/api/public/slots?type=${sel.type.id}&date=${sel.date}&advocate=${sel.adv ? sel.adv.id : ''}`));
    box.innerHTML = slots.length ? `<div class="slots">${slots.map((s) => `<button type="button" data-s="${s.start_at}" class="${sel.slot && sel.slot.start_at === s.start_at ? 'on' : ''}">${new Date(s.start_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</button>`).join('')}</div>` : '<p class="mute">No times available on this date. Please try another day.</p>';
    $$('[data-s]', box).forEach((b) => (b.onclick = () => { sel.slot = slots.find((s) => s.start_at === b.dataset.s); $$('[data-s]', box).forEach((x) => x.classList.toggle('on', x === b)); const f = $('#bf'); f.hidden = false; $('p b', f).textContent = dtm(sel.slot.start_at); f.scrollIntoView({ behavior: 'smooth' }); }));
  };
  paint();
}, { public: true });

route(/^\/pay\/(PAY-[A-F0-9]+)$/, async ([ref]) => {
  if (ME) layout();
  let timer;
  const draw = async () => {
    let b; try { b = await GET('/api/public/booking/' + ref); } catch (e) { pubShell(`<div class="card"><p class="err">${esc(e.message)}</p></div>`); return; }
    if (!location.hash.includes(ref)) { clearInterval(timer); return; }
    const when = `${dtm(b.start_at)} (India time)`;
    if (b.status === 'confirmed') { clearInterval(timer); pubShell(`<div class="card"><h2>Your consultation is confirmed ✓</h2><p><b>${esc(b.type_name)}</b> with ${esc(b.advocate)}<br>${when}</p><p><a class="btn gold" href="${esc(b.meet_link)}" target="_blank" rel="noopener">Join video call</a></p><p class="mute">Save this page: <b>${esc(ref)}</b>. Please join a few minutes early from a quiet place with a stable connection.</p></div>`); return; }
    if (b.status === 'expired' || b.status === 'cancelled') { clearInterval(timer); pubShell(`<div class="card"><h2>This booking is no longer held</h2><p>The 15-minute payment window ended. If you have already paid, please contact the office quoting <b>${esc(ref)}</b>; otherwise <a href="#/book">book again</a>.</p></div>`); return; }
    pubShell(`<div class="card"><h2>Complete your payment</h2><p><b>${esc(b.type_name)}</b> with ${esc(b.advocate)}<br>${when}</p><p style="font:700 1.8rem Georgia">${inr(b.fee_paise)}</p>
      <div class="card" style="background:#faf7ee"><b>How to pay</b><p id="pn" class="mute">Loading payment details…</p><p>Use this reference as the payment remark: <b>${esc(ref)}</b></p></div>
      <p class="mute">This page updates by itself once the payment is confirmed. Your time slot is held for a short while.</p></div>`);
    GET(pf('/api/public/booking')).then((i) => { const el = $('#pn'); if (el) el.textContent = i.pay_note || 'Online payment is being switched on. Please contact the office on the number on our website to pay by UPI or bank transfer, quoting your reference.'; });
  };
  await draw(); timer = setInterval(draw, 10000);
}, { public: true });
