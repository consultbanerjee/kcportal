'use strict';
// ACTIVITY LOG: everything anyone does in the portal, with date and time (Indian time): sign-in, sign-out, and every entry, change or deletion.
// The firm administrator sees the log of their own firm; the Super Admin sees every firm and the platform. Read-only: nothing here can be edited or deleted.
// Same for every firm.
const L = require('../lib'); const D = require('../db'); const db = D.db;
const SKIP = /^\/api\/(login|logout|me|export|bundle|chat|heartbeat|public|invite|reset|forgot)(\/|$)/;
const NAMES = [[/\/notings$/, 'Added a file noting'], [/\/hearings$/, 'Recorded a hearing'], [/\/diary\/order$/, 'Re-ordered the case diary'], [/\/diary\/sort$/, 'Sorted the case diary by date'], [/\/diary$/, 'Added a case diary entry'], [/^\/api\/diary\//, 'Changed a case diary entry'],
  [/\/team$/, 'Changed the case team'], [/\/move$/, 'Moved a file to another person'], [/^\/api\/moves\/\d+\/return/, 'Returned a file'], [/\/restore$/, 'Restored a deleted case'], [/\/purge$/, 'Deleted a case forever'],
  [/^\/api\/matters\/\d+$/, 'Changed or deleted a case'], [/^\/api\/matters$/, 'Created a case'], [/^\/api\/clients\/\d+/, 'Changed a client'], [/^\/api\/clients$/, 'Created a client'], [/^\/api\/tasks/, 'Task entry or change'],
  [/^\/api\/fs\//, 'Files: added, renamed, moved or removed'], [/^\/api\/documents/, 'Document upload or change'], [/^\/api\/letters/, 'Letter entry or change'], [/^\/api\/invoices/, 'Invoice entry or change'], [/^\/api\/payments/, 'Payment entry or change'],
  [/^\/api\/register/, 'In-Out Register entry'], [/^\/api\/users/, 'User entry or change'], [/^\/api\/calendar/, 'Calendar entry or change'], [/^\/api\/ecourts?\//, 'Court data action'], [/^\/api\/drafts?/, 'Drafting action'], [/^\/api\/leads/, 'Lead entry or change'],
  [/^\/api\/(aiadmin|reminders|whatsapp|settings|template|alerts|team)/, 'Settings changed'], [/^\/api\/platform\//, 'Super Admin action']];
const HUMAN = { login: 'Signed in', logout: 'Signed out', login_failed: 'Wrong password entered', login_refused: 'Sign-in refused', password_changed: 'Changed password', invite_accepted: 'Accepted invitation and set password' };
const label = (r) => r.action === 'activity' ? ((NAMES.find(([rx]) => rx.test(String(r.detail || '').replace(/^\S+\s/, ''))) || [0, 'Made a change'])[1]) : (HUMAN[r.action] || String(r.action).replace(/_/g, ' ').replace(/matter/gi, 'case').replace(/^./, (c) => c.toUpperCase()));
const method = (d) => ({ POST: 'Added/created', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' }[String(d || '').split(' ')[0]] || '');
const ist = (s) => new Date(new Date(String(s).replace(' ', 'T') + 'Z').getTime() + 5.5 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
const fmt = (s) => { const d = ist(s); return new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ', ' + d.slice(11); };

// records every change (POST/PUT/PATCH/DELETE) that the code did not already log itself
function mw(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.path.startsWith('/api/') || SKIP.test(req.path)) return next();
  let start = 0; try { start = db.prepare('SELECT COALESCE(MAX(id),0) m FROM audit_log').get().m; } catch (e) { /* ignore */ }
  res.on('finish', () => {
    try {
      const u = req.user; if (!u || res.statusCode >= 400) return;
      if (db.prepare('SELECT 1 FROM audit_log WHERE id>? AND user_id=? LIMIT 1').get(start, u.id)) return;
      const m = req.path.match(/\/(\d+)/);
      D.audit(u.tenant_id, u.id, 'activity', req.path.split('/')[2] || null, m ? +m[1] : null, `${req.method} ${req.path.replace(/\/\d+/g, '/#')}`, L.ip(req));
    } catch (e) { /* logging must never break a request */ }
  });
  next();
}

function query(req, tenant) {
  const q = req.query, w = [], a = [];
  if (tenant !== undefined && tenant !== null) { w.push('a.tenant_id=?'); a.push(tenant); }
  if (L.isDate(q.from)) { w.push("date(datetime(a.created_at,'+330 minutes'))>=?"); a.push(q.from); }
  if (L.isDate(q.to)) { w.push("date(datetime(a.created_at,'+330 minutes'))<=?"); a.push(q.to); }
  if (L.int(q.user)) { w.push('a.user_id=?'); a.push(L.int(q.user)); }
  const act = String(q.kind || ''); if (act === 'signin') w.push("a.action IN ('login','logout','login_failed','login_refused')"); else if (act === 'changes') w.push("a.action NOT IN ('login','logout','login_failed','login_refused')");
  const text = L.str(q.q, 60); if (text) { w.push('(a.action LIKE ? OR a.detail LIKE ? OR u.name LIKE ?)'); a.push('%' + text + '%', '%' + text + '%', '%' + text + '%'); }
  const rows = db.prepare(`SELECT a.id,a.tenant_id,a.user_id,a.action,a.entity,a.entity_id,a.detail,a.ip,a.created_at,u.name AS user_name,u.role AS user_role,t.name AS firm FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN tenants t ON t.id=a.tenant_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${Math.max(1, Math.min(5000, L.int(q.limit, 1000)))}`).all(...a);
  const out = rows.map((r) => ({ id: r.id, at: fmt(r.created_at), raw: r.created_at, user: r.user_name || '—', role: r.user_role || '', firm: r.firm || 'Platform', what: label(r), kind: method(r.detail), detail: r.action === 'activity' ? (r.entity_id ? `Record ${r.entity_id}` : '') : (r.detail || ''), ip: r.ip || '' }));
  // who was in, when
  const by = {}; for (const r of rows) { const k = r.user_id || 0, x = by[k] || (by[k] = { user: r.user_name || '—', role: r.user_role || '', firm: r.firm || 'Platform', first_in: null, last_out: null, actions: 0, signins: 0 });
    if (r.action === 'login') { x.signins++; x.first_in = r.created_at; } else if (r.action === 'logout') { if (!x.last_out) x.last_out = r.created_at; } else if (r.action !== 'login_failed' && r.action !== 'login_refused') x.actions++; }
  const sum = Object.values(by).map((x) => ({ ...x, first_in: x.first_in ? fmt(x.first_in) : '—', last_out: x.last_out ? fmt(x.last_out) : '—' }));
  return { rows: out, summary: sum };
}
module.exports = (app) => {
  app.get('/api/activity', L.need('admin'), (req, res) => {
    const t = req.user.tenant_id, r = query(req, t);
    res.json({ ...r, users: db.prepare("SELECT id,name,role FROM users WHERE tenant_id=? ORDER BY name").all(t) });
  });
  app.get('/api/platform/activity', L.need('superadmin'), (req, res) => {
    const f = L.int(req.query.firm), r = query(req, f || undefined);
    res.json({ ...r, firms: db.prepare("SELECT id,name FROM tenants WHERE kind='firm' ORDER BY name").all(), users: f ? db.prepare('SELECT id,name,role FROM users WHERE tenant_id=? ORDER BY name').all(f) : [] });
  });
};
module.exports.mw = mw;
