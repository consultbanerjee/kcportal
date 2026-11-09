'use strict';
// Two-way sync between portal clients and Google Contacts.
//  - Each client is saved as a contact whose FIRST NAME is "Cl-<client name>", with e-mail, phone, address and notes (+ matter file numbers).
//  - A contact that already has the client's name (or phone) is found and linked instead of duplicated.
//  - A contact named "Cl-…" created in Google appears in the portal as a client. Other (personal) contacts are never imported.
//  - Edits on either side are carried to the other. If both changed since the last sync, the portal wins.
const crypto = require('crypto');
const L = require('../lib');
const AI = require('../aicore');
const Drive = require('./drive');
const { db, audit } = L;
const API = 'https://people.googleapis.com/v1';
const FIELDS = 'names,emailAddresses,phoneNumbers,addresses,biographies,userDefined';
const READ = FIELDS + ',metadata';
const PREFIX = 'Cl-', MARK = '[KC LEGAL portal]';

const norm = (n) => String(n || '').replace(/^\s*cl\s*[-–]\s*/i, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const stripPrefix = (n) => String(n || '').replace(/^\s*cl\s*[-–]\s*/i, '').trim();
const hasPrefix = (n) => /^\s*cl\s*[-–]/i.test(String(n || ''));
const snap = (o) => ({ name: norm(o.name), email: String(o.email || '').trim().toLowerCase(), phone: digits(o.phone), address: String(o.address || '').replace(/\s+/g, ' ').trim().toLowerCase(), notes: String(o.notes || '').replace(/\s+/g, ' ').trim().toLowerCase() });
const hashOf = (o) => crypto.createHash('sha1').update(JSON.stringify(snap(o))).digest('hex');
const phoneOut = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+91 ' + d : String(p || '').trim(); };

// Google person -> portal-shaped fields
function fromPerson(p) {
  const nm = (p.names || [])[0] || {}, bio = ((p.biographies || [])[0] || {}).value || '';
  const full = [nm.givenName, nm.familyName].filter(Boolean).join(' ') || nm.displayName || '';
  const i = bio.indexOf(MARK);
  return { name: stripPrefix(full), prefixed: hasPrefix(full), email: ((p.emailAddresses || [])[0] || {}).value || '', phone: ((p.phoneNumbers || [])[0] || {}).value || '',
    address: ((p.addresses || [])[0] || {}).formattedValue || '', notes: (i >= 0 ? bio.slice(0, i) : bio).trim() };
}
function toPerson(c, matters) {
  const lines = (matters || []).map((m) => `${m.file_no}: ${m.title}`);
  const bio = [String(c.notes || '').trim(), `${MARK} Client ID ${c.id}${lines.length ? '\nMatters: ' + lines.join('; ') : ''}`].filter(Boolean).join('\n\n');
  const p = { names: [{ givenName: PREFIX + c.name }], biographies: [{ value: bio, contentType: 'TEXT_PLAIN' }] };
  if (c.email) p.emailAddresses = [{ value: c.email, type: 'work' }];
  if (c.phone) p.phoneNumbers = [{ value: phoneOut(c.phone), type: 'mobile' }];
  if (c.address) p.addresses = [{ formattedValue: c.address, type: 'home' }];
  return p;
}
const mattersOf = (cid) => db.prepare('SELECT file_no,title FROM matters WHERE client_id=? ORDER BY id').all(cid);

async function listAll(t) {
  const out = []; let tok = '';
  do {
    const j = await Drive.call(t, 'GET', `${API}/people/me/connections?` + new URLSearchParams({ personFields: READ, pageSize: '1000', ...(tok ? { pageToken: tok } : {}) }).toString());
    out.push(...(j.connections || [])); tok = j.nextPageToken || '';
  } while (tok);
  return out;
}
const create = (t, c) => Drive.call(t, 'POST', `${API}/people:createContact?personFields=names`, { json: toPerson(c, mattersOf(c.id)) });
const update = (t, resource, etag, c) => Drive.call(t, 'PATCH', `${API}/${resource}:updateContact?` + new URLSearchParams({ updatePersonFields: FIELDS.replace(',userDefined', ''), personFields: 'names' }).toString(), { json: { ...toPerson(c, mattersOf(c.id)), etag } });

let busy = new Set();
async function syncTenant(t) {
  if (!Drive.canContacts(t)) throw Object.assign(new Error('Google Contacts is not connected. Press "Reconnect Google Drive" on the Storage page once to allow it.'), { status: 409 });
  if (busy.has(t)) return { busy: true }; busy.add(t);
  const r = { pushed: 0, pulled: 0, linked: 0, created_in_google: 0, created_in_portal: 0, conflicts: 0 };
  try {
    const people = await listAll(t), byRes = new Map(people.map((p) => [p.resourceName, p])), now = new Date().toISOString();
    const clients = db.prepare('SELECT * FROM clients WHERE tenant_id=? ORDER BY id').all(t), claimed = new Set(clients.map((c) => c.gc_resource).filter(Boolean));
    const save = (c, p, extra) => db.prepare('UPDATE clients SET gc_resource=?, gc_hash=?, gc_synced_at=? WHERE id=?').run(p, hashOf(extra || c), now, c.id);
    for (let c of clients) {
      let p = c.gc_resource ? byRes.get(c.gc_resource) : null;
      if (c.gc_resource && !p) { if (c.gc_synced_at && Date.now() - new Date(c.gc_synced_at).getTime() < 10 * 60000) continue; db.prepare('UPDATE clients SET gc_resource=NULL, gc_hash=NULL WHERE id=?').run(c.id); c = { ...c, gc_resource: null, gc_hash: null }; }
      if (!p) {          // find an existing contact: same name (with or without Cl-) or same mobile number
        const n = norm(c.name), ph = digits(c.phone);
        p = people.find((x) => !claimed.has(x.resourceName) && (() => { const f = fromPerson(x); return (n && norm(f.name) === n) || (ph.length === 10 && digits(f.phone) === ph); })());
      }
      if (!p) { const j = await create(t, c); claimed.add(j.resourceName); save(c, j.resourceName); r.created_in_google++; continue; }
      claimed.add(p.resourceName); const g = fromPerson(p);
      if (!c.gc_resource) {               // first link: fill blanks both ways, then make the contact conform to the Cl- convention
        const merged = { ...c, email: c.email || g.email, phone: c.phone || g.phone, address: c.address || g.address, notes: c.notes || g.notes };
        db.prepare('UPDATE clients SET email=?, phone=?, address=?, notes=? WHERE id=?').run(merged.email || null, merged.phone || null, merged.address || null, merged.notes || null, c.id);
        await update(t, p.resourceName, p.etag, merged); save(c, p.resourceName, merged); r.linked++; continue;
      }
      const portalChanged = hashOf(c) !== c.gc_hash, googleChanged = hashOf(g) !== c.gc_hash || !g.prefixed;
      if (portalChanged) { if (googleChanged && hashOf(g) !== hashOf(c)) r.conflicts++; await update(t, p.resourceName, p.etag, c); save(c, p.resourceName); r.pushed++; }
      else if (googleChanged && hashOf(g) !== hashOf(c)) {
        if (!g.name) { await update(t, p.resourceName, p.etag, c); save(c, p.resourceName); continue; }
        db.prepare('UPDATE clients SET name=?, email=?, phone=?, address=?, notes=? WHERE id=?').run(g.name, g.email || null, g.phone || null, g.address || null, g.notes || null, c.id);
        const nc = { ...c, name: g.name, email: g.email, phone: g.phone, address: g.address, notes: g.notes };
        if (!g.prefixed) await update(t, p.resourceName, p.etag, nc);   // restore the Cl- first-name convention
        save(c, p.resourceName, nc); r.pulled++;
      } else if (!g.prefixed) { await update(t, p.resourceName, p.etag, c); save(c, p.resourceName); }
      else save(c, p.resourceName);
    }
    // contacts made in Google with a Cl- first name that the portal does not know yet
    for (const p of people) {
      if (claimed.has(p.resourceName)) continue; const g = fromPerson(p);
      if (!g.prefixed || !g.name) continue;
      const ins = db.prepare('INSERT INTO clients(tenant_id,name,email,phone,address,notes,gc_resource,gc_hash,gc_synced_at) VALUES (?,?,?,?,?,?,?,?,?)').run(t, g.name, g.email || null, g.phone || null, g.address || null, g.notes || null, p.resourceName, hashOf(g), now);
      claimed.add(p.resourceName); r.created_in_portal++; audit(t, null, 'client_from_google_contact', 'client', ins.lastInsertRowid, g.name, '');
    }
    AI.setS(t, 'contacts_last', JSON.stringify({ at: now, ...r }));
    return r;
  } finally { busy.delete(t); }
}

let timer;
function startWorker() {
  const tick = async () => { for (const x of db.prepare("SELECT tenant_id t FROM firm_settings WHERE key='drive_refresh' AND value<>''").all()) { try { if (Drive.canContacts(x.t) && AI.getS(x.t, 'contacts_auto', '1') === '1') await syncTenant(x.t); } catch (e) { AI.setS(x.t, 'contacts_error', String(e.message).slice(0, 200)); } } };
  timer = setInterval(tick, 10 * 60000); if (timer.unref) timer.unref(); setTimeout(tick, 45000).unref();
}
// After a client is added or edited in the portal, push it soon (best effort, the 10-minute worker also catches it).
let pend = new Map();
function touch(t) { if (pend.has(t) || !Drive.canContacts(t) || AI.getS(t, 'contacts_auto', '1') !== '1') return; pend.set(t, setTimeout(() => { pend.delete(t); syncTenant(t).catch((e) => AI.setS(t, 'contacts_error', String(e.message).slice(0, 200))); }, 4000)); if (pend.get(t).unref) pend.get(t).unref(); }

module.exports = (app) => {
  const T = (req) => req.user.tenant_id, gate = L.need('admin', 'advocate');
  app.get('/api/contacts', gate, (req, res) => { const t = T(req); let last = null; try { last = JSON.parse(AI.getS(t, 'contacts_last') || 'null'); } catch (e) {}
    res.json({ ready: Drive.canContacts(t), auto: AI.getS(t, 'contacts_auto', '1') === '1', last, error: AI.getS(t, 'contacts_error') || '', linked: db.prepare('SELECT COUNT(*) n FROM clients WHERE tenant_id=? AND gc_resource IS NOT NULL').get(t).n }); });
  app.put('/api/contacts', L.need('admin'), (req, res) => { AI.setS(T(req), 'contacts_auto', req.body.auto ? '1' : '0'); res.json({ ok: true }); });
  app.post('/api/contacts/sync', gate, async (req, res) => {
    try { const r = await syncTenant(T(req)); AI.setS(T(req), 'contacts_error', ''); audit(T(req), req.user.id, 'contacts_sync', 'clients', 0, JSON.stringify(r), L.ip(req)); res.json(r); }
    catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
};
Object.assign(module.exports, { touch, syncTenant, startWorker, fromPerson, toPerson, hashOf });
