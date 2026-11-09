'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcu-'));
const app = require('../server');
const { db } = require('../db');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.clone().json(); } catch (e) {} return { s: r.status, j, r }; }; }
(async () => {
  const admin = client(), anon = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  let r = await anon('GET', '/api/public/upi'); ok(r.s === 200 && r.j.enabled === false && r.j.link === null, 'off until a UPI ID is saved');
  r = await admin('PUT', '/api/upi', { upi_id: 'bad id', upi_name: 'KC LEGAL' }); ok(r.s === 400, 'invalid UPI ID refused');
  r = await admin('PUT', '/api/upi', { upi_id: 'kclegal@okhdfcbank', upi_name: 'KC LEGAL' }); ok(r.s === 200, 'saved');
  r = await anon('GET', '/api/public/upi?amt=5000&note=KC/INV/000101'); ok(r.j.enabled && r.j.link === 'upi://pay?pa=kclegal%40okhdfcbank&pn=KC%20LEGAL&cu=INR&am=5000.00&tn=KC%2FINV%2F000101', 'exact upi:// link: ' + r.j.link);
  r = await anon('GET', '/api/public/upi-qr?amt=5000'); ok(r.s === 200 && /svg/.test(r.r.headers.get('content-type')), 'QR served');
  r = await admin('GET', '/api/upi'); ok(r.j.vpa === 'kclegal@okhdfcbank' && /#\/pay-us\?firm=/.test(r.j.pay_url), 'office sees settings and shareable link');
  // booking
  await admin('PUT', '/api/availability', { slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, start_time: '10:00', end_time: '13:00' })) });
  const info = (await anon('GET', '/api/public/booking')).j, adv = info.advocates[0], day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const slot = (await anon('GET', `/api/public/slots?type=${info.types[0].id}&date=${day}&advocate=${adv.id}`)).j[0];
  {
    r = await anon('POST', '/api/public/book', { name: 'Test Client', phone: '9830012345', email: 't@example.com', issue: 'x', type_id: info.types[0].id, advocate_id: adv.id, start_at: slot.start_at });
    const ref = r.j.pay_ref; ok(r.s === 200 && ref, 'booked');
    r = await anon('GET', '/api/public/booking/' + ref); ok(r.j.upi_link && r.j.upi_link.includes('tn=' + ref) && r.j.upi_qr.startsWith('data:image/svg') && !('tenant_id' in r.j) && r.j.claimed === false, 'pay page gets exact-amount link + QR with reference');
    r = await anon('POST', `/api/public/booking/${ref}/paid`, { utr: '123' }); ok(r.s === 400, 'short UTR refused');
    r = await anon('POST', `/api/public/booking/${ref}/paid`, { utr: '412345678901' }); ok(r.s === 200, 'UTR submitted');
    r = await anon('GET', '/api/public/booking/' + ref); ok(r.j.claimed === true && r.j.status === 'awaiting_payment' && !('pay_claim' in r.j), 'claimed but still awaiting office confirmation');
    r = await admin('GET', '/api/appointments'); ok(r.j.some((a) => a.pay_claim === '412345678901'), 'office sees the UTR');
    const id = r.j.find((a) => a.pay_ref === ref).id; r = await admin('POST', `/api/appointments/${id}/confirm`, { reference: '412345678901', mode: 'upi' }); ok(r.s === 200, 'office confirms');
  }
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
