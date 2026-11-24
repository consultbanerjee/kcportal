'use strict';
// v5.4: Unified search ("Finder"). One box searches everything the signed-in person is allowed to see: cases, clients, hearings, case notes,
// tasks, letters, in-out register, leads, calls, invoices, files, judgments, saved research, repository links and filing forums.
// Same for every firm. Every query is scoped to the firm and to the person's case access; nothing from another firm can appear.
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore');
db.exec(`CREATE TABLE IF NOT EXISTS saved_finds (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, q TEXT NOT NULL, types TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS ix_saved_finds ON saved_finds(tenant_id, user_id, id);`);
const CAP = 30;                                   // candidates read per source; the page shows "30+" when a source is capped
const escLike = (s) => s.replace(/[\\%_]/g, '\\$&');
const tokenize = (q) => [...new Set(L.str(q, 120).toLowerCase().replace(/[“”"']/g, ' ').split(/\s+/).filter(Boolean))].slice(0, 6);
const PRO = ['admin', 'advocate', 'staff'], FIN = ['admin', 'advocate', 'staff', 'accounts'], CRM = ['admin', 'advocate', 'staff', 'telecaller'], ALL = ['admin', 'advocate', 'staff', 'accounts', 'telecaller'];
const s1 = (v, n = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  // SQL that keeps rows tied to a case to cases this person may reach (column = the row's matter id)
  const caseOk = (req, col) => { const f = app.locals.teamSql(req); return f.sql ? { sql: ` AND (${col} IS NULL OR ${col} IN (SELECT m.id FROM matters m WHERE m.tenant_id=?${f.sql}))`, args: [T(req), ...f.args] } : { sql: '', args: [] }; };
  const SOURCES = [
    { key: 'matters', label: 'Cases', roles: ALL, cols: ['m.title', 'm.file_no', 'm.case_no', 'm.forum', 'm.opposite_party', 'm.summary', 'm.stage', 'c.name'], order: 'm.id DESC',
      from: () => 'FROM matters m JOIN clients c ON c.id=m.client_id', where: (req) => { const f = app.locals.teamSql(req); return { sql: "m.tenant_id=? AND m.status<>'deleted'" + f.sql, args: [T(req), ...f.args] }; },
      sel: 'm.id,m.file_no,m.title,m.case_no,m.forum,m.opposite_party,m.stage,m.summary,m.status,m.created_at,c.name AS client',
      map: (r) => ({ id: r.id, title: r.title, sub: [r.file_no, r.case_no, r.forum, r.client].filter(Boolean).join(' · '), body: [r.summary, r.opposite_party && 'Opposite party: ' + r.opposite_party, r.stage && 'Stage: ' + r.stage].filter(Boolean).join(' · '), href: '#/matter/' + r.id, date: r.created_at, tag: r.status === 'open' ? '' : r.status }) },
    { key: 'clients', label: 'Clients', roles: ALL, mod: 'clients', cols: ['c.name', 'c.phone', 'c.email', 'c.address', 'c.notes', 'c.reference'], order: 'c.id DESC', from: () => 'FROM clients c',
      where: (req) => { if (!app.locals.clientRestricted(req)) return { sql: 'c.tenant_id=?', args: [T(req)] }; const f = app.locals.teamSql(req); return { sql: 'c.tenant_id=? AND c.id IN (SELECT m.client_id FROM matters m WHERE 1=1' + f.sql + ')', args: [T(req), ...f.args] }; },
      sel: 'c.id,c.name,c.phone,c.email,c.address,c.notes,c.created_at',
      map: (r) => ({ id: r.id, title: r.name, sub: [r.phone, r.email].filter(Boolean).join(' · '), body: [r.address, r.notes].filter(Boolean).join(' · '), href: '#/client/' + r.id, date: r.created_at }) },
    { key: 'hearings', label: 'Hearings', roles: ALL, cols: ['h.purpose', 'h.outcome', 'm.title', 'm.file_no', 'm.case_no', 'h.hearing_date', 'h.next_date'], order: 'h.hearing_date DESC', from: () => 'FROM hearings h JOIN matters m ON m.id=h.matter_id',
      where: (req) => { const f = app.locals.teamSql(req); return { sql: "h.tenant_id=? AND m.status<>'deleted'" + f.sql, args: [T(req), ...f.args] }; },
      sel: 'h.id,h.matter_id,h.hearing_date,h.purpose,h.outcome,h.next_date,m.title,m.file_no',
      map: (r) => ({ id: r.id, title: (r.purpose || 'Hearing') + ' — ' + r.title, sub: [r.file_no, 'heard ' + r.hearing_date, r.next_date && 'next ' + r.next_date].filter(Boolean).join(' · '), body: r.outcome || '', href: '#/matter/' + r.matter_id, date: r.hearing_date }) },
    { key: 'notes', label: 'Case notes', roles: PRO, cols: ['n.note', 'm.title', 'm.file_no'], order: 'n.id DESC', from: () => 'FROM notings n JOIN matters m ON m.id=n.matter_id',
      where: (req) => { const f = app.locals.teamSql(req); return { sql: "n.tenant_id=? AND m.status<>'deleted'" + f.sql, args: [T(req), ...f.args] }; },
      sel: 'n.id,n.matter_id,n.note,n.created_at,m.title,m.file_no',
      map: (r) => ({ id: r.id, title: s1(r.note, 90), sub: r.file_no + ' · ' + r.title, body: r.note, href: '#/matter/' + r.matter_id, date: r.created_at }) },
    { key: 'tasks', label: 'Tasks', roles: ALL, mod: 'tasks', cols: ['t.title', 't.details'], order: 't.id DESC', from: () => 'FROM tasks t',
      where: (req) => { const c = caseOk(req, 't.matter_id'); return { sql: 't.tenant_id=?' + c.sql, args: [T(req), ...c.args] }; },
      sel: 't.id,t.title,t.details,t.status,t.due_date,t.created_at',
      map: (r) => ({ id: r.id, title: r.title, sub: [r.status, r.due_date && 'due ' + r.due_date].filter(Boolean).join(' · '), body: r.details || '', href: '#/tasks', date: r.created_at }) },
    { key: 'letters', label: 'Letters', roles: PRO, mod: 'letters', cols: ['l.subject', 'l.to_name', 'l.ref_no', 'l.body'], order: 'l.id DESC', from: () => 'FROM letters l',
      where: (req) => { const c = caseOk(req, 'l.matter_id'); return { sql: 'l.tenant_id=?' + c.sql, args: [T(req), ...c.args] }; },
      sel: 'l.id,l.ref_no,l.to_name,l.subject,l.body,l.status,l.created_at',
      map: (r) => ({ id: r.id, title: r.subject, sub: [r.ref_no, 'to ' + r.to_name, r.status].filter(Boolean).join(' · '), body: r.body, href: '#/letter/' + r.id, date: r.created_at }) },
    { key: 'register', label: 'In-Out register', roles: PRO, mod: 'register', cols: ['d.subject', 'd.from_name', 'd.ref_no'], order: 'd.id DESC', from: () => 'FROM dak d',
      where: (req) => { const c = caseOk(req, 'd.matter_id'); return { sql: 'd.tenant_id=?' + c.sql, args: [T(req), ...c.args] }; },
      sel: 'd.id,d.ref_no,d.received_on,d.from_name,d.subject,d.status,d.created_at',
      map: (r) => ({ id: r.id, title: r.subject, sub: [r.ref_no, 'from ' + r.from_name, r.received_on].filter(Boolean).join(' · '), body: '', href: '#/register?kind=in', date: r.created_at }) },
    { key: 'leads', label: 'Leads', roles: CRM, mod: 'crm', cols: ['ld.name', 'ld.phone', 'ld.email', 'ld.issue', 'ld.source'], order: 'ld.id DESC', from: () => 'FROM leads ld', where: (req) => ({ sql: 'ld.tenant_id=?', args: [T(req)] }),
      sel: 'ld.id,ld.name,ld.phone,ld.email,ld.issue,ld.stage,ld.created_at',
      map: (r) => ({ id: r.id, title: r.name, sub: [r.phone, r.email, r.stage].filter(Boolean).join(' · '), body: r.issue || '', href: '#/lead/' + r.id, date: r.created_at }) },
    { key: 'leadnotes', label: 'Call notes', roles: CRM, mod: 'crm', cols: ['ln.note', 'ld.name'], order: 'ln.id DESC', from: () => 'FROM lead_notes ln JOIN leads ld ON ld.id=ln.lead_id', where: (req) => ({ sql: 'ln.tenant_id=?', args: [T(req)] }),
      sel: 'ln.id,ln.lead_id,ln.note,ln.outcome,ln.created_at,ld.name',
      map: (r) => ({ id: r.id, title: s1(r.note, 90) || r.outcome || 'Call note', sub: 'Lead ' + r.name + (r.outcome ? ' · ' + r.outcome : ''), body: r.note || '', href: '#/lead/' + r.lead_id, date: r.created_at }) },
    { key: 'appointments', label: 'Calls and bookings', roles: CRM, mod: 'crm', cols: ['a.name', 'a.phone', 'a.email', 'a.issue'], order: 'a.start_at DESC', from: () => 'FROM appointments a', where: (req) => ({ sql: 'a.tenant_id=?', args: [T(req)] }),
      sel: 'a.id,a.name,a.phone,a.issue,a.start_at,a.status,a.created_at', map: (r) => ({ id: r.id, title: r.name, sub: [r.start_at && r.start_at.slice(0, 16).replace('T', ' ') + ' UTC', r.status, r.phone].filter(Boolean).join(' · '), body: r.issue || '', href: '#/appointments', date: r.start_at || r.created_at }) },
    { key: 'invoices', label: 'Invoices', roles: FIN, mod: 'accounts', cols: ['i.inv_no', 'i.notes', 'c.name', 'm.file_no', 'm.title'], order: 'i.id DESC', from: () => 'FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN matters m ON m.id=i.matter_id',
      where: (req) => { const c = caseOk(req, 'i.matter_id'); return { sql: 'i.tenant_id=?' + c.sql, args: [T(req), ...c.args] }; },
      sel: 'i.id,i.inv_no,i.inv_date,i.notes,i.status,i.total_paise,i.created_at,c.name AS client',
      map: (r) => ({ id: r.id, title: r.inv_no + ' — ' + r.client, sub: [r.inv_date, r.status, '₹' + (r.total_paise / 100).toLocaleString('en-IN')].filter(Boolean).join(' · '), body: r.notes || '', href: '#/invoice/' + r.id, date: r.inv_date }) },
    { key: 'files', label: 'Files', roles: FIN, mod: 'files', cols: ['f.name', 'c.name'], order: 'f.id DESC', from: () => 'FROM fs_nodes f LEFT JOIN clients c ON c.id=f.client_id',
      where: (req) => { if (!app.locals.clientRestricted(req)) return { sql: "f.tenant_id=? AND f.kind='file' AND f.deleted_at IS NULL", args: [T(req)] }; const f = app.locals.teamSql(req);
        return { sql: "f.tenant_id=? AND f.kind='file' AND f.deleted_at IS NULL AND (f.client_id IS NULL OR f.client_id IN (SELECT m.client_id FROM matters m WHERE 1=1" + f.sql + '))', args: [T(req), ...f.args] }; },
      sel: 'f.id,f.name,f.size,f.client_id,f.created_at,c.name AS client',
      map: (r) => ({ id: r.id, title: r.name, sub: [r.client || 'Firm files', r.size ? (r.size / 1048576 >= 1 ? (r.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(r.size / 1024)) + ' KB') : ''].filter(Boolean).join(' · '), body: '', href: r.client_id ? '#/client/' + r.client_id : '#/files', date: r.created_at }) },
    { key: 'documents', label: 'Case documents', roles: PRO, cols: ['dc.name', 'dc.category', 'm.title', 'm.file_no'], order: 'dc.id DESC', from: () => 'FROM documents dc LEFT JOIN matters m ON m.id=dc.matter_id',
      where: (req) => { const c = caseOk(req, 'dc.matter_id'); return { sql: 'dc.tenant_id=?' + c.sql, args: [T(req), ...c.args] }; },
      sel: 'dc.id,dc.matter_id,dc.name,dc.category,dc.created_at,m.title,m.file_no',
      map: (r) => ({ id: r.id, title: r.name, sub: [r.category, r.file_no, r.title].filter(Boolean).join(' · '), body: '', href: r.matter_id ? '#/matter/' + r.matter_id : '#/files', date: r.created_at }) },
    { key: 'judgments', label: 'Judgments', roles: PRO, mod: 'judgments', cols: ['j.title', 'j.court', 'j.case_no', 'j.judge', 'j.citation', 'j.subject', 'j.summary'], order: 'j.id DESC', from: () => 'FROM judgments j', where: (req) => ({ sql: 'j.tenant_id=?', args: [T(req)] }),
      sel: 'j.id,j.title,j.court,j.case_no,j.judge,j.citation,j.subject,j.summary,j.decided_on,j.created_at',
      map: (r) => ({ id: r.id, title: r.title, sub: [r.court, r.case_no, r.citation, r.decided_on].filter(Boolean).join(' · '), body: [r.subject, r.summary, r.judge && 'Judge: ' + r.judge].filter(Boolean).join(' · '), href: '#/judgments', date: r.decided_on || r.created_at, open: 'judgment' }) },
    { key: 'research', label: 'Saved research', roles: PRO, mod: 'research', cols: ['r.title', 'r.body', 'r.note'], order: 'r.id DESC', from: () => 'FROM research_saved r', where: (req) => ({ sql: 'r.tenant_id=? AND r.user_id=?', args: [T(req), req.user.id] }),
      sel: 'r.id,r.title,r.body,r.note,r.url,r.created_at', map: (r) => ({ id: r.id, title: r.title, sub: r.note ? 'Note: ' + s1(r.note, 80) : '', body: r.body || '', href: '#/research', ext: r.url || '', date: r.created_at }) },
  ];
  const off = (req, src) => {
    if (!src.mod) return false;
    try { if (AI.getS(T(req), 'sa_off', '').split(',').includes(src.mod)) return true; } catch (e) { /* ignore */ }
    try { if ((require('./team').offList(T(req), req.user.role) || []).includes(src.mod)) return true; } catch (e) { /* ignore */ }
    return false;
  };
  // sources that are not database tables: the repository's links and the filing forums
  const staticHits = (req, tokens, mode) => {
    const out = [], hit = (hay) => { const h = hay.toLowerCase(); return mode === 'any' ? tokens.some((t) => h.includes(t)) : tokens.every((t) => h.includes(t)); };
    if (!['superadmin', 'client'].includes(req.user.role) && !AI.getS(T(req), 'sa_off', '').split(',').includes('repository')) {
      try {
        const X = require('./extras'), hide = new Set(db.prepare('SELECT key FROM repo_hide WHERE tenant_id=?').all(T(req)).map((r) => r.key)), rows = [];
        for (const [cat, list] of X.CATALOG || []) for (const [title, url, note] of list) if (!hide.has(cat + '|' + url) && hit(`${title} ${note || ''} ${cat}`)) rows.push({ id: url, title, sub: cat, body: note || '', ext: url, href: '#/repository/all' });
        for (const r of db.prepare('SELECT id,cat,title,url,note FROM repo_links WHERE tenant_id=?').all(T(req))) if (hit(`${r.title} ${r.note || ''} ${r.cat}`)) rows.push({ id: 'u' + r.id, title: r.title, sub: r.cat + ' · yours', body: r.note || '', ext: r.url, href: '#/repository/all' });
        out.push({ key: 'repository', label: 'Repository links', rows });
      } catch (e) { /* repository unavailable */ }
    }
    if (PRO.includes(req.user.role) && !AI.getS(T(req), 'sa_off', '').split(',').includes('efiling')) {
      try {
        const rows = [];
        for (const f of require('./efiling').catalog()) if (hit(`${f.name} ${f.type || ''} ${f.notes || ''} ${f.login || ''}`)) rows.push({ id: f.id, title: f.name, sub: [f.type, f.max_file_mb ? 'largest file ' + f.max_file_mb + ' MB' : ''].filter(Boolean).join(' · '), body: f.notes || '', ext: '', href: '#/forums?q=' + encodeURIComponent(f.name) });
        for (const f of db.prepare('SELECT id,name,type,notes,portal_url FROM firm_forums WHERE tenant_id=?').all(T(req))) if (hit(`${f.name} ${f.type || ''} ${f.notes || ''}`)) rows.push({ id: 'f' + f.id, title: f.name, sub: (f.type || 'Forum') + ' · yours', body: f.notes || '', href: '#/forums?q=' + encodeURIComponent(f.name) });
        out.push({ key: 'forums', label: 'Filing forums', rows });
      } catch (e) { /* forums unavailable */ }
    }
    return out;
  };
  const score = (it, tokens, qlow) => {
    const t = (it.title || '').toLowerCase(), s = (it.sub || '').toLowerCase(), b = (it.body || '').toLowerCase(); let sc = 0, inTitle = 0;
    for (const k of tokens) {
      if (t.includes(k)) { inTitle++; sc += t === k ? 60 : t.startsWith(k) || t.includes(' ' + k) ? 45 : 30; }
      if (s.includes(k)) sc += 14; if (b.includes(k)) sc += 6;
    }
    if (tokens.length > 1 && inTitle === tokens.length) sc += 25;
    if (t === qlow) sc += 60;
    const d = it.date && Date.parse(String(it.date).replace(' ', 'T')); if (d) { const age = (Date.now() - d) / 86400000; sc += age < 30 ? 4 : age < 180 ? 2 : 0; }
    return sc;
  };
  const snippet = (body, tokens) => {
    const b = String(body || '').replace(/\s+/g, ' ').trim(); if (!b) return '';
    const low = b.toLowerCase(); let at = -1; for (const k of tokens) { const i = low.indexOf(k); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) return b.length > 140 ? b.slice(0, 140) + '…' : b;
    const a = Math.max(0, at - 55), z = Math.min(b.length, at + 110); return (a > 0 ? '…' : '') + b.slice(a, z) + (z < b.length ? '…' : '');
  };
  const search = (req, tokens, mode, only, per, noStatic) => {
    const qlow = tokens.join(' '), groups = [];
    for (const src of SOURCES) {
      if (only && !only.includes(src.key)) continue;
      if (!src.roles.includes(req.user.role) || off(req, src)) continue;
      try {
        const w = src.where(req), cond = tokens.map(() => '(' + src.cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')').join(mode === 'any' ? ' OR ' : ' AND ');
        const args = [...w.args, ...tokens.flatMap((t) => src.cols.map(() => '%' + escLike(t) + '%'))];
        const rows = db.prepare(`SELECT ${src.sel} ${src.from()} WHERE ${w.sql} AND (${cond}) ORDER BY ${src.order} LIMIT ${CAP}`).all(...args);
        if (!rows.length) continue;
        const items = rows.map((r) => { const it = src.map(r); it.type = src.key; it.score = score(it, tokens, qlow); it.snippet = snippet(it.body, tokens); delete it.body; return it; }).sort((a, b) => b.score - a.score);
        groups.push({ key: src.key, label: src.label, count: items.length, capped: rows.length >= CAP, items: items.slice(0, per), best: items[0].score });
      } catch (e) { console.error('finder', src.key, e.message); }
    }
    for (const g of (noStatic ? [] : staticHits(req, tokens, mode))) {
      if (only && !only.includes(g.key)) continue; if (!g.rows.length) continue;
      const items = g.rows.map((it) => { it.type = g.key; it.score = score(it, tokens, qlow); it.snippet = snippet(it.body, tokens); delete it.body; return it; }).sort((a, b) => b.score - a.score);
      groups.push({ key: g.key, label: g.label, count: items.length, capped: false, items: items.slice(0, per), best: items[0].score });
    }
    return groups.sort((a, b) => b.best - a.best);
  };
  const noClient = (req, res, next) => (['client', 'superadmin'].includes(req.user.role) ? res.status(403).json({ error: 'Not available.' }) : next());
  app.get('/api/find', L.requireLogin, noClient, (req, res) => {
    const t0 = Date.now(), tokens = tokenize(req.query.q), per = Math.min(Math.max(L.int(req.query.per) || 8, 1), 40);
    const only = String(req.query.types || '').split(',').filter((x) => /^[a-z]+$/.test(x)); if (!tokens.length || tokens.join('').length < 2) return res.json({ q: '', tokens: [], total: 0, groups: [], took_ms: 0, relaxed: false });
    let groups = search(req, tokens, 'all', only.length ? only : null, per), relaxed = false;
    // loose fallback: only meaningful words (3+ letters, not filler), and never the link catalogues, which would match almost anything
    const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'vs', 'versus', 'case', 'matter', 'of', 'in', 'on', 'to', 'or', 'an']), loose = tokens.filter((t) => t.length >= 3 && !STOP.has(t));
    if (!groups.length && loose.length > 1) { groups = search(req, loose, 'any', only.length ? only : null, per, true); relaxed = groups.length > 0; }
    res.json({ q: tokens.join(' '), tokens, total: groups.reduce((n, g) => n + g.count, 0), groups, took_ms: Date.now() - t0, relaxed, types: SOURCES.filter((s) => s.roles.includes(req.user.role) && !off(req, s)).map((s) => [s.key, s.label]).concat(off(req, { mod: 'repository' }) ? [] : [['repository', 'Repository links']]).concat(PRO.includes(req.user.role) && !off(req, { mod: 'efiling' }) ? [['forums', 'Filing forums']] : []) });
  });
  app.get('/api/find/saved', L.requireLogin, noClient, (req, res) => res.json(db.prepare('SELECT id,q,types,created_at FROM saved_finds WHERE tenant_id=? AND user_id=? ORDER BY id DESC LIMIT 30').all(T(req), req.user.id)));
  app.post('/api/find/saved', L.requireLogin, noClient, (req, res) => {
    const q = L.str((req.body || {}).q, 120).trim(); if (!L.must(res, q.length >= 2, 'Type something to search for first.')) return;
    const types = String((req.body || {}).types || '').split(',').filter((x) => /^[a-z]+$/.test(x)).join(',');
    if (db.prepare('SELECT 1 x FROM saved_finds WHERE tenant_id=? AND user_id=? AND lower(q)=lower(?) AND COALESCE(types,\'\')=?').get(T(req), req.user.id, q, types)) return res.json({ ok: true, dup: true });
    if (db.prepare('SELECT COUNT(*) n FROM saved_finds WHERE tenant_id=? AND user_id=?').get(T(req), req.user.id).n >= 30) return res.status(400).json({ error: 'You can keep 30 saved searches. Remove one first.' });
    res.json({ ok: true, id: db.prepare('INSERT INTO saved_finds(tenant_id,user_id,q,types) VALUES (?,?,?,?)').run(T(req), req.user.id, q, types).lastInsertRowid });
  });
  app.delete('/api/find/saved/:id', L.requireLogin, noClient, (req, res) => {
    const r = db.prepare('DELETE FROM saved_finds WHERE id=? AND tenant_id=? AND user_id=?').run(L.int(req.params.id), T(req), req.user.id);
    res.status(r.changes ? 200 : 404).json(r.changes ? { ok: true } : { error: 'Not found.' });
  });
};
Object.assign(module.exports, { tokenize });
