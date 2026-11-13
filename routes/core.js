'use strict';
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const L = require('../lib');
const { db, audit, nextNumber } = L;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const isClient = (u) => u.role === 'client';
const pad = (n, w = 4) => String(n).padStart(w, '0');

// "Reference" = the person/source through whom the client came; it becomes a folder name in Drive, so keep it plain
const refName = (v) => L.str(v, 100).replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').trim();

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  app.get('/api/references', L.office, (req, res) => res.json(db.prepare("SELECT reference AS name, COUNT(*) AS clients FROM clients WHERE tenant_id=? AND reference IS NOT NULL AND reference<>'' GROUP BY lower(reference) ORDER BY reference").all(T(req))));

  // ---------- Clients ----------
  app.get('/api/clients', L.office, (req, res) => {
    const q = '%' + L.str(req.query.q, 80) + '%';
    res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM matters m WHERE m.client_id=c.id AND m.status<>'deleted') AS matters,
      (SELECT COUNT(*) FROM users u WHERE u.client_id=c.id AND u.pass_hash IS NOT NULL) AS has_login
      FROM clients c WHERE c.tenant_id=? AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.reference LIKE ?)${app.locals.clientRestricted(req) ? ' AND c.id IN (SELECT m.client_id FROM matters m WHERE 1=1' + app.locals.teamSql(req).sql + ')' : ''} ORDER BY c.name LIMIT 300`)
      .all(T(req), q, q, q, q, ...(app.locals.clientRestricted(req) ? app.locals.teamSql(req).args : [])));
  });

  app.post('/api/clients', L.need('admin', 'advocate', 'staff', 'telecaller'), (req, res) => {
    const name = L.str(req.body.name, 150);
    if (!L.must(res, name, 'Client name is required.')) return;
    const r = db.prepare('INSERT INTO clients(tenant_id,name,email,phone,address,notes,reference) VALUES (?,?,?,?,?,?,?)')
      .run(T(req), name, L.str(req.body.email, 200).toLowerCase(), L.str(req.body.phone, 30), L.str(req.body.address, 400), L.str(req.body.notes, 1000), refName(req.body.reference));
    audit(T(req), req.user.id, 'client_created', 'client', r.lastInsertRowid, name, L.ip(req));
    res.json({ id: r.lastInsertRowid });
  });

  app.get('/api/clients/:id', L.office, (req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!c || (app.locals.clientRestricted(req) && !app.locals.clientLevel(req, c.id))) return res.status(404).json({ error: 'Not found.' });
    c.matters = db.prepare('SELECT id,file_no,title,forum,status,assigned_to FROM matters WHERE client_id=? AND status<>\'deleted\' ORDER BY id DESC').all(c.id).filter((x) => app.locals.matterLevel(req, { ...x, client_id: c.id, tenant_id: c.tenant_id }));
    c.login = db.prepare('SELECT id,email,active,(pass_hash IS NOT NULL) AS set_up FROM users WHERE client_id=?').get(c.id) || null;
    const inv = db.prepare('SELECT COALESCE(SUM(total_paise),0) t FROM invoices WHERE client_id=? AND status<>\'draft\' AND status<>\'cancelled\'').get(c.id).t;
    const paid = db.prepare('SELECT COALESCE(SUM(amount_paise),0) t FROM payments WHERE client_id=?').get(c.id).t;
    c.billed_paise = inv; c.paid_paise = paid;
    res.json(c);
  });

  app.put('/api/clients/:id', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!c) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE clients SET name=?,email=?,phone=?,address=?,notes=?,reference=? WHERE id=?').run(
      L.str(req.body.name || c.name, 150), L.str(req.body.email ?? c.email, 200).toLowerCase(), L.str(req.body.phone ?? c.phone, 30),
      L.str(req.body.address ?? c.address, 400), L.str(req.body.notes ?? c.notes, 1000), req.body.reference === undefined ? c.reference : refName(req.body.reference), c.id);
    res.json({ ok: true });
  });

  // Create / re-issue the client's portal login (one-time invitation link).
  app.post('/api/clients/:id/login', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!c) return res.status(404).json({ error: 'Not found.' });
    const email = L.str(req.body.email || c.email, 200).toLowerCase();
    if (!L.must(res, /^\S+@\S+\.\S+$/.test(email), 'A valid email is needed for the client login.')) return;
    let u = db.prepare('SELECT * FROM users WHERE client_id=?').get(c.id);
    if (!u) {
      try {
        const r = db.prepare(`INSERT INTO users(tenant_id,email,name,phone,role,client_id,active) VALUES (?,?,?,?, 'client', ?, 1)`)
          .run(T(req), email, c.name, c.phone, c.id);
        u = { id: r.lastInsertRowid };
      } catch (e) { return res.status(400).json({ error: 'This email is already used by another login.' }); }
    }
    const token = L.rand(24);
    db.prepare('UPDATE users SET invite_token=?, invite_expires=?, active=1 WHERE id=?').run(token, L.addDays(7), u.id);
    audit(T(req), req.user.id, 'client_login_invited', 'client', c.id, email, L.ip(req));
    res.json({ invite_path: '/#/invite/' + token });
  });

  // ---------- Matters ----------
  const matterScope = (req) => isClient(req.user) ? { sql: ' AND m.client_id=?', arg: req.user.client_id } : { sql: '', arg: null };

  app.get('/api/matters', L.requireLogin, (req, res) => {
    const q = '%' + L.str(req.query.q, 80) + '%';
    const sc = matterScope(req);
    const params = [T(req), q, q, q]; if (sc.arg) params.push(sc.arg);
    const tm = app.locals.teamSql ? app.locals.teamSql(req) : { sql: '', args: [] }; params.push(...tm.args);
    const rows = db.prepare(`SELECT m.id,m.file_no,m.title,m.forum,m.case_no,m.stage,m.status,m.client_id,c.name AS client_name,m.labels,
      (SELECT MIN(next_date) FROM hearings h WHERE h.matter_id=m.id AND h.next_date>=date('now')) AS next_date
      FROM matters m JOIN clients c ON c.id=m.client_id AND m.status<>'deleted'
      WHERE m.tenant_id=? AND (m.title LIKE ? OR m.file_no LIKE ? OR c.name LIKE ?)${sc.sql}${tm.sql} ORDER BY m.id DESC LIMIT 300`).all(...params);
    if (isClient(req.user)) for (const r of rows) delete r.labels;
    res.json(rows);
  });

  app.post('/api/matters', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.body.client_id), T(req));
    const title = L.str(req.body.title, 250);
    if (!L.must(res, client && title, 'Choose a client and enter the matter title.')) return;
    const { n, year } = nextNumber(T(req), 'matter');
    const file_no = `${(db.prepare('SELECT prefix FROM tenants WHERE id=?').get(T(req)) || {}).prefix || 'KC'}/M/${pad(n)}/${year}`;
    const r = db.prepare(`INSERT INTO matters(tenant_id,client_id,file_no,title,forum,case_no,opposite_party,stage,assigned_to,summary,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(T(req), client.id, file_no, title, L.str(req.body.forum, 200), L.str(req.body.case_no, 100),
      L.str(req.body.opposite_party, 250), L.str(req.body.stage, 100), L.int(req.body.assigned_to), L.str(req.body.summary, 3000), req.user.id);
    audit(T(req), req.user.id, 'matter_created', 'matter', r.lastInsertRowid, file_no, L.ip(req));
    res.json({ id: r.lastInsertRowid, file_no });
  });

  const loadMatter = (req, res, need) => {
    const m = db.prepare(`SELECT m.*, c.name AS client_name FROM matters m JOIN clients c ON c.id=m.client_id WHERE m.id=? AND m.tenant_id=?`).get(req.params.id, T(req));
    if (!m || (isClient(req.user) && m.client_id !== req.user.client_id)) { res.status(404).json({ error: 'Not found.' }); return null; }
    const lv = app.locals.matterLevel ? app.locals.matterLevel(req, m) : 'full';
    if (!lv) { res.status(404).json({ error: 'Not found.' }); return null; }
    if (need && !app.locals.matterAtLeast(req, m, need)) { res.status(403).json({ error: 'You have view-only access to this case.' }); return null; }
    m.my_level = lv;
    if (!isClient(req.user)) m.client_phone = (db.prepare('SELECT phone FROM clients WHERE id=?').get(m.client_id) || {}).phone || '';
    return m;
  };

  app.get('/api/matters/:id', L.requireLogin, (req, res) => {
    const m = loadMatter(req, res); if (!m) return;
    const cli = isClient(req.user);
    m.hearings = db.prepare('SELECT * FROM hearings WHERE matter_id=? ORDER BY hearing_date DESC').all(m.id);
    m.documents = db.prepare(`SELECT id,name,size,created_at,client_visible,by_client FROM fs_nodes WHERE matter_id=? AND kind='file' AND deleted_at IS NULL ${cli ? 'AND client_visible=1' : ''} ORDER BY id DESC`).all(m.id);
    if (cli && db.prepare('SELECT share_blocked b FROM clients WHERE id=?').get(m.client_id).b) m.documents = m.documents.filter((d) => d.by_client);
    m.letters = db.prepare(`SELECT id,ref_no,subject,status,sent_at,read_at FROM letters WHERE matter_id=? ${cli ? "AND client_visible=1 AND status='sent'" : ''} ORDER BY id DESC`).all(m.id);
    if (!cli) {
      m.tasks = db.prepare(`SELECT t.id,t.title,t.status,t.due_date,u.name AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.matter_id=? ORDER BY t.id DESC`).all(m.id);
      m.notings = db.prepare(`SELECT n.*, u.name AS user_name FROM notings n LEFT JOIN users u ON u.id=n.user_id WHERE n.matter_id=? ORDER BY n.id DESC`).all(m.id);
    } else { delete m.summary; delete m.opposite_party; delete m.labels; }
    try { const e = db.prepare('SELECT snapshot FROM matter_ecourt WHERE matter_id=?').get(m.id); m.ident = e && e.snapshot ? require('./ecourts').identity(JSON.parse(e.snapshot)) : null; } catch (x) { m.ident = null; }
    m.invoices = (!cli && m.my_level !== 'full') ? [] : (cli ? db.prepare(`SELECT id,inv_no,inv_date,status,total_paise FROM invoices WHERE matter_id=? AND status NOT IN ('draft','cancelled')`) :
      db.prepare('SELECT id,inv_no,inv_date,status,total_paise FROM invoices WHERE matter_id=?')).all(m.id);
    res.json(m);
  });

  app.put('/api/matters/:id', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const m = loadMatter(req, res, 'full'); if (!m) return;
    const b = req.body;
    db.prepare(`UPDATE matters SET title=?,forum=?,case_no=?,opposite_party=?,stage=?,status=?,assigned_to=?,summary=?,client_visible_note=? WHERE id=?`).run(
      L.str(b.title || m.title, 250), L.str(b.forum ?? m.forum, 200), L.str(b.case_no ?? m.case_no, 100), L.str(b.opposite_party ?? m.opposite_party, 250),
      L.str(b.stage ?? m.stage, 100), ['open', 'closed', 'on_hold'].includes(b.status) ? b.status : m.status, L.int(b.assigned_to, m.assigned_to),
      L.str(b.summary ?? m.summary, 3000), L.str(b.client_visible_note ?? m.client_visible_note, 1500), m.id);
    audit(T(req), req.user.id, 'matter_updated', 'matter', m.id, null, L.ip(req));
    res.json({ ok: true });
  });

  app.post('/api/matters/:id/hearings', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const m = loadMatter(req, res, 'work'); if (!m) return;
    if (!L.must(res, L.isDate(req.body.hearing_date), 'Enter the hearing date.')) return;
    if (req.body.next_date && !L.must(res, L.isDate(req.body.next_date), 'Next date is not valid.')) return;
    db.prepare('INSERT INTO hearings(tenant_id,matter_id,hearing_date,purpose,outcome,next_date) VALUES (?,?,?,?,?,?)')
      .run(T(req), m.id, req.body.hearing_date, L.str(req.body.purpose, 250), L.str(req.body.outcome, 1000), req.body.next_date || null);
    res.json({ ok: true });
  });

  app.post('/api/matters/:id/notings', L.office, (req, res) => {
    const m = loadMatter(req, res, 'work'); if (!m) return;
    if (!L.must(res, L.str(req.body.note), 'Write the noting.')) return;
    db.prepare('INSERT INTO notings(tenant_id,matter_id,user_id,note) VALUES (?,?,?,?)').run(T(req), m.id, req.user.id, L.str(req.body.note, 2000));
    res.json({ ok: true });
  });

  // Cause list: all upcoming dates for the office
  app.get('/api/dates', L.office, (req, res) => {
    const days = L.int(req.query.days, 30);
    res.json(db.prepare(`SELECT h.next_date AS date, m.id AS matter_id, m.file_no, m.title, m.forum, c.name AS client_name
      FROM hearings h JOIN matters m ON m.id=h.matter_id AND m.status<>'deleted' JOIN clients c ON c.id=m.client_id
      WHERE h.tenant_id=? AND h.next_date>=date('now') AND h.next_date<=date('now','+'||?||' days') AND m.status='open'
      AND h.id=(SELECT id FROM hearings h2 WHERE h2.matter_id=h.matter_id ORDER BY hearing_date DESC, id DESC LIMIT 1)
      ORDER BY h.next_date`).all(T(req), days));
  });

  // ---------- Documents (matter screen) — stored in the client's folder tree: Matters / <file no.> ----------
  app.post('/api/documents', L.requireLogin, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a file.' });
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!L.ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'This file type is not allowed.' });
      const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.body.matter_id), T(req));
      if (!m) return res.status(404).json({ error: 'Matter not found.' });
      const h = app.locals.fsHelpers, cli = isClient(req.user);
      if (cli && m.client_id !== req.user.client_id) return res.status(403).json({ error: 'You can upload only to your own matters.' });
      const visible = cli || req.body.client_visible === '1' || req.body.client_visible === 'true';
      const parent = cli ? h.ensureInbox(T(req), m.client_id) : h.matterFolder(T(req), m, req.user.id, false);
      const r = await h.putFile(T(req), { clientId: m.client_id, parent, name: req.file.originalname, buffer: req.file.buffer, mime: req.file.mimetype,
        uid: cli ? null : req.user.id, byClient: cli, visible, matterId: m.id });
      if (visible && !cli) h.shareUp(db.prepare('SELECT * FROM fs_nodes WHERE id=?').get(r.id));
      audit(T(req), req.user.id, 'document_uploaded', 'fs', r.id, req.file.originalname, L.ip(req));
      res.json({ id: r.id });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Upload failed.' }); }
  });
  app.patch('/api/documents/:id', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const d = db.prepare('SELECT * FROM fs_nodes WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!d) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE fs_nodes SET client_visible=? WHERE id=?').run(req.body.client_visible ? 1 : 0, d.id);
    if (req.body.client_visible) app.locals.fsHelpers.shareUp(d);
    res.json({ ok: true });
  });
  app.delete('/api/documents/:id', L.need('admin'), (req, res) => {
    const d = db.prepare('SELECT * FROM fs_nodes WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!d) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE fs_nodes SET deleted_at=CURRENT_TIMESTAMP, deleted_by=?, del_root=id, dirty=1, sync_tries=0 WHERE id=?').run(req.user.id, d.id);
    audit(T(req), req.user.id, 'document_deleted', 'fs', d.id, d.name, L.ip(req));
    res.json({ ok: true });
  });

  // ---------- Tasks & assignments ----------
  app.get('/api/tasks', L.office, (req, res) => {
    const view = req.query.view; let where = 't.tenant_id=?'; const p = [T(req)];
    if (view === 'mine' || req.tasksMine) { where += ' AND t.assigned_to=?'; p.push(req.user.id); }
    else if (view === 'assigned') { where += ' AND t.assigned_by=?'; p.push(req.user.id); }
    else if (view === 'overdue') where += " AND t.status<>'done' AND t.due_date<date('now')";
    if (L.int(req.query.client_id)) { where += ' AND m.client_id=?'; p.push(L.int(req.query.client_id)); }
    res.json(db.prepare(`SELECT t.*, a.name AS assignee, b.name AS assigner, m.file_no FROM tasks t
      LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN users b ON b.id=t.assigned_by LEFT JOIN matters m ON m.id=t.matter_id
      WHERE ${where} ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date LIMIT 400`).all(...p));
  });

  app.post('/api/tasks', L.office, (req, res) => {
    const title = L.str(req.body.title, 250);
    if (!L.must(res, title, 'Describe the task.')) return;
    if (req.body.matter_id) { const mm = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.body.matter_id), T(req)); if (!mm || !app.locals.matterAtLeast(req, mm, 'work')) return res.status(403).json({ error: 'You do not have access to add work on that case.' }); }
    const assignee = L.int(req.body.assigned_to, req.user.id);
    if (!L.must(res, db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND role<>\'client\' AND active=1').get(assignee, T(req)), 'Choose who the task is for.')) return;
    if (req.body.due_date && !L.must(res, L.isDate(req.body.due_date), 'Due date is not valid.')) return;
    const r = db.prepare('INSERT INTO tasks(tenant_id,matter_id,title,details,assigned_to,assigned_by,due_date,priority) VALUES (?,?,?,?,?,?,?,?)')
      .run(T(req), L.int(req.body.matter_id), title, L.str(req.body.details, 2000), assignee, req.user.id, req.body.due_date || null,
        req.body.priority === 'high' ? 'high' : 'normal');
    audit(T(req), req.user.id, 'task_assigned', 'task', r.lastInsertRowid, title, L.ip(req));
    res.json({ id: r.lastInsertRowid });
  });

  app.patch('/api/tasks/:id', L.office, (req, res) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!t) return res.status(404).json({ error: 'Not found.' });
    const mine = t.assigned_to === req.user.id || t.assigned_by === req.user.id || ['admin', 'advocate'].includes(req.user.role);
    if (!mine) return res.status(403).json({ error: 'Only the assignee, the assigner or an advocate can change this task.' });
    const status = ['todo', 'doing', 'review', 'done'].includes(req.body.status) ? req.body.status : t.status;
    db.prepare("UPDATE tasks SET status=?, assigned_to=?, due_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(status, L.int(req.body.assigned_to, t.assigned_to), req.body.due_date || t.due_date, t.id);
    if (req.body.note) db.prepare('INSERT INTO task_notes(tenant_id,task_id,user_id,note) VALUES (?,?,?,?)').run(T(req), t.id, req.user.id, L.str(req.body.note, 1000));
    res.json({ ok: true });
  });

  app.get('/api/tasks/:id/notes', L.office, (req, res) => {
    res.json(db.prepare(`SELECT n.*, u.name AS user_name FROM task_notes n LEFT JOIN users u ON u.id=n.user_id
      WHERE n.task_id=? AND n.tenant_id=? ORDER BY n.id`).all(req.params.id, T(req)));
  });

  // ---------- eOffice: outward letters ----------
  app.get('/api/letters', L.requireLogin, (req, res) => {
    if (isClient(req.user)) {
      return res.json(db.prepare(`SELECT id,ref_no,subject,sent_at,read_at,matter_id FROM letters
        WHERE tenant_id=? AND client_id=? AND client_visible=1 AND status='sent' ORDER BY id DESC`).all(T(req), req.user.client_id));
    }
    const cid = L.int(req.query.client_id);
    res.json(db.prepare(`SELECT l.id,l.ref_no,l.to_name,l.subject,l.status,l.sent_at,l.read_at,l.created_at,m.file_no
      FROM letters l LEFT JOIN matters m ON m.id=l.matter_id WHERE l.tenant_id=? ${cid ? 'AND l.client_id=?' : ''} ORDER BY l.id DESC LIMIT 300`).all(...[T(req), ...(cid ? [cid] : [])]));
  });

  app.get('/api/letters/:id', L.requireLogin, (req, res) => {
    const l = db.prepare('SELECT * FROM letters WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    if (isClient(req.user)) {
      if (l.client_id !== req.user.client_id || !l.client_visible || l.status !== 'sent') return res.status(404).json({ error: 'Not found.' });
      if (!l.read_at) db.prepare('UPDATE letters SET read_at=? WHERE id=?').run(L.nowIso(), l.id);
      delete l.created_by; delete l.approved_by;
    }
    res.json(l);
  });

  app.post('/api/letters', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const to = L.str(req.body.to_name, 200), subject = L.str(req.body.subject, 250), body = L.str(req.body.body, 20000);
    if (!L.must(res, to && subject && body, 'To, subject and body are required.')) return;
    const matterId = L.int(req.body.matter_id);
    const m = matterId ? db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(matterId, T(req)) : null;
    const clientId = m ? m.client_id : L.int(req.body.client_id);
    const r = db.prepare('INSERT INTO letters(tenant_id,matter_id,client_id,to_name,subject,body,created_by,client_visible) VALUES (?,?,?,?,?,?,?,?)')
      .run(T(req), m ? m.id : null, clientId, to, subject, body, req.user.id, req.body.client_visible ? 1 : 0);
    res.json({ id: r.lastInsertRowid });
  });

  app.put('/api/letters/:id', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const l = db.prepare('SELECT * FROM letters WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, l.status === 'draft', 'Only a draft can be edited.')) return;
    db.prepare('UPDATE letters SET to_name=?,subject=?,body=?,client_visible=? WHERE id=?').run(
      L.str(req.body.to_name || l.to_name, 200), L.str(req.body.subject || l.subject, 250), L.str(req.body.body || l.body, 20000),
      req.body.client_visible ? 1 : 0, l.id);
    res.json({ ok: true });
  });

  // Approve + number + send (advocate/admin). Staff drafts wait for approval.
  app.post('/api/letters/:id/send', L.need('admin', 'advocate'), (req, res) => {
    const l = db.prepare('SELECT * FROM letters WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, l.status === 'draft', 'This letter has already been sent.')) return;
    const t = db.prepare('SELECT prefix FROM tenants WHERE id=?').get(T(req));
    const { n, year } = nextNumber(T(req), 'out');
    const ref = `${t.prefix}/OUT/${pad(n)}/${year}`;
    db.prepare("UPDATE letters SET ref_no=?, status='sent', approved_by=?, sent_at=? WHERE id=?").run(ref, req.user.id, L.nowIso(), l.id);
    audit(T(req), req.user.id, 'letter_sent', 'letter', l.id, ref, L.ip(req));
    res.json({ ref_no: ref });
  });

  app.delete('/api/letters/:id', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const l = db.prepare('SELECT * FROM letters WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l || l.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be deleted.' });
    db.prepare('DELETE FROM letters WHERE id=?').run(l.id);
    res.json({ ok: true });
  });

  // ---------- eOffice: inward register (dak) ----------
  app.get('/api/dak', L.office, (req, res) => {
    res.json(db.prepare(`SELECT d.*, u.name AS assignee, m.file_no FROM dak d LEFT JOIN users u ON u.id=d.assigned_to
      LEFT JOIN matters m ON m.id=d.matter_id WHERE d.tenant_id=? ORDER BY d.id DESC LIMIT 300`).all(T(req)));
  });
  app.post('/api/dak', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const from = L.str(req.body.from_name, 200), subject = L.str(req.body.subject, 250);
    if (!L.must(res, from && subject, 'From and subject are required.')) return;
    const t = db.prepare('SELECT prefix FROM tenants WHERE id=?').get(T(req));
    const { n, year } = nextNumber(T(req), 'in');
    const ref = `${t.prefix}/IN/${pad(n)}/${year}`;
    const on = L.isDate(req.body.received_on) ? req.body.received_on : new Date().toISOString().slice(0, 10);
    const r = db.prepare('INSERT INTO dak(tenant_id,ref_no,received_on,from_name,subject,matter_id,assigned_to) VALUES (?,?,?,?,?,?,?)')
      .run(T(req), ref, on, from, subject, L.int(req.body.matter_id), L.int(req.body.assigned_to));
    res.json({ id: r.lastInsertRowid, ref_no: ref });
  });
  app.patch('/api/dak/:id', L.office, (req, res) => {
    db.prepare('UPDATE dak SET status=?, assigned_to=COALESCE(?,assigned_to) WHERE id=? AND tenant_id=?')
      .run(['open', 'actioned'].includes(req.body.status) ? req.body.status : 'open', L.int(req.body.assigned_to), req.params.id, T(req));
    res.json({ ok: true });
  });

  // ---------- Messages (client <-> office, always attached to a matter or client) ----------
  app.get('/api/messages', L.requireLogin, (req, res) => {
    if (isClient(req.user)) {
      return res.json(db.prepare(`SELECT m.*, u.name AS from_name FROM messages m JOIN users u ON u.id=m.from_user
        WHERE m.tenant_id=? AND m.client_id=? ORDER BY m.id`).all(T(req), req.user.client_id));
    }
    const cid = L.int(req.query.client_id);
    if (!cid) return res.json(db.prepare(`SELECT c.id AS client_id, c.name, MAX(m.id) AS last_id,
      SUM(CASE WHEN u.role='client' AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unread
      FROM messages m JOIN clients c ON c.id=m.client_id JOIN users u ON u.id=m.from_user
      WHERE m.tenant_id=? GROUP BY c.id ORDER BY last_id DESC`).all(T(req)));
    db.prepare(`UPDATE messages SET read_at=? WHERE tenant_id=? AND client_id=? AND read_at IS NULL AND from_user IN (SELECT id FROM users WHERE role='client')`)
      .run(L.nowIso(), T(req), cid);
    res.json(db.prepare(`SELECT m.*, u.name AS from_name FROM messages m JOIN users u ON u.id=m.from_user
      WHERE m.tenant_id=? AND m.client_id=? ORDER BY m.id`).all(T(req), cid));
  });
  app.post('/api/messages', L.requireLogin, (req, res) => {
    const body = L.str(req.body.body, 3000);
    if (!L.must(res, body, 'Write a message.')) return;
    const cid = isClient(req.user) ? req.user.client_id : L.int(req.body.client_id);
    if (!L.must(res, cid && db.prepare('SELECT 1 FROM clients WHERE id=? AND tenant_id=?').get(cid, T(req)), 'Choose a client.')) return;
    db.prepare('INSERT INTO messages(tenant_id,client_id,matter_id,from_user,body) VALUES (?,?,?,?,?)').run(T(req), cid, L.int(req.body.matter_id), req.user.id, body);
    if (isClient(req.user)) {}
    else db.prepare(`UPDATE messages SET read_at=? WHERE tenant_id=? AND client_id=? AND read_at IS NULL AND from_user=?`).run(L.nowIso(), T(req), cid, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Dashboard & search ----------
  app.get('/api/dashboard', L.requireLogin, (req, res) => {
    const t = T(req);
    if (isClient(req.user)) {
      const cid = req.user.client_id;
      const one = (sql, ...a) => db.prepare(sql).get(...a);
      const billed = one("SELECT COALESCE(SUM(total_paise),0) v FROM invoices WHERE client_id=? AND status NOT IN ('draft','cancelled')", cid).v;
      const paid = one('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE client_id=?', cid).v;
      return res.json({
        matters: one("SELECT COUNT(*) v FROM matters WHERE client_id=? AND status='open'", cid).v,
        due_paise: Math.max(0, billed - paid),
        unread_letters: one("SELECT COUNT(*) v FROM letters WHERE client_id=? AND client_visible=1 AND status='sent' AND read_at IS NULL", cid).v,
        unread_messages: one(`SELECT COUNT(*) v FROM messages m JOIN users u ON u.id=m.from_user WHERE m.client_id=? AND u.role<>'client' AND m.read_at IS NULL`, cid).v,
        next_dates: db.prepare(`SELECT m.id AS matter_id, m.title, h.next_date AS date FROM hearings h JOIN matters m ON m.id=h.matter_id AND m.status<>'deleted'
          WHERE m.client_id=? AND h.next_date>=date('now') AND h.id=(SELECT id FROM hearings h2 WHERE h2.matter_id=h.matter_id ORDER BY hearing_date DESC,id DESC LIMIT 1)
          ORDER BY h.next_date LIMIT 5`).all(cid),
        appointments: db.prepare(`SELECT id,start_at,status,meet_link FROM appointments WHERE client_id=? AND start_at>=? AND status IN ('confirmed','awaiting_payment') ORDER BY start_at LIMIT 5`).all(cid, L.nowIso()),
      });
    }
    const c = (sql, ...a) => db.prepare(sql).get(t, ...a).v;
    res.json({
      open_matters: (() => { const f = app.locals.teamSql(req); return db.prepare("SELECT COUNT(*) v FROM matters m WHERE m.tenant_id=? AND m.status='open'" + f.sql).get(t, ...f.args).v; })(),
      clients: c('SELECT COUNT(*) v FROM clients WHERE tenant_id=?'),
      my_tasks: c("SELECT COUNT(*) v FROM tasks WHERE tenant_id=? AND assigned_to=? AND status<>'done'", req.user.id),
      overdue_tasks: req.user.role === 'admin' ? c("SELECT COUNT(*) v FROM tasks WHERE tenant_id=? AND status<>'done' AND due_date<date('now')") : c("SELECT COUNT(*) v FROM tasks WHERE tenant_id=? AND status<>'done' AND due_date<date('now') AND assigned_to=?", req.user.id),
      new_leads: c("SELECT COUNT(*) v FROM leads WHERE tenant_id=? AND stage='new'"),
      appointments_today: c("SELECT COUNT(*) v FROM appointments WHERE tenant_id=? AND date(start_at,'+5 hours','+30 minutes')=date('now','+5 hours','+30 minutes') AND status='confirmed'"),
      unread_messages: c("SELECT COUNT(*) v FROM messages m JOIN users u ON u.id=m.from_user WHERE m.tenant_id=? AND u.role='client' AND m.read_at IS NULL"),
      drafts_to_approve: c("SELECT COUNT(*) v FROM letters WHERE tenant_id=? AND status='draft'"),
      dates: (() => { const f = app.locals.teamSql(req); return db.prepare(`SELECT h.next_date AS date, m.id AS matter_id, m.file_no, m.title, m.forum FROM hearings h JOIN matters m ON m.id=h.matter_id AND m.status<>'deleted'
        WHERE h.tenant_id=? AND m.status='open' AND h.next_date>=date('now') AND h.next_date<=date('now','+7 days')${f.sql}
        AND h.id=(SELECT id FROM hearings h2 WHERE h2.matter_id=h.matter_id ORDER BY hearing_date DESC,id DESC LIMIT 1) ORDER BY h.next_date LIMIT 15`).all(t, ...f.args); })(),
    });
  });

  app.get('/api/search', L.office, (req, res) => {
    const q = '%' + L.str(req.query.q, 80) + '%';
    if (q.length < 4) return res.json({ matters: [], clients: [] });
    res.json({
      matters: db.prepare('SELECT m.id,m.file_no,m.title,c.name AS client_name FROM matters m JOIN clients c ON c.id=m.client_id WHERE m.status<>\'deleted\' AND m.tenant_id=? AND (m.title LIKE ? OR m.file_no LIKE ? OR m.case_no LIKE ?)' + app.locals.teamSql(req).sql + ' LIMIT 10').all(T(req), q, q, q, ...app.locals.teamSql(req).args),
      clients: db.prepare('SELECT id,name,phone FROM clients c WHERE tenant_id=? AND (name LIKE ? OR phone LIKE ?)' + (app.locals.clientRestricted(req) ? ' AND c.id IN (SELECT m.client_id FROM matters m WHERE 1=1' + app.locals.teamSql(req).sql + ')' : '') + ' LIMIT 10').all(T(req), q, q, ...(app.locals.clientRestricted(req) ? app.locals.teamSql(req).args : [])),
    });
  });
};
