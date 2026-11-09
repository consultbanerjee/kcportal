'use strict';
// Google Meet consultations against a fake Google (no network): link creation, who may join, recording upload to Drive.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcm-'));
process.env.WEBHOOK_SECRET = 'whsec';
const app = require('../server');
const { db } = require('../db');
const AI = require('../aicore');
const Drive = require('../routes/drive');
const Meet = require('../routes/meet');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const F = new Map(), calls = []; let seq = 0, upBuf = null;
const mkf = (name, parents, mime) => { const id = 'g' + (++seq); const f = { id, name, parents: parents || ['root'], mimeType: mime || 'x' }; F.set(id, f); return f; };
const rsp = (status, j, hdr) => ({ status, headers: { get: (k) => (hdr || {})[k.toLowerCase()] }, body: { json: async () => j, arrayBuffer: async () => Buffer.from('') } });
let meetFails = false;
Drive.setTransport(async (method, url, { body } = {}) => {
  const u = new URL(url), p = u.pathname; calls.push(method + ' ' + p);
  if (u.host === 'oauth2.googleapis.com') return rsp(200, { access_token: 'at', expires_in: 3600 });
  if (p.startsWith('/calendar/v3/calendars/primary/events')) {
    if (method === 'DELETE') { calls.push('DELETED'); return rsp(204, {}); }
    const j = JSON.parse(body); calls.push('EVENT ' + JSON.stringify({ att: j.attendees.map((x) => x.email), start: j.start.dateTime, tz: j.start.timeZone, meet: j.conferenceData.createRequest.conferenceSolutionKey.type }));
    return rsp(200, { id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { conferenceId: 'abc-defg-hij' } });
  }
  if (p === '/v2/spaces/abc-defg-hij') { calls.push('SPACE ' + body); return meetFails ? rsp(403, { error: { message: 'not allowed' } }) : rsp(200, {}); }
  if (p === '/v2/spaces/abc-defg-hij/members') { calls.push('MEMBER ' + body); return rsp(200, {}); }
  if (p === '/v2/conferenceRecords') return rsp(200, { conferenceRecords: [{ name: 'conferenceRecords/c1' }] });
  if (p === '/v2/conferenceRecords/c1/recordings') return rsp(200, { recordings: [{ state: 'FILE_GENERATED', driveDestination: { file: 'files/REC1' } }] });
  if (p === '/upload/drive/v3/files') {
    if (u.searchParams.get('uploadType') === 'resumable') { upBuf = []; return rsp(200, {}, { location: 'https://up.example/session1' }); }
  }
  if (u.host === 'up.example') { upBuf.push(body); const total = +/\/(\d+)$/.exec(body.length ? '' : '')?.[1] || 0; return upBuf.reduce((s, b) => s + b.length, 0) >= global.__recSize ? rsp(200, { id: 'REC-UP', md5Checksum: 'x' }) : rsp(308, {}); }
  const m = p.match(/^\/drive\/v3\/files\/?([^/]*)$/);
  if (m) {
    const id = m[1];
    if (method === 'GET' && !id) return rsp(200, { files: [] });
    if (method === 'POST') { const j = JSON.parse(body), f = mkf(j.name, j.parents, j.mimeType); return rsp(200, { id: f.id }); }
    if (method === 'GET') return rsp(200, id === 'REC1' ? { parents: ['host-drive-root'] } : F.get(id) || {});
    if (method === 'PATCH') { calls.push('MOVE ' + id + ' add=' + u.searchParams.get('addParents')); return rsp(200, { id }); }
  }
  return rsp(404, { error: { message: 'unhandled ' + method + ' ' + url } });
});

const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body;
  if (body && !(body instanceof Buffer) && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); } else if (body instanceof Buffer) h['Content-Type'] = 'application/octet-stream';
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }

(async () => {
  const admin = client();
  const tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' });
  let r = await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' }); ok(r.s === 200, 'admin login');
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  const mkUser = async (role, email) => { const x = await admin('POST', '/api/users', { name: role + ' ' + email, email, role }); const c = client(); await c('POST', '/api/invite/' + x.j.invite_path.split('/').pop(), { password: 'Passw0rdPass1' }); await c('POST', '/api/login', { email, password: 'Passw0rdPass1' }); return { c, id: db.prepare('SELECT id FROM users WHERE email=?').get(email).id }; };
  const adv = await mkUser('advocate', 'adv@kc.com'), adv2 = await mkUser('advocate', 'adv2@kc.com'), staff = await mkUser('staff', 'st@kc.com');
  const ct = db.prepare('SELECT * FROM consult_types WHERE tenant_id=?').get(t);
  const book = (ref, advId) => db.prepare(`INSERT INTO appointments(tenant_id,name,phone,email,advocate_id,consult_type_id,start_at,end_at,mode,fee_paise,status,pay_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t, 'Meera Sen', '9830000009', 'meera@client.com', advId, ct.id, '2026-12-01T05:30:00.000Z', '2026-12-01T06:00:00.000Z', 'video', ct.fee_paise, 'awaiting_payment', ref).lastInsertRowid;
  const pay = (ref, amt) => fetch(base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'whsec' }, body: JSON.stringify({ pay_ref: ref, status: 'paid', amount_paise: amt, txn_id: 'tx' + ref }) });

  // not connected to Google -> backup link, still works
  const a0 = book('PAY-A0', adv.id); await pay('PAY-A0', ct.fee_paise); await new Promise((z) => setTimeout(z, 100));
  ok(/jit\.si/.test(db.prepare('SELECT meet_link FROM appointments WHERE id=?').get(a0).meet_link), 'backup link when Google is not connected');

  // connect Google (with Calendar scope)
  AI.setS(t, 'drive_client_id', 'cid'); AI.setS(t, 'drive_client_secret', AI.enc('sec')); AI.setS(t, 'drive_refresh', AI.enc('rt')); AI.setS(t, 'drive_scopes', 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.events');
  const a1 = book('PAY-A1', adv.id); await pay('PAY-A1', ct.fee_paise); await new Promise((z) => setTimeout(z, 400));
  const row = db.prepare('SELECT * FROM appointments WHERE id=?').get(a1);
  ok(row.status === 'confirmed' && row.meet_link === 'https://meet.google.com/abc-defg-hij' && row.meet_code === 'abc-defg-hij', 'Google Meet link created on confirmation');
  const ev = calls.find((c) => c.startsWith('EVENT ')); const evj = ev && JSON.parse(ev.slice(6));
  ok(evj && evj.att.includes('meera@client.com') && evj.att.includes('adv@kc.com') && evj.start === '2026-12-01T05:30:00.000Z' && evj.tz === 'Asia/Kolkata' && evj.meet === 'hangoutsMeet', 'event has the right date, time and guests');
  ok(calls.some((c) => c.startsWith('SPACE ') && /RESTRICTED/.test(c) && /"ON"/.test(c)) && calls.some((c) => c.startsWith('MEMBER ') && /COHOST/.test(c) && /adv@kc.com/.test(c)), 'room restricted, auto-record on, advocate co-host');

  // who may see / join
  r = await admin('GET', '/api/appointments'); ok(r.j.find((x) => x.id === a1).meet_link.startsWith('https://meet.google.com'), 'admin sees the link');
  r = await adv.c('GET', '/api/appointments'); ok(r.j.find((x) => x.id === a1).meet_link.startsWith('https://meet.google.com'), 'booked advocate sees the link');
  r = await adv2.c('GET', '/api/appointments'); ok(r.j.find((x) => x.id === a1).meet_link === 'restricted', 'another advocate does not get the link');
  r = await staff.c('GET', '/api/appointments'); ok(r.j.find((x) => x.id === a1).meet_link === 'restricted', 'staff do not get the link');
  r = await adv.c('GET', `/api/appointments/${a1}/join`); ok(r.s === 200 && r.j.link.includes('abc-defg-hij'), 'booked advocate may join');
  r = await admin('GET', `/api/appointments/${a1}/join`); ok(r.s === 200, 'admin may join');
  r = await adv2.c('GET', `/api/appointments/${a1}/join`); ok(r.s === 403, 'other advocate refused');
  r = await staff.c('GET', `/api/appointments/${a1}/join`); ok(r.s === 403, 'staff refused');
  r = await adv2.c('POST', `/api/appointments/${a1}/recording/start`, {}); ok(r.s === 403, 'other advocate cannot record');
  r = await fetch(base + '/api/public/booking/PAY-A1').then((x) => x.json()); ok(r.meet_link.includes('abc-defg-hij'), 'client sees own link on the booking page');

  // browser recording -> Drive
  r = await adv.c('POST', `/api/appointments/${a1}/recording/start`, {}); ok(r.s === 200 && r.j.rid, 'recording starts'); const rid = r.j.rid;
  const c1 = Buffer.alloc(300000, 1), c2 = Buffer.alloc(200000, 2); global.__recSize = c1.length + c2.length;
  r = await adv.c('POST', `/api/appointments/${a1}/recording/chunk?rid=${rid}&off=0`, c1); ok(r.s === 200 && r.j.size === 300000, 'first piece');
  r = await adv.c('POST', `/api/appointments/${a1}/recording/chunk?rid=${rid}&off=0`, c1); ok(r.s === 200 && r.j.size === 300000, 'repeated piece is not doubled');
  r = await adv.c('POST', `/api/appointments/${a1}/recording/chunk?rid=${rid}&off=999999`, c2); ok(r.s === 409, 'gap refused');
  r = await adv.c('POST', `/api/appointments/${a1}/recording/chunk?rid=${rid}&off=300000`, c2); ok(r.s === 200 && r.j.size === 500000, 'second piece');
  r = await adv.c('POST', `/api/appointments/${a1}/recording/finish`, { rid }); ok(r.s === 200 && /webm$/.test(r.j.name), 'recording finished ' + JSON.stringify(r.j));
  const node = db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(r.j.id); ok(node && node.drive_id === 'REC-UP' && node.storage === 'gdrive' && node.size === 500000 && node.client_visible === 0, 'recording is in Drive, private, no server copy');
  ok(!fs.readdirSync(path.join(process.env.DATA_DIR, 'rec-tmp')).length, 'temporary file removed');
  const parent = db.prepare('SELECT name,client_id FROM fs_nodes WHERE id=?').get(node.parent_id); ok(parent.name === 'Recordings', 'filed under the client Recordings folder');
  r = await adv.c('GET', `/api/appointments/${a1}/meeting`); ok(r.j.recordings.length === 1, 'meeting page lists the recording');

  // Google's own recording is collected and moved into Recordings
  db.prepare("UPDATE appointments SET end_at=?, rec_status=NULL WHERE id=?").run(new Date(Date.now() - 3600000).toISOString(), a1);
  await Meet.collectRecordings(t); ok(calls.some((c) => c.startsWith('MOVE REC1')) && db.prepare('SELECT rec_status s FROM appointments WHERE id=?').get(a1).s === 'saved by Google Meet', 'Meet recording moved into Recordings');

  // cancel removes the calendar event
  r = await admin('POST', `/api/appointments/${a1}/cancel`, {}); await new Promise((z) => setTimeout(z, 200)); ok(calls.includes('DELETED'), 'cancelling removes the calendar event');

  // Workspace restrictions refused -> link still works, noted
  meetFails = true; const a2 = book('PAY-A2', adv.id); await pay('PAY-A2', ct.fee_paise); await new Promise((z) => setTimeout(z, 400));
  const r2 = db.prepare('SELECT * FROM appointments WHERE id=?').get(a2); ok(r2.meet_link.includes('meet.google.com') && /did not apply/.test(r2.meet_note), 'link kept when Google will not apply room settings');

  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
