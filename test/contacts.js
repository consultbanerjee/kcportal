'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcc-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const Drive = require('../routes/drive'); const C = require('../routes/contacts');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const P = new Map(); let seq = 0, calls = [];
const rsp = (status, j) => ({ status, headers: { get: () => null }, body: { json: async () => j, arrayBuffer: async () => Buffer.from('') } });
const bump = (p) => { p.etag = 'e' + (++seq); return p; };
Drive.setTransport(async (method, url, { body } = {}) => {
  const u = new URL(url), p = u.pathname; if (u.host === 'oauth2.googleapis.com') return rsp(200, { access_token: 'at', expires_in: 3600 });
  if (u.host !== 'people.googleapis.com') return rsp(404, { error: { message: 'n/a' } });
  calls.push(method + ' ' + p);
  if (p === '/v1/people/me/connections') return rsp(200, { connections: [...P.values()] });
  if (p === '/v1/people:createContact') { const j = JSON.parse(body), id = 'people/c' + (++seq); const x = bump({ resourceName: id, ...j }); P.set(id, x); return rsp(200, x); }
  const m = p.match(/^\/v1\/(people\/c\d+):updateContact$/); if (m) { const cur = P.get(m[1]); const j = JSON.parse(body); if (!cur || j.etag !== cur.etag) return rsp(400, { error: { message: 'etag mismatch' } });
    const x = bump({ resourceName: m[1], ...j }); delete x.etag; bump(x); P.set(m[1], x); return rsp(200, x); }
  return rsp(404, {});
});
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
  let r = await admin('POST', '/api/contacts/sync'); ok(r.s === 409, 'asks to reconnect when the contacts permission is missing');
  AI.setS(t, 'drive_client_id', 'cid'); AI.setS(t, 'drive_client_secret', AI.enc('sec')); AI.setS(t, 'drive_refresh', AI.enc('rt')); AI.setS(t, 'drive_scopes', 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/contacts');
  const sita = (await admin('POST', '/api/clients', { name: 'Sita Devi', phone: '98300 12345', email: 'sita@example.com', address: '12 Park St, Kolkata', notes: 'Prefers calls after 5' })).j.id;
  const ram = (await admin('POST', '/api/clients', { name: 'Ram Kumar', phone: '9876543210' })).j.id;
  await admin('POST', '/api/matters', { client_id: sita, title: 'WP 123/2026 Sita v State' });
  // Google already has "Ram Kumar" (no prefix) and a personal contact; plus a Cl- contact made in Google
  P.set('people/c900', bump({ resourceName: 'people/c900', names: [{ givenName: 'Ram', familyName: 'Kumar' }], emailAddresses: [{ value: 'ram@gmail.com' }], phoneNumbers: [{ value: '+91 98765 43210' }] }));
  P.set('people/c901', bump({ resourceName: 'people/c901', names: [{ givenName: 'Mom' }], phoneNumbers: [{ value: '1111111111' }] }));
  P.set('people/c902', bump({ resourceName: 'people/c902', names: [{ givenName: 'Cl-Anita Roy' }], phoneNumbers: [{ value: '+91 90000 11111' }], biographies: [{ value: 'Walk-in client' }] }));
  await new Promise((x) => setTimeout(x, 100));
  r = await admin('POST', '/api/contacts/sync'); ok(r.s === 200 && r.j.created_in_google === 1 && r.j.linked === 1 && r.j.created_in_portal === 1, 'first sync: ' + JSON.stringify(r.j));
  const cs = [...P.values()].find((x) => (x.names[0].givenName || '').startsWith('Cl-Sita'));
  ok(cs && cs.names[0].givenName === 'Cl-Sita Devi' && cs.emailAddresses[0].value === 'sita@example.com' && cs.phoneNumbers[0].value === '+91 9830012345' && cs.addresses[0].formattedValue === '12 Park St, Kolkata' && /Prefers calls/.test(cs.biographies[0].value) && /WP 123\/2026/.test(cs.biographies[0].value), 'Sita saved as Cl-Sita Devi with all details');
  const rc = P.get('people/c900'); ok(rc.names[0].givenName === 'Cl-Ram Kumar' && rc.emailAddresses[0].value === 'ram@gmail.com', 'existing contact found, renamed with Cl-, details kept');
  ok(db.prepare('SELECT email e FROM clients WHERE id=?').get(ram).e === 'ram@gmail.com', 'blank portal email filled from Google');
  ok(!P.get('people/c901').names[0].givenName.startsWith('Cl-'), 'personal contacts untouched');
  const an = db.prepare("SELECT * FROM clients WHERE name='Anita Roy'").get(); ok(an && an.phone === '+91 90000 11111' && an.notes === 'Walk-in client', 'Cl- contact made in Google became a portal client');
  ok(P.get('people/c902').names[0].givenName === 'Cl-Anita Roy', 'its name stays as is');
  r = await admin('POST', '/api/contacts/sync'); ok(r.j.pushed === 0 && r.j.pulled === 0 && r.j.created_in_google === 0 && r.j.created_in_portal === 0, 'second sync changes nothing: ' + JSON.stringify(r.j));
  // portal edit -> Google
  await admin('PUT', '/api/clients/' + sita, { name: 'Sita Devi', phone: '98300 12345', email: 'sita.new@example.com', address: '12 Park St, Kolkata', notes: 'Prefers calls after 5' });
  r = await admin('POST', '/api/contacts/sync'); ok(r.j.pushed === 1 && P.get(db.prepare('SELECT gc_resource g FROM clients WHERE id=?').get(sita).g).emailAddresses[0].value === 'sita.new@example.com', 'portal edit pushed to Google');
  // Google edit -> portal (name change, new phone)
  const gr = db.prepare('SELECT gc_resource g FROM clients WHERE id=?').get(sita).g; const gp = P.get(gr); gp.names = [{ givenName: 'Cl-Sita Devi Sharma' }]; gp.phoneNumbers = [{ value: '+91 70000 22222' }]; bump(gp);
  r = await admin('POST', '/api/contacts/sync'); const row = db.prepare('SELECT name,phone FROM clients WHERE id=?').get(sita); ok(r.j.pulled === 1 && row.name === 'Sita Devi Sharma' && row.phone === '+91 70000 22222', 'Google edit pulled into portal: ' + JSON.stringify(row));
  // Google edit that drops the prefix gets repaired
  gp.names = [{ givenName: 'Sita Devi Sharma' }]; bump(gp); r = await admin('POST', '/api/contacts/sync'); ok(P.get(gr).names[0].givenName === 'Cl-Sita Devi Sharma', 'missing Cl- prefix restored');
  // conflict: both changed → portal wins
  await admin('PUT', '/api/clients/' + sita, { name: 'Sita Devi Sharma', phone: '+91 70000 22222', email: 'portal@example.com' }); const g2 = P.get(gr); g2.emailAddresses = [{ value: 'google@example.com' }]; g2.names = [{ givenName: 'Cl-Sita Devi Sharma' }]; bump(g2);
  r = await admin('POST', '/api/contacts/sync'); ok(r.j.conflicts === 1 && P.get(gr).emailAddresses[0].value === 'portal@example.com', 'conflict resolved in favour of the portal');
  // contact deleted in Google → recreated later
  P.delete(gr); db.prepare("UPDATE clients SET gc_synced_at=datetime('now','-1 hour') WHERE id=?").run(sita); r = await admin('POST', '/api/contacts/sync'); ok(r.j.created_in_google === 1, 'deleted contact recreated');
  r = await admin('GET', '/api/contacts'); ok(r.j.ready && r.j.linked === 3 && r.j.last, 'status');
  const adv = client(); await admin('POST', '/api/users', { name: 'Stf', email: 'stf@example.com', role: 'staff' }); const st = db.prepare("SELECT invite_token t FROM users WHERE email='stf@example.com'").get().t; await adv('POST', '/api/invite/' + st, { password: 'StrongPass123' }); await adv('POST', '/api/login', { email: 'stf@example.com', password: 'StrongPass123' });
  r = await adv('POST', '/api/contacts/sync'); ok(r.s === 404, 'staff cannot run the sync');
  console.log(`${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
