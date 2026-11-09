'use strict';
// Client-portal controls: switch the portal off (whole firm / one client), switch document sharing off for one client,
// and the activity log of what a client does in the portal.
const L = require('../lib');
const { db, audit } = L;

const LABEL = { login: 'Signed in', logout: 'Signed out', login_refused: 'Tried to sign in (portal closed)', login_failed: 'Wrong password entered', viewed_cases: 'Looked at My cases', viewed_case: 'Opened a case',
  viewed_fees: 'Looked at Fees', viewed_invoice: 'Opened an invoice', viewed_receipt: 'Opened a receipt', viewed_letters: 'Looked at Letters', viewed_letter: 'Opened a letter', opened_files: 'Opened My files',
  opened_messages: 'Opened Messages', message_sent: 'Sent a message', file_downloaded: 'Downloaded a file', file_uploaded: 'Uploaded a file', document_uploaded: 'Uploaded a document', folder_created: 'Created a folder' };

const ROUTES = [['GET', /^\/api\/matters$/, 'viewed_cases'], ['GET', /^\/api\/matters\/(\d+)$/, 'viewed_case', 'matter'], ['GET', /^\/api\/invoices$/, 'viewed_fees'], ['GET', /^\/api\/invoices\/(\d+)$/, 'viewed_invoice', 'invoice'],
  ['GET', /^\/api\/payments\/(\d+)$/, 'viewed_receipt', 'payment'], ['GET', /^\/api\/letters$/, 'viewed_letters'], ['GET', /^\/api\/letters\/(\d+)$/, 'viewed_letter', 'letter'], ['GET', /^\/api\/fs\/list$/, 'opened_files'],
  ['GET', /^\/api\/messages$/, 'opened_messages'], ['POST', /^\/api\/messages$/, 'message_sent']];

// Records what a signed-in client does. The same page opened again within 10 minutes is not logged twice.
function mw(req, res, next) {
  res.on('finish', () => {
    try {
      const u = req.user; if (!u || u.role !== 'client' || res.statusCode >= 400) return;
      for (const [m, rx, action, ent] of ROUTES) {
        if (req.method !== m) continue; const x = rx.exec(req.path); if (!x) continue;
        const eid = x[1] ? +x[1] : null;
        if (action !== 'message_sent' && db.prepare("SELECT 1 FROM audit_log WHERE user_id=? AND action=? AND entity_id IS ? AND created_at > datetime('now','-10 minutes')").get(u.id, action, eid)) return;
        audit(u.tenant_id, u.id, action, ent || null, eid, null, L.ip(req)); return;
      }
    } catch (e) { /* logging must never break a request */ }
  });
  next();
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const AI = require('../aicore');

  // firm-wide switch
  app.get('/api/portal-access', L.need('admin'), (req, res) => res.json({ client_portal: AI.getS(T(req), 'client_portal', '1') !== '0' }));
  app.put('/api/portal-access', L.need('admin'), (req, res) => {
    const on = !!req.body.client_portal; AI.setS(T(req), 'client_portal', on ? '1' : '0');
    audit(T(req), req.user.id, on ? 'portal_opened_all' : 'portal_closed_all', 'firm', null, null, L.ip(req));
    res.json({ client_portal: on });
  });
  // per-client switches
  app.put('/api/clients/:id/access', L.need('admin', 'advocate'), (req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!c) return res.status(404).json({ error: 'Not found.' });
    const pb = req.body.portal_blocked === undefined ? c.portal_blocked : (req.body.portal_blocked ? 1 : 0), sb = req.body.share_blocked === undefined ? c.share_blocked : (req.body.share_blocked ? 1 : 0);
    db.prepare('UPDATE clients SET portal_blocked=?, share_blocked=? WHERE id=?').run(pb, sb, c.id);
    if (pb !== c.portal_blocked) audit(T(req), req.user.id, pb ? 'client_portal_blocked' : 'client_portal_unblocked', 'client', c.id, c.name, L.ip(req));
    if (sb !== c.share_blocked) audit(T(req), req.user.id, sb ? 'client_sharing_blocked' : 'client_sharing_unblocked', 'client', c.id, c.name, L.ip(req));
    if (req.body.no_reminders !== undefined) db.prepare('UPDATE clients SET no_reminders=? WHERE id=?').run(req.body.no_reminders ? 1 : 0, c.id);
    res.json({ portal_blocked: pb, share_blocked: sb });
  });

  // what the client has been doing
  app.get('/api/clients/:id/activity', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const t = T(req), c = db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!c) return res.status(404).json({ error: 'Not found.' });
    const from = L.isDate(req.query.from) ? req.query.from : '0000-01-01', to = L.isDate(req.query.to) ? req.query.to : '9999-12-31';
    const rows = db.prepare(`SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.ip,a.created_at FROM audit_log a
      WHERE a.tenant_id=? AND a.user_id IN (SELECT id FROM users WHERE client_id=?) AND date(a.created_at)>=? AND date(a.created_at)<=? ORDER BY a.id DESC LIMIT 1000`).all(t, c.id, from, to);
    const nm = { fs: (id) => (db.prepare('SELECT name FROM fs_nodes WHERE id=?').get(id) || {}).name, matter: (id) => { const m = db.prepare('SELECT file_no,title FROM matters WHERE id=?').get(id); return m && `${m.file_no} — ${m.title}`; },
      invoice: (id) => (db.prepare('SELECT inv_no FROM invoices WHERE id=?').get(id) || {}).inv_no, payment: (id) => (db.prepare('SELECT rec_no FROM payments WHERE id=?').get(id) || {}).rec_no,
      letter: (id) => (db.prepare('SELECT subject FROM letters WHERE id=?').get(id) || {}).subject };
    res.json({ client: c.name, rows: rows.map((r) => ({ at: r.created_at, what: LABEL[r.action] || r.action.replace(/_/g, ' '), detail: r.detail || (r.entity && r.entity_id && nm[r.entity] ? nm[r.entity](r.entity_id) : '') || '', ip: r.ip || '' })) });
  });
};
module.exports.mw = mw;
