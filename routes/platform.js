'use strict';
// Super Admin: creates and manages firms (each firm = one Admin + its own team, clients and data). Never sees firm data.
const L = require('../lib');
const { db, audit } = L;
const tpl = require('./template');

module.exports = (app) => {
  const SA = L.need('superadmin');
  const invite = (userId) => { const t = L.rand(24); db.prepare('UPDATE users SET invite_token=?, invite_expires=? WHERE id=?').run(t, L.addDays(7), userId); return '/#/invite/' + t; };
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const cnt = (sql, id) => db.prepare(sql).get(id).n;

  app.get('/api/platform/firms', SA, (req, res) => {
    const rows = db.prepare("SELECT id,name,slug,prefix,active,created_at FROM tenants WHERE kind='firm' ORDER BY id").all();
    res.json(rows.map((f) => ({
      ...f,
      admins: db.prepare("SELECT id,name,email,active,(pass_hash IS NOT NULL) AS joined FROM users WHERE tenant_id=? AND role='admin' ORDER BY id").all(f.id),
      team: cnt("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role NOT IN ('admin','client')", f.id),
      clients: cnt('SELECT COUNT(*) n FROM clients WHERE tenant_id=?', f.id),
    })));
  });

  app.post('/api/platform/firms', SA, (req, res) => {
    const name = L.str(req.body.name, 120), prefix = L.str(req.body.prefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const slug = slugify(req.body.slug || name), aname = L.str(req.body.admin_name, 120), aemail = L.str(req.body.admin_email, 200).toLowerCase();
    if (!L.must(res, name && prefix.length >= 2 && slug && aname && /^\S+@\S+\.\S+$/.test(aemail), 'Firm name, a short prefix (2–6 letters, used in numbering), the Admin\'s name and a valid email are required.')) return;
    if (!L.must(res, !db.prepare('SELECT 1 FROM tenants WHERE slug=?').get(slug), 'A firm with this web name already exists.')) return;
    const out = db.transaction(() => {
      const tid = db.prepare('INSERT INTO tenants(name,slug,prefix) VALUES (?,?,?)').run(name, slug, prefix).lastInsertRowid;
      const ct = db.prepare('INSERT INTO consult_types(tenant_id,name,minutes,fee_paise) VALUES (?,?,?,?)');
      ct.run(tid, 'Quick consultation', 20, 50000); ct.run(tid, 'Detailed consultation', 45, 150000);
      const uid = db.prepare("INSERT INTO users(tenant_id,email,name,role) VALUES (?,?,?,'admin')").run(tid, aemail, aname).lastInsertRowid;
      tpl.ensureTemplate({ id: tid, name }, false);
      return { id: tid, invite_path: invite(uid) };
    })();
    audit(null, req.user.id, 'firm_created', 'tenant', out.id, name, L.ip(req));
    res.json({ ...out, slug });
  });

  app.post('/api/platform/firms/:id/admins', SA, (req, res) => {
    const f = db.prepare("SELECT * FROM tenants WHERE id=? AND kind='firm'").get(req.params.id);
    const aname = L.str(req.body.name, 120), aemail = L.str(req.body.email, 200).toLowerCase();
    if (!L.must(res, f && aname && /^\S+@\S+\.\S+$/.test(aemail), 'Name and a valid email are required.')) return;
    try {
      const uid = db.prepare("INSERT INTO users(tenant_id,email,name,role) VALUES (?,?,?,'admin')").run(f.id, aemail, aname).lastInsertRowid;
      audit(null, req.user.id, 'firm_admin_created', 'tenant', f.id, aemail, L.ip(req));
      res.json({ invite_path: invite(uid) });
    } catch (e) { res.status(400).json({ error: 'This email is already used in that firm.' }); }
  });

  app.post('/api/platform/admins/:id/invite', SA, (req, res) => {
    const u = db.prepare("SELECT id FROM users WHERE id=? AND role='admin'").get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Not found.' });
    res.json({ invite_path: invite(u.id) });
  });

  app.patch('/api/platform/firms/:id', SA, (req, res) => {
    const f = db.prepare("SELECT * FROM tenants WHERE id=? AND kind='firm'").get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Not found.' });
    const name = L.str(req.body.name, 120) || f.name, active = req.body.active === undefined ? f.active : (req.body.active === true || req.body.active === 1 ? 1 : 0);
    db.prepare('UPDATE tenants SET name=?, active=? WHERE id=?').run(name, active, f.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=?)').run(f.id);
    audit(null, req.user.id, active ? 'firm_updated' : 'firm_disabled', 'tenant', f.id, name, L.ip(req));
    res.json({ ok: true });
  });
};
