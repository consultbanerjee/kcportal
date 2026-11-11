'use strict';
// DELETE A CASE: moved to the RECYCLE BIN (hidden everywhere, restorable at any time by the firm administrator). Its files stay where they are (Google Drive and the client's folder).
// Only the Super Admin can remove a case record for good. Same rules for every firm.
// Cases with issued fee bills cannot be deleted (close the case instead) so the accounts stay complete. Same rules for every firm.
const L = require('../lib'); const D = require('../db'); const db = D.db;
for (const c of ['deleted_at TEXT', 'deleted_by INTEGER', 'prev_status TEXT']) { try { db.exec('ALTER TABLE matters ADD COLUMN ' + c); } catch (e) { /* already there */ } }
const T = (req) => req.user.tenant_id;
module.exports = (app) => {
  const get = (req, res, wantDeleted) => { const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req)); if (!m || (wantDeleted ? m.status !== 'deleted' : m.status === 'deleted')) { res.status(404).json({ error: 'Not found.' }); return null; } return m; };
  app.delete('/api/matters/:id', L.need('admin', 'advocate'), (req, res) => {
    const m = get(req, res, false); if (!m) return;
    if (req.user.role !== 'admin' && !app.locals.matterAtLeast(req, m, 'full')) return res.status(403).json({ error: 'Only someone with full access to this case can delete it.' });
    if (String((req.body || {}).confirm || '').trim().toLowerCase() !== String(m.file_no).toLowerCase()) return res.status(400).json({ error: 'Type the file number exactly to confirm.' });
    const inv = db.prepare("SELECT COUNT(*) n FROM invoices WHERE matter_id=? AND status NOT IN ('draft','cancelled')").get(m.id).n;
    if (inv) return res.status(409).json({ error: `This case has ${inv} issued fee bill(s). Close the case instead of deleting it, so your accounts stay complete.` });
    db.prepare("UPDATE matters SET prev_status=status, status='deleted', deleted_at=?, deleted_by=? WHERE id=?").run(new Date().toISOString(), req.user.id, m.id);
    try { db.prepare("UPDATE matter_moves SET status='cancelled' WHERE matter_id=? AND status='open'").run(m.id); } catch (e) { /* table appears with the movement module */ }
    D.audit(T(req), req.user.id, 'matter_deleted', 'matter', m.id, m.file_no, req.ip); res.json({ ok: true });
    setImmediate(() => require('./clientnotice').tick().catch(() => {}));
  });
  app.get('/api/matters-deleted', L.need('admin'), (req, res) => res.json(db.prepare("SELECT m.id,m.file_no,m.title,m.deleted_at,c.name AS client_name,u.name AS deleted_by_name FROM matters m JOIN clients c ON c.id=m.client_id LEFT JOIN users u ON u.id=m.deleted_by WHERE m.tenant_id=? AND m.status='deleted' ORDER BY m.deleted_at DESC").all(T(req))));
  app.post('/api/matters/:id/restore', L.need('admin'), (req, res) => {
    const m = get(req, res, true); if (!m) return;
    db.prepare("UPDATE matters SET status=COALESCE(prev_status,'open'), deleted_at=NULL, deleted_by=NULL, prev_status=NULL WHERE id=?").run(m.id);
    D.audit(T(req), req.user.id, 'matter_restored', 'matter', m.id, m.file_no, req.ip); res.json({ ok: true });
  });
  app.delete('/api/matters/:id/purge', L.need('admin'), (req, res) => {
    if (!req.saProxy) return res.status(403).json({ error: 'Only the portal owner (Super Admin) can delete a case for good. It stays in the Recycle Bin and can be restored.' });
    const m = get(req, res, true); if (!m) return;
    if (String((req.body || {}).confirm || '').trim().toLowerCase() !== String(m.file_no).toLowerCase()) return res.status(400).json({ error: 'Type the file number exactly to confirm.' });
    // everything that belongs only to the case goes; shared records (files, letters, tasks, bills, register) stay but lose the link
    const tabs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((x) => x.name).filter((n) => n !== 'matters' && db.prepare(`PRAGMA table_info("${n}")`).all().some((c) => c.name === 'matter_id'));
    db.exec('BEGIN');
    try { for (const n of tabs) { try { db.prepare(`UPDATE "${n}" SET matter_id=NULL WHERE matter_id=?`).run(m.id); } catch (e) { db.prepare(`DELETE FROM "${n}" WHERE matter_id=?`).run(m.id); } }
      db.prepare('DELETE FROM matters WHERE id=?').run(m.id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: 'Could not remove the case: ' + e.message }); }
    D.audit(T(req), req.user.id, 'matter_purged', 'matter', m.id, m.file_no, req.ip); res.json({ ok: true });
  });
};
