'use strict';
const L = require('../lib');
const { db, audit } = L;

module.exports = (app, limiter) => {
  const tenant = () => db.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id, phone: u.phone });

  app.post('/api/login', limiter, (req, res) => {
    const email = L.str(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    const t = tenant();
    const u = db.prepare('SELECT * FROM users WHERE tenant_id=? AND email=? AND active=1').get(t.id, email);
    const fail = () => res.status(401).json({ error: 'Email or password is not correct.' });
    if (!u || !u.pass_hash) { L.checkPassword(password, '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali'); return fail(); }
    if (u.locked_until && u.locked_until > L.nowIso()) return res.status(429).json({ error: 'Too many wrong attempts. Try again in a few minutes.' });
    if (!L.checkPassword(password, u.pass_hash)) {
      const n = (u.failed_logins || 0) + 1;
      db.prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?')
        .run(n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, u.id);
      audit(t.id, u.id, 'login_failed', 'user', u.id, null, L.ip(req));
      return fail();
    }
    db.prepare('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?').run(u.id);
    const token = L.createSession(u.id);
    res.cookie('kc_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 7 * 86400000, path: '/' });
    audit(t.id, u.id, 'login', 'user', u.id, null, L.ip(req));
    res.json({ user: publicUser(u) });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies && req.cookies.kc_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    res.clearCookie('kc_session', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null, tenant: { name: tenant().name } });
    res.json({ user: publicUser(req.user), tenant: { name: tenant().name } });
  });

  app.post('/api/password', L.requireLogin, (req, res) => {
    const { current, next } = req.body;
    if (!L.checkPassword(String(current || ''), req.user.pass_hash)) return res.status(400).json({ error: 'Current password is not correct.' });
    const problem = L.passwordProblem(next);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(L.hashPassword(next), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, req.cookies.kc_session);
    audit(req.user.tenant_id, req.user.id, 'password_changed', 'user', req.user.id, null, L.ip(req));
    res.json({ ok: true });
  });

  // Accept an invitation: set a password using the one-time link.
  app.get('/api/invite/:token', limiter, (req, res) => {
    const u = db.prepare('SELECT name,email,role FROM users WHERE invite_token=? AND invite_expires>?').get(req.params.token, L.nowIso());
    if (!u) return res.status(404).json({ error: 'This invitation link is not valid or has expired.' });
    res.json(u);
  });
  app.post('/api/invite/:token', limiter, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE invite_token=? AND invite_expires>?').get(req.params.token, L.nowIso());
    if (!u) return res.status(404).json({ error: 'This invitation link is not valid or has expired.' });
    const problem = L.passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare('UPDATE users SET pass_hash=?, invite_token=NULL, invite_expires=NULL, active=1 WHERE id=?').run(L.hashPassword(req.body.password), u.id);
    audit(u.tenant_id, u.id, 'invite_accepted', 'user', u.id, null, L.ip(req));
    res.json({ ok: true });
  });

  // ----- User management (admin) -----
  app.get('/api/users', L.need('admin', 'advocate', 'staff', 'telecaller', 'accounts'), (req, res) => {
    const rows = db.prepare(`SELECT id,name,email,phone,role,active FROM users WHERE tenant_id=? AND role<>'client' ORDER BY name`).all(req.user.tenant_id);
    res.json(rows);
  });

  const inviteFor = (userId) => {
    const token = L.rand(24);
    db.prepare('UPDATE users SET invite_token=?, invite_expires=? WHERE id=?').run(token, L.addDays(7), userId);
    return token;
  };

  app.post('/api/users', L.need('admin'), (req, res) => {
    const name = L.str(req.body.name, 120), email = L.str(req.body.email, 200).toLowerCase();
    const role = L.str(req.body.role, 20);
    if (!L.must(res, name && /^\S+@\S+\.\S+$/.test(email), 'Name and a valid email are required.')) return;
    if (!L.must(res, ['advocate', 'staff', 'telecaller', 'accounts', 'admin'].includes(role), 'Choose a valid role.')) return;
    try {
      const r = db.prepare('INSERT INTO users(tenant_id,email,name,phone,role,active) VALUES (?,?,?,?,?,1)')
        .run(req.user.tenant_id, email, name, L.str(req.body.phone, 30), role);
      const token = inviteFor(r.lastInsertRowid);
      audit(req.user.tenant_id, req.user.id, 'user_created', 'user', r.lastInsertRowid, role, L.ip(req));
      res.json({ id: r.lastInsertRowid, invite_path: '/#/invite/' + token });
    } catch (e) { res.status(400).json({ error: 'A user with this email already exists.' }); }
  });

  app.post('/api/users/:id/invite', L.need('admin'), (req, res) => {
    const u = db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!u) return res.status(404).json({ error: 'Not found.' });
    res.json({ invite_path: '/#/invite/' + inviteFor(u.id) });
  });

  app.patch('/api/users/:id', L.need('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!u) return res.status(404).json({ error: 'Not found.' });
    if (u.id === req.user.id && req.body.active === 0) return res.status(400).json({ error: 'You cannot deactivate yourself.' });
    db.prepare('UPDATE users SET name=?, phone=?, role=CASE WHEN role=\'client\' THEN role ELSE ? END, active=? WHERE id=?')
      .run(L.str(req.body.name || u.name, 120), L.str(req.body.phone ?? u.phone, 30), L.str(req.body.role || u.role, 20), req.body.active === 0 ? 0 : 1, u.id);
    if (req.body.active === 0) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    audit(req.user.tenant_id, req.user.id, 'user_updated', 'user', u.id, null, L.ip(req));
    res.json({ ok: true });
  });

  app.get('/api/audit', L.need('admin'), (req, res) => {
    res.json(db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 200`).all(req.user.tenant_id));
  });

  app.inviteFor = inviteFor;
};
