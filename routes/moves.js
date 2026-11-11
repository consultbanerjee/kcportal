'use strict';
// FILE MOVEMENT (like moving a physical file from table to table): a case is handed to another staff member / advocate / telecaller,
// returnable by a date (default 24 hours). Not returned on time -> WhatsApp + e-mail asking to attend at once; 2 days later -> reminder;
// 1 more day with no response -> the case goes to the firm administrator, who allocates it afresh. Same rules for every firm.
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore'); const WA = require('./whatsapp');
db.exec(`CREATE TABLE IF NOT EXISTS matter_moves (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER NOT NULL, from_user INTEGER, to_user INTEGER NOT NULL, note TEXT,
  due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', stage INTEGER NOT NULL DEFAULT 0, notice1_at TEXT, notice2_at TEXT, escalated_to INTEGER, returned_by INTEGER, returned_at TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS matter_move_log (id INTEGER PRIMARY KEY, move_id INTEGER NOT NULL, kind TEXT, channel TEXT, status TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS ix_moves_open ON matter_moves(status, due_at);`);
const S = (t, k, d) => AI.getS(t, k, d);
const cfg = (t) => ({ hours: Math.max(1, Math.min(720, L.int(S(t, 'move_hours', '24'), 24))), remind_days: Math.max(1, Math.min(14, L.int(S(t, 'move_remind_days', '2'), 2))), final_days: Math.max(1, Math.min(14, L.int(S(t, 'move_final_days', '1'), 1))) });
const base = () => process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000);
const ist = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
const firmName = (t) => (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'the firm';
const user = (id) => db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(id);
const holder = (m) => m.assigned_to || null;

async function notify(t, mv, u, kind, subject, text) {
  if (!u) return;
  const log = (channel, status, error) => db.prepare('INSERT INTO matter_move_log(move_id,kind,channel,status,error) VALUES (?,?,?,?,?)').run(mv.id, kind, channel, status, error ? String(error).slice(0, 250) : null);
  try { const M = require('./aimail'); if (u.email && M.mailReady(t)) { await M.sendMail(t, { to: u.email, subject, text }); log('email', 'sent'); } else log('email', 'skipped'); } catch (e) { log('email', 'failed', e.message); }
  try { if (u.phone && WA.configured(t) && WA.normPhone(u.phone)) { await WA.sendToStaff(t, u.phone, [u.name, text.split('\n').filter(Boolean)[1] || subject, firmName(t)]); log('whatsapp', 'sent'); } else log('whatsapp', 'skipped'); } catch (e) { log('whatsapp', 'failed', e.message); }
}
const caseLine = (m) => `${m.file_no} — ${m.title}`;

async function tick() {
  const now = new Date().toISOString();
  for (const mv of db.prepare("SELECT * FROM matter_moves WHERE status='open'").all()) {
    const t = mv.tenant_id, c = cfg(t), m = db.prepare('SELECT * FROM matters WHERE id=?').get(mv.matter_id); if (!m) continue;
    const to = user(mv.to_user), link = base() + '/#/moves';
    if (mv.stage === 0 && now >= mv.due_at) {
      if (db.prepare("UPDATE matter_moves SET stage=1, notice1_at=? WHERE id=? AND stage=0").run(now, mv.id).changes !== 1) continue;
      await notify(t, mv, to, 'notice1', `Please attend now: file ${m.file_no} is overdue`, `Dear ${to.name},\nFile ${caseLine(m)} was to be returned by ${ist(mv.due_at)}. Please attend to it immediately and return it in the portal.\n${link}`);
    } else if (mv.stage === 1 && now >= new Date(new Date(mv.notice1_at).getTime() + c.remind_days * 864e5).toISOString()) {
      if (db.prepare("UPDATE matter_moves SET stage=2, notice2_at=? WHERE id=? AND stage=1").run(now, mv.id).changes !== 1) continue;
      await notify(t, mv, to, 'notice2', `REMINDER: file ${m.file_no} still not returned`, `Dear ${to.name},\nReminder: file ${caseLine(m)} is still with you and overdue. Please attend to it immediately; otherwise it will be taken back and re-allocated by the firm.\n${link}`);
    } else if (mv.stage === 2 && now >= new Date(new Date(mv.notice2_at).getTime() + c.final_days * 864e5).toISOString()) {
      const adm = db.prepare("SELECT id,name,email,phone,role FROM users WHERE tenant_id=? AND role='admin' AND active=1 ORDER BY id LIMIT 1").get(t); if (!adm) continue;
      if (db.prepare("UPDATE matter_moves SET status='escalated', escalated_to=?, returned_at=? WHERE id=? AND status='open'").run(adm.id, now, mv.id).changes !== 1) continue;
      db.prepare('UPDATE matters SET assigned_to=? WHERE id=?').run(adm.id, m.id);
      D.audit(t, null, 'file_escalated', 'matter', m.id, `from ${mv.to_user} to firm admin ${adm.id}`, null);
      await notify(t, mv, adm, 'escalated', `File ${m.file_no} returned to the firm for fresh allocation`, `Dear ${adm.name},\nFile ${caseLine(m)} was not returned by ${to ? to.name : 'the person it was moved to'} after two reminders. It is now with you for fresh allocation.\n${link}`);
      await notify(t, mv, to, 'taken_back', `File ${m.file_no} has been taken back`, `Dear ${to ? to.name : ''},\nFile ${caseLine(m)} has been taken back by the firm for re-allocation as it was not returned.`);
    }
  }
}
let timer; function startWorker() { timer = setInterval(() => tick().catch((e) => console.error('moves', e.message)), 5 * 60 * 1000); if (timer.unref) timer.unref(); setTimeout(() => tick().catch(() => {}), 25000).unref(); }

module.exports = (app) => {
  const T = (req) => req.user.tenant_id, OFF = L.need('admin', 'advocate', 'staff', 'telecaller', 'accounts');
  const row = `SELECT mv.*, m.file_no, m.title, m.client_id, fu.name AS from_name, tu.name AS to_name, c.name AS client_name FROM matter_moves mv JOIN matters m ON m.id=mv.matter_id JOIN clients c ON c.id=m.client_id LEFT JOIN users fu ON fu.id=mv.from_user LEFT JOIN users tu ON tu.id=mv.to_user`;
  const dress = (r) => ({ ...r, overdue: r.status === 'open' && new Date().toISOString() >= r.due_at });

  app.get('/api/moves', OFF, (req, res) => {
    const t = T(req), v = req.query.view || 'mine'; let w = 'mv.tenant_id=?', a = [t];
    if (v === 'mine') { w += " AND mv.to_user=? AND mv.status='open'"; a.push(req.user.id); }
    else if (v === 'out') { w += " AND mv.from_user=? AND mv.status='open'"; a.push(req.user.id); }
    else if (v === 'all') { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the firm administrator can see all movements.' }); }
    else { w += ' AND (mv.to_user=? OR mv.from_user=?)'; a.push(req.user.id, req.user.id); }
    res.json({ rows: db.prepare(`${row} WHERE ${w} ORDER BY mv.id DESC LIMIT 200`).all(...a).map(dress), cfg: cfg(t) });
  });
  app.get('/api/matters/:id/moves', OFF, (req, res) => {
    const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req)); if (!m || !app.locals.matterLevel(req, m)) return res.status(404).json({ error: 'Not found.' });
    const h = holder(m), hu = h ? user(h) : null;
    res.json({ holder: hu ? { id: hu.id, name: hu.name, role: hu.role } : null, open: (db.prepare(`${row} WHERE mv.matter_id=? AND mv.status='open'`).get(m.id) || null) && dress(db.prepare(`${row} WHERE mv.matter_id=? AND mv.status='open'`).get(m.id)),
      history: db.prepare(`${row} WHERE mv.matter_id=? ORDER BY mv.id DESC LIMIT 30`).all(m.id).map(dress), can_move: app.locals.matterAtLeast(req, m, 'full') && req.user.role !== 'client',
      people: db.prepare("SELECT id,name,role FROM users WHERE tenant_id=? AND role<>'client' AND role<>'superadmin' AND active=1 AND id<>? ORDER BY name").all(T(req), req.user.id), cfg: cfg(T(req)) });
  });
  app.post('/api/matters/:id/move', OFF, async (req, res) => {
    const t = T(req), m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), t); if (!m || !app.locals.matterLevel(req, m)) return res.status(404).json({ error: 'Not found.' });
    if (!app.locals.matterAtLeast(req, m, 'full')) return res.status(403).json({ error: 'Only the person who holds this file (or the administrator) can move it.' });
    const b = req.body || {}, to = db.prepare("SELECT id,name,email,phone,role FROM users WHERE id=? AND tenant_id=? AND role<>'client' AND role<>'superadmin' AND active=1").get(L.int(b.to_user), t);
    if (!L.must(res, to, 'Choose who the file is being moved to.')) return;
    if (to.id === req.user.id) return res.status(400).json({ error: 'Choose someone else.' });
    let due; if (b.due_date && L.isDate(b.due_date)) due = new Date(new Date(b.due_date + 'T23:59:00+05:30')).toISOString(); else due = new Date(Date.now() + cfg(t).hours * 3600000).toISOString();
    if (due <= new Date().toISOString()) return res.status(400).json({ error: 'The return date must be in the future.' });
    const from = holder(m) || req.user.id;
    db.prepare("UPDATE matter_moves SET status='forwarded', returned_at=? WHERE matter_id=? AND status='open'").run(new Date().toISOString(), m.id);
    const r = db.prepare('INSERT INTO matter_moves(tenant_id,matter_id,from_user,to_user,note,due_at,created_by) VALUES (?,?,?,?,?,?,?)').run(t, m.id, from, to.id, L.str(b.note, 500), due, req.user.id);
    db.prepare('UPDATE matters SET assigned_to=? WHERE id=?').run(to.id, m.id);
    // the person who handed the file over keeps read access to follow it
    if (from !== to.id && !db.prepare('SELECT 1 FROM matter_team WHERE matter_id=? AND user_id=?').get(m.id, from)) db.prepare("INSERT INTO matter_team(matter_id,tenant_id,user_id,level,added_by) VALUES (?,?,?,'view',?)").run(m.id, t, from, req.user.id);
    D.audit(t, req.user.id, 'file_moved', 'matter', m.id, `to ${to.id} due ${due}`, req.ip);
    const mv = { id: r.lastInsertRowid };
    notify(t, mv, to, 'moved', `File ${m.file_no} moved to you`, `Dear ${to.name},\nFile ${caseLine(m)} has been moved to you by ${req.user.name}${b.note ? ' — ' + L.str(b.note, 200) : ''}. Please return it by ${ist(due)}.\n${base()}/#/moves`).catch(() => {});
    res.json({ ok: true, id: mv.id, due_at: due });
  });
  app.post('/api/moves/:id/return', OFF, (req, res) => {
    const t = T(req), mv = db.prepare("SELECT * FROM matter_moves WHERE id=? AND tenant_id=? AND status='open'").get(L.int(req.params.id), t);
    if (!mv) return res.status(404).json({ error: 'This movement is already closed.' });
    if (![mv.to_user, mv.from_user].includes(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the person holding the file, the person who moved it, or the administrator can close this.' });
    db.prepare("UPDATE matter_moves SET status='returned', returned_by=?, returned_at=? WHERE id=?").run(req.user.id, new Date().toISOString(), mv.id);
    const back = user(mv.from_user) ? mv.from_user : req.user.id; db.prepare('UPDATE matters SET assigned_to=? WHERE id=?').run(back, mv.matter_id);
    D.audit(t, req.user.id, 'file_returned', 'matter', mv.matter_id, String(mv.id), req.ip);
    res.json({ ok: true });
  });
  app.put('/api/moves/settings', L.need('admin'), (req, res) => { const b = req.body || {}, t = T(req);
    AI.setS(t, 'move_hours', String(Math.max(1, Math.min(720, L.int(b.hours, 24))))); AI.setS(t, 'move_remind_days', String(Math.max(1, Math.min(14, L.int(b.remind_days, 2))))); AI.setS(t, 'move_final_days', String(Math.max(1, Math.min(14, L.int(b.final_days, 1))))); res.json({ ok: true, cfg: cfg(t) }); });
};
Object.assign(module.exports, { tick, startWorker });
