'use strict';
const L = require('../lib');
const { db, audit } = L;

module.exports = (app, limiter) => {
  const tenantOf = (u) => (u ? db.prepare('SELECT id,name,kind,slug FROM tenants WHERE id=?').get(u.tenant_id) : null) || L.defaultFirm();
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id, phone: u.phone });

  app.post('/api/login', limiter, (req, res) => {
    const email = L.str(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    const fail = () => res.status(401).json({ error: 'Email or password is not correct.' });
    // The same email can exist in more than one firm; sign in to the firm whose password matches.
    let cands = db.prepare('SELECT u.*, t.name AS firm_name, t.slug AS firm_slug FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=? AND u.active=1 AND t.active=1 AND u.pass_hash IS NOT NULL').all(email);
    // A firm-specific login link (?firm=slug) limits the check to that firm; platform staff (Super Admin) may still sign in from any link.
    const firmSlug = L.str(req.body.firm, 60);
    if (firmSlug) cands = cands.filter((c) => c.firm_slug === firmSlug || c.role === 'superadmin');
    if (!cands.length) { L.checkPassword(password, '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali'); return fail(); }
    const locked = cands.find((c) => c.locked_until && c.locked_until > L.nowIso());
    if (locked && !cands.some((c) => !(c.locked_until && c.locked_until > L.nowIso()) && L.checkPassword(password, c.pass_hash))) return res.status(429).json({ error: 'Too many wrong attempts. Try again in a few minutes.' });
    const u = cands.find((c) => !(c.locked_until && c.locked_until > L.nowIso()) && L.checkPassword(password, c.pass_hash));
    if (!u) {
      for (const c of cands) {
        const n = (c.failed_logins || 0) + 1;
        db.prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?').run(n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, c.id);
        audit(c.tenant_id, c.id, 'login_failed', 'user', c.id, null, L.ip(req));
      }
      return fail();
    }
    // Same person, same password, more than one firm: ask which firm to open (password already proved).
    if (!firmSlug) {
      const also = cands.filter((c) => !(c.locked_until && c.locked_until > L.nowIso()) && L.checkPassword(password, c.pass_hash));
      if (also.length > 1) return res.status(409).json({ error: 'Choose the firm to open.', choices: also.map((c) => ({ slug: c.firm_slug, name: c.firm_name })) });
    }
    const GROUPS = { client: ['client'], firm: ['advocate', 'staff', 'telecaller', 'accounts'], admin: ['admin', 'superadmin'] };
    const NAMES = { client: 'Client Login', firm: 'Law Firm Login', admin: 'Administrator Login' };
    const as = String(req.body.as || '');
    if (GROUPS[as] && !GROUPS[as].includes(u.role)) {
      const right = Object.keys(GROUPS).find((k) => GROUPS[k].includes(u.role));
      return res.status(403).json({ error: 'This is the ' + NAMES[as] + ' page. Please use the ' + NAMES[right] + ' page instead.' });
    }
    if (u.role === 'client' && L.portalClosed(u)) { audit(u.tenant_id, u.id, 'login_refused', 'user', u.id, 'portal closed', L.ip(req)); return res.status(403).json({ error: L.CLOSED_MSG, blocked: true }); }
    const t = { id: u.tenant_id };
    db.prepare('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?').run(u.id);
    const token = L.createSession(u.id);
    res.cookie('kc_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 7 * 86400000, path: '/' });
    audit(t.id, u.id, 'login', 'user', u.id, null, L.ip(req));
    res.json({ user: publicUser(u) });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies && req.cookies.kc_session;
    if (token) { if (req.user && req.user.role === 'client') audit(req.user.tenant_id, req.user.id, 'logout', 'user', req.user.id, null, L.ip(req)); db.prepare('DELETE FROM sessions WHERE token=?').run(token); }
    res.clearCookie('kc_session', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    const t = tenantOf(req.user);
    res.json({ user: req.user ? publicUser(req.user) : null, tenant: { name: t ? (t.kind === 'platform' ? 'Platform' : t.name) : 'Portal', kind: t ? t.kind : 'firm' } });
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
    db.prepare('UPDATE users SET pass_hash=?, invite_token=NULL, invite_expires=NULL, active=1, failed_logins=0, locked_until=NULL WHERE id=?').run(L.hashPassword(req.body.password), u.id);
    audit(u.tenant_id, u.id, 'invite_accepted', 'user', u.id, null, L.ip(req));
    res.json({ ok: true });
  });

  // Forgot password: always answers the same, so nobody can discover which emails exist. The link is valid for 30 minutes.
  app.post('/api/forgot', limiter, async (req, res) => {
    const email = L.str(req.body.email, 200).toLowerCase(), firmSlug = L.str(req.body.firm, 60);
    res.json({ ok: true, message: 'If this email is registered, a link to set a new password has been sent. It is valid for 30 minutes. If nothing arrives, please ask the office to send you a fresh link.' });
    try {
      let us = db.prepare('SELECT u.*, t.name AS firm_name, t.slug AS firm_slug FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=? AND u.active=1 AND t.active=1').all(email);
      if (firmSlug) us = us.filter((c) => c.firm_slug === firmSlug || c.role === 'superadmin');
      const base = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
      for (const u of us) {
        const token = L.rand(24);
        db.prepare('UPDATE users SET invite_token=?, invite_expires=? WHERE id=?').run(token, new Date(Date.now() + 30 * 60000).toISOString(), u.id);
        audit(u.tenant_id, u.id, 'password_reset_requested', 'user', u.id, null, L.ip(req));
        const M = require('./aimail');
        const tid = u.role === 'superadmin' ? (L.defaultFirm() || {}).id : u.tenant_id;
        M.sendMail(tid, { to: u.email, subject: 'Set a new password - ' + u.firm_name, text: `Dear ${u.name},\n\nUse this link to set a new password (valid for 30 minutes):\n${base}/#/invite/${token}\n\nIf you did not ask for this, ignore this email; your password stays as it is.\n\n${u.firm_name}` }).catch(() => {});
      }
    } catch (e) { /* silent by design */ }
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
    if (!L.must(res, ['advocate', 'staff', 'telecaller', 'accounts'].includes(role), 'Choose a valid role. Administrators are created by the Super Admin.')) return;
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
    const newRole = ['advocate', 'staff', 'telecaller', 'accounts'].includes(req.body.role) && !['admin', 'client'].includes(u.role) ? req.body.role : u.role;
    db.prepare('UPDATE users SET name=?, phone=?, role=?, active=? WHERE id=?')
      .run(L.str(req.body.name || u.name, 120), L.str(req.body.phone ?? u.phone, 30), newRole, req.body.active === 0 ? 0 : 1, u.id);
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
