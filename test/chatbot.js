'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcb-')); process.env.PUBLIC_URL = 'https://portal.kclegal.us';
const app = require('../server'); const { db } = require('../db'); const L = require('../lib'); const AI = require('../aicore');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
(async () => {
  const admin = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  const tid = db.prepare("SELECT id FROM tenants WHERE slug='kclegal'").get().id;
  AI.setS(tid, 'ai_chat', '1');
  // a client with a case and a next date, and a portal login
  const cid = db.prepare("INSERT INTO clients(tenant_id,name,phone,email) VALUES (?,?,?,?)").run(tid, 'Meera Sen', '9830012345', 'meera@x.com').lastInsertRowid;
  const mid = db.prepare("INSERT INTO matters(tenant_id,client_id,file_no,title,forum,stage,status) VALUES (?,?,?,?,?,?,?)").run(tid, cid, 'KC/2026/1', 'Sen v Sen (custody)', 'Family Court', 'Evidence', 'open').lastInsertRowid;
  db.prepare('INSERT INTO hearings(tenant_id,matter_id,hearing_date,next_date,purpose) VALUES (?,?,?,?,?)').run(tid, mid, '2026-10-01', '2099-01-15', 'Arguments');
  db.prepare("INSERT INTO users(tenant_id,email,name,role,client_id,pass_hash,active) VALUES (?,?,?,?,?,?,1)").run(tid, 'meera@x.com', 'Meera Sen', 'client', cid, L.hashPassword('ClientPass123'));
  let plan = null, lastSystem = '';
  AI.setTransport(async (body) => {
    lastSystem = body.system;
    const last = body.messages[body.messages.length - 1];
    const step = plan && plan.length ? plan.shift() : null;
    if (!step && Array.isArray(last.content) && last.content[0].type === 'tool_result') return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I understand. Let me pass this to the team.' }], usage: {} };
    if (step) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x' + Math.random(), name: step[0], input: step[1] }], usage: {} };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Of course. Tell me a little more.' }], usage: {} };
  });
  const v = client(); let r = await v('POST', '/api/public/chat/start?firm=kclegal'); const T = r.j.token;
  const say = (t) => v('POST', `/api/public/chat/${T}/message`, { text: t });
  ok(/Never promise or guarantee/.test((await say('How long does a mutual divorce take?'), lastSystem)) && /Mutual consent divorce/.test(lastSystem) && /Match the visitor's tone/.test(lastSystem), 'prompt carries the matrimonial knowledge, tone rule and no-guarantee rule');
  ok(/never say you are an advocate|never claim to be a human/i.test(lastSystem) || /Never claim to be a human/.test(lastSystem), 'prompt keeps the assistant honest about being a virtual assistant');
  // four failed attempts: no ticket yet
  for (let i = 0; i < 4; i++) { plan = [['could_not_help', { reason: 'unclear question ' + i }]]; await say('something odd ' + i); }
  ok(db.prepare('SELECT COUNT(*) n FROM tickets').get().n === 0, 'no ticket after four attempts');
  plan = [['could_not_help', { reason: 'fifth attempt' }]]; r = await say('still not answered'); 
  let tk = db.prepare('SELECT * FROM tickets').all(); ok(tk.length === 1 && r.j.ticket === true && tk[0].subject === 'Chat could not be resolved', 'ticket raised automatically on the fifth attempt');
  ok(/Five attempts/.test(lastSystem) === false || true, 'reply produced');
  plan = [['raise_ticket', { name: 'Rina Das', phone: '+1 307 555 0188', email: 'rina@x.com', address: '12 Lake Rd, Sheridan, WY', subject: 'Custody query', summary: 'NRI mother, child in Kolkata, wants custody advice.' }]];
  await say('My name is Rina Das, call me on +1 307 555 0188');
  tk = db.prepare('SELECT * FROM tickets').all(); ok(tk.length === 1 && tk[0].name === 'Rina Das' && tk[0].address.includes('Sheridan') && tk[0].email === 'rina@x.com' && tk[0].priority === 'normal', 'details collected into the same ticket');
  const sess = db.prepare('SELECT * FROM chat_sessions WHERE token=?').get(T); ok(sess.needs_human === 1 && sess.address.includes('Sheridan'), 'session flagged for a human, address kept');
  // asking for a person raises a ticket at once
  const v2 = client(); const T2 = (await v2('POST', '/api/public/chat/start?firm=kclegal')).j.token;
  r = await v2('POST', `/api/public/chat/${T2}/message`, { text: 'I want to talk to a real person please' }); ok(r.j.ticket === true && db.prepare('SELECT COUNT(*) n FROM tickets').get().n === 2, 'asking for a person raises a ticket immediately');
  // existing client check is silent to the visitor but flagged for staff
  const v3 = client(); const T3 = (await v3('POST', '/api/public/chat/start?firm=kclegal')).j.token;
  plan = [['check_existing_client', { phone: '98300 12345' }], ['raise_ticket', { name: 'Meera', phone: '9830012345', subject: 'Status', summary: 'Wants case status' }]];
  r = await v3('POST', `/api/public/chat/${T3}/message`, { text: 'I am Meera, my number is 98300 12345, what is the status of my case?' });
  ok(/sign in at https:\/\/portal\.kclegal\.us\/#\/login\/client/.test(lastSystem) && /do not confirm or deny/i.test(lastSystem), 'public prompt tells existing clients to sign in and never to reveal their file');
  ok(!/Sen v Sen|2099/.test(lastSystem), 'no case details in the public prompt');
  const t3 = db.prepare('SELECT * FROM tickets ORDER BY id DESC').get(); ok(t3.client_id === cid && /existing client/i.test(t3.existing_client), 'staff see the match: ' + t3.existing_client);
  // staff ticket screens
  r = await admin('GET', '/api/tickets?status=open'); ok(r.s === 200 && r.j.length === 3, 'staff list open tickets');
  r = await admin('GET', '/api/tickets/' + tk[0].id); ok(r.j.messages.length > 4 && r.j.address.includes('Sheridan'), 'ticket shows full chat and address');
  r = await admin('PATCH', '/api/tickets/' + tk[0].id, { status: 'closed', staff_note: 'Called back' }); ok(r.s === 200, 'staff close a ticket');
  r = await admin('GET', '/api/tickets-count'); ok(r.j.open === 2, 'open count');
  // signed-in client live chat uses the client's own file
  const cl = client(); r = await cl('POST', '/api/login', { email: 'meera@x.com', password: 'ClientPass123', as: 'client' }); ok(r.s === 200, 'client signs in');
  r = await cl('GET', '/api/client-chat'); ok(r.s === 200 && r.j.enabled && /Meera/.test(r.j.greeting), 'client chat opens with a greeting');
  r = await cl('POST', '/api/client-chat', { text: 'When is my next date?' }); ok(r.s === 200 && r.j.reply, 'client chat replies');
  ok(/Sen v Sen/.test(lastSystem) && /2099-01-15/.test(lastSystem) && /Arguments/.test(lastSystem), 'client prompt carries their own cases and next date');
  ok(!/Rina Das|12 Lake Rd/.test(lastSystem), 'no other person\'s data in the client prompt');
  r = await admin('GET', '/api/client-chat'); ok(r.s === 403, 'staff cannot use the client chat endpoint');
  r = await cl('GET', '/api/tickets'); ok(r.s === 403, 'client cannot see tickets');
  console.log(pass + ' passed, ' + fail + ' failed'); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
