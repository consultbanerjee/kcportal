'use strict';
// PRACTICE TOOLS (v6.0). Written once for every firm.
//  - Time & billing: hourly entries per case, a running timer, rates, and billing of unbilled time into a draft invoice.
//  - Conflict check: before taking a client or a case, look for the same name as a client, lead, opposite party, case title or register party.
//  - Search: one box that finds clients, cases, papers, invoices, tasks and leads (each person only sees what they may open).
//  - Pipeline: open cases laid out as a board by stage.
//  - Firm data export: the whole firm's records as one Excel workbook (the firm's own way out; the data belongs to the firm).
//  - Plan limits: the portal owner can cap the number of users and clients for a firm.
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore');
const X = require('./xlsxw');

db.exec(`CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, matter_id INTEGER, client_id INTEGER,
  work_date TEXT NOT NULL, minutes INTEGER NOT NULL, narration TEXT, rate_paise INTEGER NOT NULL DEFAULT 0, billable INTEGER NOT NULL DEFAULT 1, invoice_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT);
  CREATE INDEX IF NOT EXISTS ix_time_t ON time_entries(tenant_id, work_date);
  CREATE INDEX IF NOT EXISTS ix_time_m ON time_entries(matter_id);
  CREATE TABLE IF NOT EXISTS time_timers (user_id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER, narration TEXT, started_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conflict_checks (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER, query TEXT, hits INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);

const T = (req) => req.user.tenant_id;
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const PRO = L.need('admin', 'advocate', 'staff');
const BILLERS = L.need('admin', 'advocate', 'accounts');
const likeOf = (q) => '%' + String(q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const valueOf = (min, rate) => Math.round((min * rate) / 60);

// hourly rate in paise: the user's own rate, else the firm's default (0 = not set)
const rateOf = (t, uid) => L.int(AI.getS(t, 'time_rate_u' + uid, ''), null) || L.int(AI.getS(t, 'time_rate', '0'), 0) || 0;
const roundTo = (t) => Math.max(1, Math.min(60, L.int(AI.getS(t, 'time_round', '1'), 1)));

// ---- names for conflict matching: lower case, no titles or punctuation ----
const TITLES = /\b(mr|mrs|ms|miss|smt|shri|sri|sh|late|m\/s|messrs|dr|the|and|vs|versus|ors|anr|another|others)\b\.?/g;
const norm = (s) => String(s || '').toLowerCase().replace(TITLES, ' ').replace(/[^a-z0-9ऀ-ॿঀ-৿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter((w) => w.length >= 3 || /^\d+$/.test(w));
const nameHit = (q, target) => { const w = words(q); if (!w.length) return false; const t = ' ' + norm(target) + ' '; return w.every((x) => t.includes(x)); };
const last10 = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

module.exports = (app) => {
  // ============ plan limits (the portal owner sets them per firm; 0 = no limit) ============
  const limits = (t) => ({ max_users: L.int(AI.getS(t, 'sa_max_users', '0'), 0) || 0, max_clients: L.int(AI.getS(t, 'sa_max_clients', '0'), 0) || 0 });
  const used = (t) => ({
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role<>'client' AND active=1").get(t).n,
    clients: db.prepare('SELECT COUNT(*) n FROM clients WHERE tenant_id=?').get(t).n,
  });
  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST' || !req.user || !req.user.tenant_id || req.user.role === 'superadmin') return next();
    const t = req.user.tenant_id, lim = limits(t);
    if (req.path === '/users' && lim.max_users > 0 && used(t).users >= lim.max_users)
      return res.status(403).json({ error: `Your plan allows ${lim.max_users} users. Please ask the portal provider to raise the limit.` });
    if (req.path === '/clients' && lim.max_clients > 0 && used(t).clients >= lim.max_clients)
      return res.status(403).json({ error: `Your plan allows ${lim.max_clients} clients. Please ask the portal provider to raise the limit.` });
    next();
  });
  app.get('/api/my-limits', L.need('admin'), (req, res) => { const t = T(req); res.json({ ...limits(t), used: used(t) }); });

  // ============ time & billing ============
  const entryRow = (e) => ({ id: e.id, date: e.work_date, minutes: e.minutes, hours: hm(e.minutes), narration: e.narration, rate_paise: e.rate_paise, billable: !!e.billable,
    amount_paise: e.billable ? valueOf(e.minutes, e.rate_paise) : 0, matter_id: e.matter_id, file_no: e.file_no || null, matter: e.mtitle || null, client: e.cname || null,
    user_id: e.user_id, user: e.uname, invoice_id: e.invoice_id, invoice_no: e.inv_no || null });
  const SEL = `SELECT e.*, m.file_no, m.title mtitle, c.name cname, u.name uname, i.inv_no FROM time_entries e LEFT JOIN matters m ON m.id=e.matter_id LEFT JOIN clients c ON c.id=e.client_id
    JOIN users u ON u.id=e.user_id LEFT JOIN invoices i ON i.id=e.invoice_id WHERE e.tenant_id=? AND e.deleted_at IS NULL`;
  const matterFor = (req, res, id, need = 'work') => {
    if (!L.int(id)) return { m: null };
    const m = db.prepare("SELECT * FROM matters WHERE id=? AND tenant_id=? AND status<>'deleted'").get(L.int(id), T(req));
    if (!m || !app.locals.matterAtLeast(req, m, need)) { res.status(403).json({ error: 'You cannot record time on this case.' }); return null; }
    return { m };
  };
  const minutesIn = (b) => { let m = L.int(b.minutes); if (!(m > 0) && Number(b.hours) > 0) m = Math.round(Number(b.hours) * 60); return m; };

  app.get('/api/time', PRO, (req, res) => {
    const t = T(req), adm = req.user.role === 'admin', q = req.query || {}; let sql = SEL; const a = [t];
    if (!adm) { sql += ' AND e.user_id=?'; a.push(req.user.id); } else if (L.int(q.user_id)) { sql += ' AND e.user_id=?'; a.push(L.int(q.user_id)); }
    if (L.isDate(q.from)) { sql += ' AND e.work_date>=?'; a.push(q.from); }
    if (L.isDate(q.to)) { sql += ' AND e.work_date<=?'; a.push(q.to); }
    if (L.int(q.matter_id)) { sql += ' AND e.matter_id=?'; a.push(L.int(q.matter_id)); }
    if (q.billed === 'unbilled') sql += ' AND e.invoice_id IS NULL AND e.billable=1'; else if (q.billed === 'billed') sql += ' AND e.invoice_id IS NOT NULL';
    const rows = db.prepare(sql + ' ORDER BY e.work_date DESC, e.id DESC LIMIT 500').all(...a).map(entryRow);
    const tot = { minutes: 0, billable_minutes: 0, value_paise: 0, unbilled_paise: 0 };
    for (const r of rows) { tot.minutes += r.minutes; if (r.billable) { tot.billable_minutes += r.minutes; tot.value_paise += r.amount_paise; if (!r.invoice_id) tot.unbilled_paise += r.amount_paise; } }
    res.json({ entries: rows, totals: tot, hours: hm(tot.minutes), is_admin: adm, default_rate_paise: rateOf(t, req.user.id), round: roundTo(t),
      users: adm ? db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND role IN ('admin','advocate','staff') AND active=1 ORDER BY name").all(t) : [] });
  });
  app.post('/api/time', PRO, (req, res) => {
    const t = T(req), b = req.body || {}, minutes = minutesIn(b);
    if (!L.must(res, minutes > 0 && minutes <= 1440, 'Enter the time spent (up to 24 hours).')) return;
    if (!L.must(res, L.str(b.narration, 500), 'Write what the work was.')) return;
    const mm = matterFor(req, res, b.matter_id); if (!mm) return;
    let uid = req.user.id; if (req.user.role === 'admin' && L.int(b.user_id)) { const u = db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND role IN ('admin','advocate','staff')").get(L.int(b.user_id), t); if (u) uid = u.id; }
    const rate = b.rate !== undefined && b.rate !== null && b.rate !== '' ? L.paise(b.rate) : rateOf(t, uid);
    if (!L.must(res, rate >= 0 && rate < 1e9, 'Enter a valid hourly rate.')) return;
    const r = db.prepare('INSERT INTO time_entries(tenant_id,user_id,matter_id,client_id,work_date,minutes,narration,rate_paise,billable) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(t, uid, mm.m ? mm.m.id : null, mm.m ? mm.m.client_id : null, L.isDate(b.work_date) ? b.work_date : today(), minutes, L.str(b.narration, 500), rate, b.billable === false || b.billable === 0 ? 0 : 1);
    D.audit(t, req.user.id, 'time_added', 'time', r.lastInsertRowid, hm(minutes), L.ip(req)); res.json({ ok: true, id: r.lastInsertRowid });
  });
  const mine = (req, res) => {
    const e = db.prepare('SELECT * FROM time_entries WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(L.int(req.params.id), T(req));
    if (!e || (req.user.role !== 'admin' && e.user_id !== req.user.id)) { res.status(404).json({ error: 'Not found.' }); return null; }
    if (e.invoice_id) { res.status(400).json({ error: 'This time is already on an invoice and cannot be changed.' }); return null; }
    return e;
  };
  app.put('/api/time/:id', PRO, (req, res, next) => {
    if (req.params.id === 'settings') return next();      // the rates page has its own route further down
    const e = mine(req, res); if (!e) return; const b = req.body || {};
    let minutes = e.minutes; if (b.minutes !== undefined || b.hours !== undefined) { minutes = minutesIn(b); if (!L.must(res, minutes > 0 && minutes <= 1440, 'Enter the time spent (up to 24 hours).')) return; }
    let mid = e.matter_id, cid = e.client_id; if (b.matter_id !== undefined) { const mm = matterFor(req, res, b.matter_id); if (!mm) return; mid = mm.m ? mm.m.id : null; cid = mm.m ? mm.m.client_id : null; }
    const rate = b.rate !== undefined && b.rate !== '' ? L.paise(b.rate) : e.rate_paise; if (!L.must(res, rate >= 0 && rate < 1e9, 'Enter a valid hourly rate.')) return;
    db.prepare('UPDATE time_entries SET matter_id=?, client_id=?, work_date=?, minutes=?, narration=?, rate_paise=?, billable=? WHERE id=?')
      .run(mid, cid, L.isDate(b.work_date) ? b.work_date : e.work_date, minutes, b.narration !== undefined ? L.str(b.narration, 500) : e.narration, rate, b.billable === undefined ? e.billable : (b.billable ? 1 : 0), e.id);
    res.json({ ok: true });
  });
  app.delete('/api/time/:id', PRO, (req, res) => { const e = mine(req, res); if (!e) return; db.prepare('UPDATE time_entries SET deleted_at=? WHERE id=?').run(L.nowIso(), e.id); res.json({ ok: true }); });

  // the running timer (one per person; it keeps running if the page is closed)
  const timerOf = (req) => db.prepare('SELECT tm.*, m.file_no, m.title FROM time_timers tm LEFT JOIN matters m ON m.id=tm.matter_id WHERE tm.user_id=?').get(req.user.id);
  const timerShape = (r) => (r ? { matter_id: r.matter_id, file_no: r.file_no || null, title: r.title || null, narration: r.narration, started_at: r.started_at, elapsed_min: Math.max(0, Math.floor((Date.now() - Date.parse(r.started_at)) / 60000)) } : null);
  app.get('/api/time/timer', PRO, (req, res) => res.json({ running: timerShape(timerOf(req)) }));
  app.post('/api/time/timer/start', PRO, (req, res) => {
    if (!L.must(res, !timerOf(req), 'A timer is already running. Stop it first.')) return; const b = req.body || {}, mm = matterFor(req, res, b.matter_id); if (!mm) return;
    db.prepare('INSERT INTO time_timers(user_id,tenant_id,matter_id,narration,started_at) VALUES (?,?,?,?,?)').run(req.user.id, T(req), mm.m ? mm.m.id : null, L.str(b.narration, 500), L.nowIso());
    res.json({ ok: true, running: timerShape(timerOf(req)) });
  });
  app.post('/api/time/timer/stop', PRO, (req, res) => {
    const r = timerOf(req); if (!L.must(res, r, 'No timer is running.')) return; const t = T(req), step = roundTo(t);
    const raw = Math.max(1, Math.ceil((Date.now() - Date.parse(r.started_at)) / 60000)), minutes = Math.min(1440, Math.ceil(raw / step) * step);
    const m = r.matter_id ? db.prepare('SELECT client_id FROM matters WHERE id=?').get(r.matter_id) : null, note = L.str((req.body || {}).narration, 500) || r.narration || 'Work on the case';
    const id = db.prepare('INSERT INTO time_entries(tenant_id,user_id,matter_id,client_id,work_date,minutes,narration,rate_paise,billable) VALUES (?,?,?,?,?,?,?,?,1)')
      .run(t, req.user.id, r.matter_id, m ? m.client_id : null, today(), minutes, note, rateOf(t, req.user.id)).lastInsertRowid;
    db.prepare('DELETE FROM time_timers WHERE user_id=?').run(req.user.id); res.json({ ok: true, id, minutes });
  });
  app.post('/api/time/timer/discard', PRO, (req, res) => { db.prepare('DELETE FROM time_timers WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });

  // turn unbilled time into one draft invoice (all lines must belong to the same client)
  app.post('/api/time/bill', BILLERS, (req, res) => {
    const t = T(req), ids = [...new Set((Array.isArray((req.body || {}).entry_ids) ? req.body.entry_ids : []).map((x) => L.int(x)).filter(Boolean))];
    if (!L.must(res, ids.length && ids.length <= 200, 'Choose the time entries to bill.')) return;
    const rows = ids.map((id) => db.prepare('SELECT * FROM time_entries WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(id, t));
    if (!L.must(res, rows.every((e) => e && e.billable && !e.invoice_id), 'Some entries are not billable or are already billed.')) return;
    if (!L.must(res, rows.every((e) => e.client_id && e.client_id === rows[0].client_id), 'All entries must belong to one client. Choose one client at a time.')) return;
    if (!L.must(res, rows.every((e) => e.rate_paise > 0), 'Set an hourly rate on every entry before billing.')) return;
    for (const e of rows) if (e.matter_id) { const m = db.prepare('SELECT * FROM matters WHERE id=?').get(e.matter_id); if (m && !app.locals.matterAtLeast(req, m, 'work')) return res.status(403).json({ error: 'You cannot bill time on a case you have no access to.' }); }
    const mids = [...new Set(rows.map((e) => e.matter_id))], B = require('./business');
    const out = B.createInvoice(t, req.user.id, L.ip(req), { client_id: rows[0].client_id, matter_id: mids.length === 1 ? mids[0] : null, subject: 'Professional fees (time)',
      notes: L.str((req.body || {}).notes, 800), items: rows.map((e) => ({ description: `${e.work_date} — ${e.narration || 'Professional work'} (${hm(e.minutes)} h)`, qty: +(e.minutes / 60).toFixed(4), rate_paise: e.rate_paise })) });
    if (!L.must(res, out, 'Could not make the invoice.')) return;
    const up = db.prepare('UPDATE time_entries SET invoice_id=? WHERE id=?'); db.transaction(() => rows.forEach((e) => up.run(out.id, e.id)))();
    res.json({ ok: true, invoice_id: out.id, inv_no: out.inv_no, total_paise: out.total_paise });
  });

  app.get('/api/time/report', L.need('admin', 'advocate'), (req, res) => {
    const t = T(req), q = req.query || {}, adm = req.user.role === 'admin'; let sql = 'SELECT e.*, m.file_no, m.title mtitle, u.name uname FROM time_entries e LEFT JOIN matters m ON m.id=e.matter_id JOIN users u ON u.id=e.user_id WHERE e.tenant_id=? AND e.deleted_at IS NULL'; const a = [t];
    if (!adm) { sql += ' AND e.user_id=?'; a.push(req.user.id); }
    if (L.isDate(q.from)) { sql += ' AND e.work_date>=?'; a.push(q.from); } if (L.isDate(q.to)) { sql += ' AND e.work_date<=?'; a.push(q.to); }
    const by = (key, label) => { const o = {}; for (const e of db.prepare(sql).all(...a)) { const k = key(e), r = o[k] || (o[k] = { name: label(e), minutes: 0, billable_minutes: 0, value_paise: 0, unbilled_paise: 0 });
      r.minutes += e.minutes; if (e.billable) { const v = valueOf(e.minutes, e.rate_paise); r.billable_minutes += e.minutes; r.value_paise += v; if (!e.invoice_id) r.unbilled_paise += v; } } return Object.values(o).sort((x, y) => y.value_paise - x.value_paise); };
    res.json({ by_user: by((e) => 'u' + e.user_id, (e) => e.uname), by_case: by((e) => 'm' + (e.matter_id || 0), (e) => (e.file_no ? `${e.file_no} — ${e.mtitle}` : 'No case')) });
  });
  app.get('/api/time/settings', L.need('admin'), (req, res) => {
    const t = T(req); res.json({ rate_paise: L.int(AI.getS(t, 'time_rate', '0'), 0) || 0, round: roundTo(t),
      users: db.prepare("SELECT id,name,role FROM users WHERE tenant_id=? AND role IN ('admin','advocate','staff') AND active=1 ORDER BY name").all(t).map((u) => ({ ...u, rate_paise: L.int(AI.getS(t, 'time_rate_u' + u.id, ''), null) || 0 })) });
  });
  app.put('/api/time/settings', L.need('admin'), (req, res) => {
    const t = T(req), b = req.body || {};
    if (b.rate !== undefined) { const p = L.paise(b.rate || 0); if (!L.must(res, p >= 0 && p < 1e9, 'Enter a valid default rate.')) return; AI.setS(t, 'time_rate', String(p)); }
    if (b.round !== undefined) AI.setS(t, 'time_round', String(Math.max(1, Math.min(60, L.int(b.round, 1)))));
    for (const u of Array.isArray(b.users) ? b.users : []) { const id = L.int(u.id); if (!id || !db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=?').get(id, t)) continue; const p = L.paise(u.rate || 0); if (p >= 0 && p < 1e9) AI.setS(t, 'time_rate_u' + id, String(p)); }
    res.json({ ok: true });
  });

  // ============ conflict check ============
  app.get('/api/conflicts', L.need('admin', 'advocate', 'staff', 'telecaller'), (req, res) => {
    const t = T(req), q = L.str((req.query || {}).q, 120), ph = last10((req.query || {}).phone), em = L.str((req.query || {}).email, 120).toLowerCase();
    if (!L.must(res, norm(q).length >= 3 || ph || em, 'Type at least 3 letters of a name, or a phone number or email.')) return;
    const hits = [], add = (h) => hits.push(h), full = (lv) => !!lv;
    for (const c of db.prepare('SELECT * FROM clients WHERE tenant_id=?').all(t)) {
      const why = nameHit(q, c.name) ? 'same name' : ph && last10(c.phone) === ph ? 'same phone number' : em && c.email && c.email.toLowerCase() === em ? 'same email' : null; if (!why) continue;
      const see = full(app.locals.clientLevel(req, c.id)); add({ type: 'client', severity: 'info', title: see ? c.name : 'A client of the firm', detail: `Existing client (${why})` + (see ? '' : ' — details hidden') });
    }
    for (const l of db.prepare('SELECT * FROM leads WHERE tenant_id=?').all(t)) {
      const why = nameHit(q, l.name) ? 'same name' : ph && last10(l.phone) === ph ? 'same phone number' : em && l.email && l.email.toLowerCase() === em ? 'same email' : null; if (!why) continue;
      add({ type: 'lead', severity: 'info', title: l.name, detail: `Lead, stage ${l.stage} (${why})`, link: '#/lead/' + l.id });
    }
    for (const m of db.prepare("SELECT m.*, c.name cname FROM matters m JOIN clients c ON c.id=m.client_id WHERE m.tenant_id=? AND m.status<>'deleted'").all(t)) {
      const opp = m.opposite_party && nameHit(q, m.opposite_party), ttl = nameHit(q, m.title); if (!opp && !ttl) continue; const see = full(app.locals.matterLevel(req, m));
      if (opp) add({ type: 'opposite', severity: 'conflict', title: see ? `${m.file_no} — ${m.title}` : 'A case of the firm', detail: see ? `Named as the OPPOSITE PARTY in a case for ${m.cname}. Acting for this person may be a conflict.` : 'Named as the opposite party in a case you are not on. Ask the Admin.', link: see ? '#/matter/' + m.id : null });
      else add({ type: 'case-title', severity: 'info', title: see ? `${m.file_no} — ${m.title}` : 'A case of the firm', detail: see ? `Name appears in the case title (client ${m.cname})` : 'Name appears in a case you are not on', link: see ? '#/matter/' + m.id : null });
    }
    if (req.user.role !== 'telecaller') for (const r of db.prepare('SELECT id,kind,no,party,subject FROM register WHERE tenant_id=?').all(t)) if (r.party && nameHit(q, r.party)) add({ type: 'register', severity: 'info', title: `${r.kind === 'in' ? 'Inward' : 'Outward'} ${r.no}`, detail: `Party in the register: ${r.party}${r.subject ? ' — ' + r.subject : ''}`, link: '#/register' });
    db.prepare('INSERT INTO conflict_checks(tenant_id,user_id,query,hits) VALUES (?,?,?,?)').run(t, req.user.id, [q, ph, em].filter(Boolean).join(' | ').slice(0, 200), hits.length);
    res.json({ query: q, clear: !hits.length, conflicts: hits.filter((h) => h.severity === 'conflict').length, hits: hits.slice(0, 60) });
  });
  app.get('/api/conflicts/history', L.need('admin'), (req, res) => res.json(db.prepare('SELECT c.id,c.query,c.hits,c.created_at,u.name FROM conflict_checks c LEFT JOIN users u ON u.id=c.user_id WHERE c.tenant_id=? ORDER BY c.id DESC LIMIT 50').all(T(req))));

  // ============ search ============
  app.get('/api/gsearch', L.requireLogin, (req, res) => {
    const u = req.user, t = u.tenant_id, q = L.str((req.query || {}).q, 80), groups = [];
    if (q.length < 2 || !t) return res.json({ q, groups });
    const lk = likeOf(q), push = (key, label, items) => { if (items.length) groups.push({ key, label, items }); };
    if (u.role === 'client') {
      push('matters', 'My cases', db.prepare("SELECT id,file_no,title,forum FROM matters WHERE tenant_id=? AND client_id=? AND status<>'deleted' AND (file_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR case_no LIKE ? ESCAPE '\\') LIMIT 8").all(t, u.client_id, lk, lk, lk)
        .map((m) => ({ title: `${m.file_no} — ${m.title}`, sub: m.forum, link: '#/matter/' + m.id })));
      push('documents', 'My files', db.prepare("SELECT id,name,category FROM documents WHERE tenant_id=? AND client_id=? AND client_visible=1 AND name LIKE ? ESCAPE '\\' LIMIT 8").all(t, u.client_id, lk).map((d) => ({ title: d.name, sub: d.category, link: '#/myfiles' })));
      push('invoices', 'Fees', db.prepare("SELECT id,inv_no,status FROM invoices WHERE tenant_id=? AND client_id=? AND status NOT IN ('draft','cancelled') AND inv_no LIKE ? ESCAPE '\\' LIMIT 8").all(t, u.client_id, lk).map((i) => ({ title: i.inv_no, sub: i.status, link: '#/invoice/' + i.id })));
      return res.json({ q, groups });
    }
    if (!['admin', 'advocate', 'staff', 'accounts', 'telecaller'].includes(u.role)) return res.json({ q, groups });
    const off = require('./team').offList(t, u.role), on = (k) => !off.includes(k);
    const sees = (id) => !!app.locals.clientLevel(req, id);
    const f = app.locals.teamSql(req);
    push('matters', 'Cases', db.prepare(`SELECT m.id,m.file_no,m.title,m.case_no,m.opposite_party,c.name cname FROM matters m JOIN clients c ON c.id=m.client_id WHERE m.tenant_id=? AND m.status<>'deleted'
      AND (m.file_no LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\' OR m.case_no LIKE ? ESCAPE '\\' OR m.opposite_party LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')${f.sql} ORDER BY m.id DESC LIMIT 8`).all(t, lk, lk, lk, lk, lk, ...f.args)
      .map((m) => ({ title: `${m.file_no} — ${m.title}`, sub: [m.cname, m.case_no, m.opposite_party && 'vs ' + m.opposite_party].filter(Boolean).join(' · '), link: '#/matter/' + m.id })));
    if (u.role !== 'telecaller' && u.role !== 'accounts' || on('clients')) push('clients', 'Clients', db.prepare("SELECT id,name,email,phone FROM clients WHERE tenant_id=? AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') ORDER BY name LIMIT 30").all(t, lk, lk, lk)
      .filter((c) => sees(c.id)).slice(0, 8).map((c) => ({ title: c.name, sub: [c.phone, c.email].filter(Boolean).join(' · '), link: '#/clients?q=' + encodeURIComponent(c.name) })));
    if (['admin', 'advocate', 'staff'].includes(u.role) && on('files')) push('documents', 'Papers', db.prepare("SELECT d.id,d.name,d.category,d.matter_id,d.client_id,m.file_no FROM documents d LEFT JOIN matters m ON m.id=d.matter_id WHERE d.tenant_id=? AND d.name LIKE ? ESCAPE '\\' ORDER BY d.id DESC LIMIT 40").all(t, lk)
      .filter((d) => (d.matter_id ? app.locals.matterLevel(req, db.prepare('SELECT * FROM matters WHERE id=?').get(d.matter_id)) : d.client_id ? sees(d.client_id) : u.role === 'admin'))
      .slice(0, 8).map((d) => ({ title: d.name, sub: [d.file_no, d.category].filter(Boolean).join(' · '), link: d.matter_id ? '#/matter/' + d.matter_id : '#/files' })));
    if (['admin', 'advocate', 'accounts'].includes(u.role) && on('accounts')) push('invoices', 'Invoices', db.prepare("SELECT i.id,i.inv_no,i.status,i.client_id,c.name cname FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.tenant_id=? AND (i.inv_no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY i.id DESC LIMIT 30").all(t, lk, lk)
      .filter((i) => sees(i.client_id)).slice(0, 8).map((i) => ({ title: i.inv_no, sub: `${i.cname} · ${i.status}`, link: '#/invoice/' + i.id })));
    push('tasks', 'Tasks', db.prepare(`SELECT id,title,status,due_date FROM tasks WHERE tenant_id=? AND title LIKE ? ESCAPE '\\'${u.role === 'admin' ? '' : ' AND (assigned_to=? OR assigned_by=?)'} ORDER BY id DESC LIMIT 8`).all(...[t, lk].concat(u.role === 'admin' ? [] : [u.id, u.id]))
      .map((x) => ({ title: x.title, sub: `${x.status}${x.due_date ? ' · due ' + x.due_date : ''}`, link: '#/tasks?view=all' })));
    if (on('crm') && ['admin', 'advocate', 'staff', 'telecaller'].includes(u.role)) push('leads', 'Leads', db.prepare("SELECT id,name,phone,stage FROM leads WHERE tenant_id=? AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 8").all(t, lk, lk, lk)
      .map((l) => ({ title: l.name, sub: [l.phone, l.stage].filter(Boolean).join(' · '), link: '#/lead/' + l.id })));
    res.json({ q, groups });
  });

  // ============ case pipeline (board by stage) ============
  app.get('/api/pipeline', PRO, (req, res) => {
    const t = T(req), f = app.locals.teamSql(req), Dy = require('./diary'), STAGES = Dy.STAGES, mine = (req.query || {}).who === 'me', day = today();
    const cols = [{ key: -1, name: 'New' }, ...STAGES.map((s, i) => ({ key: i, name: s }))].map((c) => ({ ...c, cards: [] }));
    const rows = db.prepare(`SELECT m.id,m.file_no,m.title,m.forum,m.assigned_to,c.name cname,u.name aname FROM matters m JOIN clients c ON c.id=m.client_id LEFT JOIN users u ON u.id=m.assigned_to
      WHERE m.tenant_id=? AND m.status='open'${mine ? ' AND m.assigned_to=?' : ''}${f.sql} ORDER BY m.id DESC LIMIT 400`).all(...[t].concat(mine ? [req.user.id] : [], f.args));
    for (const m of rows) {
      const st = Math.max(-1, Math.min(STAGES.length - 1, Dy.stageOf(m.id))), nh = db.prepare('SELECT MIN(hearing_date) d FROM hearings WHERE matter_id=? AND hearing_date>=?').get(m.id, day).d;
      const open = db.prepare("SELECT COUNT(*) n FROM tasks WHERE matter_id=? AND status<>'done'").get(m.id).n;
      cols[st + 1].cards.push({ id: m.id, file_no: m.file_no, title: m.title, forum: m.forum, client: m.cname, advocate: m.aname, next_hearing: nh, open_tasks: open });
    }
    for (const c of cols) c.cards.sort((a, b) => (a.next_hearing || '9') < (b.next_hearing || '9') ? -1 : 1);
    res.json({ columns: cols, total: rows.length });
  });

  // ============ firm data export (one Excel workbook) ============
  app.get('/api/export/firm', L.need('admin'), async (req, res) => {
    const t = T(req), firm = db.prepare('SELECT name,slug FROM tenants WHERE id=?').get(t), H = (a) => a.map((v) => ({ v, b: true })), R = (p) => (p == null ? '' : { v: (p || 0) / 100 });
    const sheets = [], S = (name, head, sql, map, ...a) => { const rows = db.prepare(sql).all(...a).map(map); sheets.push({ name, rows: [H(head), ...rows] }); return rows.length; };
    const n = {};
    n.Clients = S('Clients', ['ID', 'Name', 'Email', 'Phone', 'Address', 'Notes', 'Added'], 'SELECT * FROM clients WHERE tenant_id=? ORDER BY id', (c) => [c.id, c.name, c.email, c.phone, c.address, c.notes, c.created_at], t);
    n.Cases = S('Cases', ['ID', 'File no', 'Title', 'Client', 'Forum', 'Case no', 'Opposite party', 'Stage', 'Status', 'Advocate', 'Summary', 'Opened'],
      "SELECT m.*, c.name cname, u.name aname FROM matters m JOIN clients c ON c.id=m.client_id LEFT JOIN users u ON u.id=m.assigned_to WHERE m.tenant_id=? AND m.status<>'deleted' ORDER BY m.id", (m) => [m.id, m.file_no, m.title, m.cname, m.forum, m.case_no, m.opposite_party, m.stage, m.status, m.aname, m.summary, m.created_at], t);
    n.Hearings = S('Hearings', ['Case', 'Date', 'Purpose', 'Outcome', 'Next date'], 'SELECT h.*, m.file_no FROM hearings h JOIN matters m ON m.id=h.matter_id WHERE h.tenant_id=? ORDER BY h.hearing_date', (h) => [h.file_no, h.hearing_date, h.purpose, h.outcome, h.next_date], t);
    n.Tasks = S('Tasks', ['Task', 'Case', 'Assigned to', 'Due', 'Priority', 'Status'], 'SELECT k.*, m.file_no, u.name uname FROM tasks k LEFT JOIN matters m ON m.id=k.matter_id LEFT JOIN users u ON u.id=k.assigned_to WHERE k.tenant_id=? ORDER BY k.id', (k) => [k.title, k.file_no, k.uname, k.due_date, k.priority, k.status], t);
    n.Invoices = S('Invoices', ['Invoice', 'Date', 'Client', 'Case', 'Status', 'Total (Rs)', 'Due'], 'SELECT i.*, c.name cname, m.file_no FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN matters m ON m.id=i.matter_id WHERE i.tenant_id=? ORDER BY i.id', (i) => [i.inv_no, i.inv_date, i.cname, i.file_no, i.status, R(i.total_paise), i.due_date], t);
    n.InvoiceLines = S('Invoice lines', ['Invoice', 'Description', 'Qty', 'Rate (Rs)'], 'SELECT l.*, i.inv_no FROM invoice_items l JOIN invoices i ON i.id=l.invoice_id WHERE l.tenant_id=? ORDER BY l.id', (l) => [l.inv_no, l.description, l.qty, R(l.rate_paise)], t);
    n.Receipts = S('Receipts', ['Receipt', 'Date', 'Client', 'Invoice', 'Amount (Rs)', 'Mode', 'Reference'], 'SELECT p.*, c.name cname, i.inv_no FROM payments p JOIN clients c ON c.id=p.client_id LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.tenant_id=? ORDER BY p.id', (p) => [p.rec_no, p.pay_date, p.cname, p.inv_no, R(p.amount_paise), p.mode, p.reference], t);
    n.Time = S('Time', ['Date', 'Person', 'Case', 'Hours', 'Narration', 'Rate/h (Rs)', 'Billable', 'Invoice'], 'SELECT e.*, m.file_no, u.name uname, i.inv_no FROM time_entries e JOIN users u ON u.id=e.user_id LEFT JOIN matters m ON m.id=e.matter_id LEFT JOIN invoices i ON i.id=e.invoice_id WHERE e.tenant_id=? AND e.deleted_at IS NULL ORDER BY e.work_date', (e) => [e.work_date, e.uname, e.file_no, hm(e.minutes), e.narration, R(e.rate_paise), e.billable ? 'Yes' : 'No', e.inv_no], t);
    n.Leads = S('Leads', ['Name', 'Phone', 'Email', 'Source', 'Issue', 'Stage', 'Added'], 'SELECT * FROM leads WHERE tenant_id=? ORDER BY id', (l) => [l.name, l.phone, l.email, l.source, l.issue, l.stage, l.created_at], t);
    n.Papers = S('Papers', ['Name', 'Category', 'Case', 'Size (bytes)', 'Added'], 'SELECT d.*, m.file_no FROM documents d LEFT JOIN matters m ON m.id=d.matter_id WHERE d.tenant_id=? ORDER BY d.id', (d) => [d.name, d.category, d.file_no, d.size || 0, d.created_at], t);
    n.Diary = S('Case diary', ['Case', 'Date', 'Type', 'Title', 'Note'], 'SELECT g.*, m.file_no FROM matter_diary g JOIN matters m ON m.id=g.matter_id WHERE g.tenant_id=? AND g.deleted_at IS NULL ORDER BY g.matter_id, g.pos', (g) => [g.file_no, g.entry_date, g.kind, g.title, g.note], t);
    const total = Object.values(n).reduce((s, x) => s + x, 0);
    sheets.unshift({ name: 'About', rows: [H(['Firm data export']), ['Firm', firm.name], ['Exported on', new Date(Date.now() + 19800000).toISOString().slice(0, 16).replace('T', ' ') + ' IST'], ['Exported by', req.user.name], [], H(['Sheet', 'Rows']), ...Object.entries(n).map(([k, v]) => [k, v]), [], ['Uploaded papers stay in the firm\'s own Google Drive / storage; this workbook lists them by name.']] });
    D.audit(t, req.user.id, 'firm_export', 'tenant', t, String(total), L.ip(req));
    const buf = await X.build(sheets);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${firm.slug}-data-${today()}.xlsx"`, 'Cache-Control': 'no-store' }); res.send(buf);
  });
};
Object.assign(module.exports, { norm, nameHit, valueOf, hm });
