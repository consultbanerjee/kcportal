'use strict';
// v5.3: Filing forums guide. A shared catalogue of courts, tribunals and forums with their e-filing portal, login, signing, file-size limit
// and how much of a filing the portal can assist with, plus each firm's own forums. Same for every firm; nothing here stores passwords.
const fs = require('fs'), path = require('path');
const L = require('../lib'); const D = require('../db'); const db = D.db;
db.exec(`CREATE TABLE IF NOT EXISTS firm_forums (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT, portal_url TEXT, login TEXT, signing TEXT, max_file_mb REAL, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS ix_firm_forums ON firm_forums(tenant_id, id);`);
let CAT = { forums: [], credential_policy: {}, automation_levels: {}, updated: '' };
try { CAT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'forums-wb.json'), 'utf8')); } catch (e) { console.error('forums-wb.json', e.message); }
const okUrl = (u) => /^https?:\/\/[^\s<>"']+$/i.test(u) && u.length < 400;
module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const noClient = (req, res, next) => (['client', 'superadmin'].includes(req.user.role) ? res.status(403).json({ error: 'Not available.' }) : next());
  app.get('/api/filing-forums', L.requireLogin, noClient, (req, res) => {
    const custom = db.prepare('SELECT id,name,type,portal_url,login,signing,max_file_mb,notes FROM firm_forums WHERE tenant_id=? ORDER BY name').all(T(req));
    res.json({ updated: CAT.updated, region: CAT.region, levels: CAT.automation_levels, policy: CAT.credential_policy, catalog: CAT.forums, custom });
  });
  app.post('/api/filing-forums', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const b = req.body || {}, name = L.str(b.name, 120).trim(), url = L.str(b.portal_url, 400).trim(), mb = b.max_file_mb === '' || b.max_file_mb == null ? null : Number(b.max_file_mb);
    if (!L.must(res, name, 'Enter the name of the court or forum.')) return;
    if (!L.must(res, !url || okUrl(url), 'The portal address must start with https://')) return;
    if (!L.must(res, mb === null || (Number.isFinite(mb) && mb > 0 && mb <= 500), 'File-size limit must be between 1 and 500 MB, or left blank.')) return;
    const id = db.prepare('INSERT INTO firm_forums(tenant_id,name,type,portal_url,login,signing,max_file_mb,notes) VALUES (?,?,?,?,?,?,?,?)').run(T(req), name, L.str(b.type, 40), url, L.str(b.login, 200), L.str(b.signing, 120), mb, L.str(b.notes, 500)).lastInsertRowid;
    D.audit(T(req), req.user.id, 'forum_add', 'firm_forum', id, name, L.ip(req)); res.json({ ok: true, id });
  });
  app.delete('/api/filing-forums/:id', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const r = db.prepare('DELETE FROM firm_forums WHERE id=? AND tenant_id=?').run(L.int(req.params.id), T(req));
    res.status(r.changes ? 200 : 404).json(r.changes ? { ok: true } : { error: 'Not found.' });
  });
};
Object.assign(module.exports, { catalog: () => CAT.forums || [] });
