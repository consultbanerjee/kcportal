'use strict';
// v5.2: case labels (tags) with filter, saved research (bookmarks and notes), and a usage summary. Same for every firm.
const L = require('../lib'); const D = require('../db'); const db = D.db;
try { db.exec('ALTER TABLE matters ADD COLUMN labels TEXT'); } catch (e) { /* already there */ }
db.exec(`CREATE TABLE IF NOT EXISTS research_saved (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, note TEXT, kind TEXT, url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS ix_rsaved_user ON research_saved(tenant_id, user_id, id);`);
try { db.exec('ALTER TABLE research_saved ADD COLUMN ref TEXT'); } catch (e) { /* already there */ }
const T = (req) => req.user.tenant_id;
const clean = (v) => { const out = []; for (const x of (Array.isArray(v) ? v : String(v || '').split(','))) { const s = L.str(x, 24).replace(/[<>"&,]/g, '').trim(); if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s); } return out.slice(0, 8); };
module.exports = (app) => {
  const notClient = (req, res, next) => (req.user.role === 'client' ? res.status(403).json({ error: 'Not available.' }) : next());
  app.get('/api/labels', L.requireLogin, notClient, (req, res) => {
    const f = app.locals.teamSql ? app.locals.teamSql(req) : { sql: '', args: [] };
    const rows = db.prepare("SELECT m.labels FROM matters m WHERE m.tenant_id=? AND m.status<>'deleted' AND m.labels IS NOT NULL AND m.labels<>''" + f.sql).all(T(req), ...f.args);
    const n = {}; for (const r of rows) for (const l of r.labels.split(',')) if (l) n[l] = (n[l] || 0) + 1;
    res.json(Object.entries(n).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })));
  });
  app.put('/api/matters/:id/labels', L.requireLogin, notClient, (req, res) => {
    const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req));
    if (!m || !app.locals.matterAtLeast(req, m, 'work')) return res.status(404).json({ error: 'Not found.' });
    const labels = clean((req.body || {}).labels);
    db.prepare('UPDATE matters SET labels=? WHERE id=?').run(labels.join(','), m.id);
    D.audit(T(req), req.user.id, 'case_labels', 'matter', m.id, labels.join(','), L.ip(req)); res.json({ ok: true, labels });
  });
  // saved research
  app.get('/api/research/saved', L.office, (req, res) => res.json(db.prepare('SELECT id,title,body,note,kind,url,ref,created_at FROM research_saved WHERE tenant_id=? AND user_id=? ORDER BY id DESC LIMIT 200').all(T(req), req.user.id)));
  app.post('/api/research/saved', L.office, (req, res) => {
    const b = req.body || {}, title = L.str(b.title, 250).trim(); if (!title) return res.status(400).json({ error: 'Nothing to save.' });
    const url = /^https?:\/\//i.test(b.url || '') ? L.str(b.url, 500) : '';
    const id = db.prepare('INSERT INTO research_saved(tenant_id,user_id,title,body,note,kind,url,ref) VALUES (?,?,?,?,?,?,?,?)').run(T(req), req.user.id, title, L.str(b.body, 9000), L.str(b.note, 2000), L.str(b.kind, 20), url, /^[A-Za-z]{2,12}\/\d{1,12}$/.test(String(b.ref || '')) ? String(b.ref) : '').lastInsertRowid;
    res.json({ ok: true, id });
  });
  app.put('/api/research/saved/:id', L.office, (req, res) => {
    const r = db.prepare('UPDATE research_saved SET note=? WHERE id=? AND tenant_id=? AND user_id=?').run(L.str((req.body || {}).note, 2000), L.int(req.params.id), T(req), req.user.id);
    res.status(r.changes ? 200 : 404).json(r.changes ? { ok: true } : { error: 'Not found.' });
  });
  app.delete('/api/research/saved/:id', L.office, (req, res) => {
    const r = db.prepare('DELETE FROM research_saved WHERE id=? AND tenant_id=? AND user_id=?').run(L.int(req.params.id), T(req), req.user.id);
    res.status(r.changes ? 200 : 404).json(r.changes ? { ok: true } : { error: 'Not found.' });
  });
  // usage summary for the firm administrator
  app.get('/api/usage', L.need('admin'), (req, res) => {
    const t = T(req), c = (s) => db.prepare(s).get(t).v;
    res.json({ cases: c("SELECT COUNT(*) v FROM matters WHERE tenant_id=? AND status<>'deleted'"), open_cases: c("SELECT COUNT(*) v FROM matters WHERE tenant_id=? AND status='open'"), clients: c('SELECT COUNT(*) v FROM clients WHERE tenant_id=?'),
      files: c("SELECT COUNT(*) v FROM fs_nodes WHERE tenant_id=? AND kind='file' AND deleted_at IS NULL"), bytes: c("SELECT COALESCE(SUM(size),0) v FROM fs_nodes WHERE tenant_id=? AND kind='file' AND deleted_at IS NULL"), users: c("SELECT COUNT(*) v FROM users WHERE tenant_id=? AND role<>'client'") });
  });
};
