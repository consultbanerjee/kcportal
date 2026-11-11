'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcw-'));
const app = require('../server');
const { db } = require('../db');
const AI = require('../aicore');
const WA = require('../routes/whatsapp');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sent = []; let refuse = false;
WA.setTransport(async (method, url, { headers, body }) => { sent.push({ url, auth: headers.Authorization, body: JSON.parse(body) }); return refuse ? { status: 400, json: async () => ({ error: { message: 'Template not approved' } }) } : { status: 200, json: async () => ({ messages: [{ id: 'wamid.' + sent.length }] }) }; });
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
(async () => {
  const admin0 = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin0('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin0('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  const sa0 = client(); { const stk = db.prepare("SELECT invite_token t FROM users WHERE role='superadmin'").get().t; await sa0('POST', '/api/invite/' + stk, { password: 'SuperPass123' }); await sa0('POST', '/api/login', { email: 'consultbanerjee@gmail.com', password: 'SuperPass123' }); }
  const LK = /^\/api\/(whatsapp$|reminders|contacts|calendar\/(settings|refresh)$|storage)/;
  const admin = (m, u, b, f) => (LK.test(u) ? sa0(m, '/api/platform/f/' + t + u.slice(4), b, f) : admin0(m, u, b, f));
  let r = await admin('POST', '/api/clients', { name: 'Sita Devi', phone: '98300 12345' }); const cid = r.j.id;
  ok(WA.normPhone('98300 12345') === '919830012345' && WA.normPhone('+91 98300-12345') === '919830012345' && WA.normPhone('098300 12345') === '919830012345' && WA.normPhone('123') === null, 'phone numbers normalised');
  // not set up: click-to-chat link, logged
  r = await admin('POST', `/api/clients/${cid}/whatsapp`, { template: 'kc_general_update', vars: ['Sita Devi', 'your hearing is tomorrow', 'KC LEGAL'] });
  ok(r.s === 200 && r.j.link.startsWith('https://wa.me/919830012345?text=') && r.j.status === 'opened' && !sent.length, 'fallback opens WhatsApp link without any API call');
  // configure
  r = await admin('PUT', '/api/whatsapp', { phone_id: '1234567890', waba: '99', token: 'EAAGsecrettoken', app_secret: 'appsecret', lang: 'en' }); ok(r.s === 200 && r.j.configured && r.j.verify && !JSON.stringify(r.j).includes('EAAGsecrettoken'), 'settings saved, token never returned');
  r = await admin('POST', `/api/clients/${cid}/whatsapp`, { template: 'kc_hearing_reminder', vars: ['Sita Devi', 'WP 123/2026', '12 Dec 2026', 'KC LEGAL'] });
  ok(r.s === 200 && r.j.status === 'sent' && sent.length === 1 && sent[0].url.includes('/1234567890/messages') && sent[0].auth === 'Bearer EAAGsecrettoken' && sent[0].body.to === '919830012345' && sent[0].body.type === 'template' && sent[0].body.template.name === 'kc_hearing_reminder' && sent[0].body.template.components[0].parameters[1].text === 'WP 123/2026', 'template sent through Meta');
  r = await admin('POST', `/api/clients/${cid}/whatsapp`, { text: 'Hello' }); ok(r.s === 409, 'free text blocked outside the 24-hour window');
  refuse = true; r = await admin('POST', `/api/clients/${cid}/whatsapp`, { template: 'kc_fee_reminder', vars: ['Sita', 'KC/INV/000101', '5000', 'KC LEGAL'] }); refuse = false;
  ok(r.s === 502 && /not approved/.test(r.j.error), 'Meta refusal reported'); r = await admin('GET', `/api/clients/${cid}/whatsapp`); ok(r.j.messages.some((m) => m.status === 'failed'), 'failure logged');
  // webhook
  const hook = (body, key = 'appsecret') => { const raw = JSON.stringify(body); return fetch(base + '/api/whatsapp/webhook/' + t, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', key).update(raw).digest('hex') }, body: raw }); };
  const verify = r.j && (await admin('GET', '/api/whatsapp')).j.verify;
  let x = await fetch(base + `/api/whatsapp/webhook/${t}?hub.mode=subscribe&hub.verify_token=${verify}&hub.challenge=777`); ok(x.status === 200 && (await x.text()) === '777', 'Meta verification handshake');
  x = await fetch(base + `/api/whatsapp/webhook/${t}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=777`); ok(x.status === 403, 'wrong verify token refused');
  x = await hook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }] }, 'wrongkey'); ok(x.status === 403, 'bad signature refused');
  x = await hook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] }); ok(x.status === 200 && db.prepare("SELECT status s FROM wa_messages WHERE wa_id='wamid.1'").get().s === 'read', 'read receipt recorded');
  x = await hook({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.in1', from: '919830012345', type: 'text', text: { body: 'Thank you' } }] } }] }] }); r = await admin('GET', `/api/clients/${cid}/whatsapp`);
  ok(r.j.messages.some((m) => m.direction === 'in' && m.body === 'Thank you') && r.j.window_open, 'client reply stored and opens the 24-hour window');
  r = await admin('POST', `/api/clients/${cid}/whatsapp`, { text: 'You are welcome' }); ok(r.s === 200 && sent[sent.length - 1].body.type === 'text', 'free text allowed after the client writes');
  await hook({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.in2', from: '919830012345', type: 'text', text: { body: 'STOP' } }] } }] }] });
  r = await admin('POST', `/api/clients/${cid}/whatsapp`, { text: 'again' }); ok(r.s === 409 && /not to receive/.test(r.j.error), 'STOP blocks further messages');
  await admin('PUT', `/api/clients/${cid}/whatsapp-consent`, { optout: false }); r = await admin('POST', `/api/clients/${cid}/whatsapp`, { text: 'back' }); ok(r.s === 200, 'consent can be restored');
  // permissions
  const tele = client(); r = await admin('POST', '/api/users', { name: 'T', email: 'tele@kc.com', role: 'telecaller' }); await tele('POST', '/api/invite/' + r.j.invite_path.split('/').pop(), { password: 'Passw0rdPass1' }); await tele('POST', '/api/login', { email: 'tele@kc.com', password: 'Passw0rdPass1' });
  r = await tele('POST', `/api/clients/${cid}/whatsapp`, { text: 'x' }); ok(r.s === 403, 'telecaller cannot send'); r = await tele('PUT', '/api/whatsapp', { phone_id: '1' }); ok(r.s === 404, 'only admin changes WhatsApp settings');
  // welcome greeting on first WhatsApp number
  const before = sent.length;
  r = await admin('POST', '/api/clients', { name: 'Gita Rani', phone: '98300 55555' }); await new Promise((x) => setTimeout(x, 400));
  ok(sent.length === before + 1 && sent[sent.length - 1].body.template.name === 'kc_welcome' && sent[sent.length - 1].body.to === '919830055555' && sent[sent.length - 1].body.template.components[0].parameters[0].text.length > 0, 'welcome greeting sent when a client is added with a number');
  const gid = r.j.id; await admin('PUT', '/api/clients/' + gid, { name: 'Gita Rani', phone: '98300 55555', email: 'g@example.com' }); await new Promise((x) => setTimeout(x, 400)); ok(sent.length === before + 1, 'greeting is not repeated on edit');
  r = await admin('POST', '/api/clients', { name: 'No Phone' }); const nid = r.j.id; await new Promise((x) => setTimeout(x, 300)); ok(sent.length === before + 1, 'no greeting without a number');
  await admin('PUT', '/api/clients/' + nid, { name: 'No Phone', phone: '98300 66666' }); await new Promise((x) => setTimeout(x, 400)); ok(sent.length === before + 2 && sent[sent.length - 1].body.to === '919830066666', 'greeting when the number is added later');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
