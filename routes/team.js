'use strict';
// CASE TEAM: assign a case to one or more advocates / staff with limited rights.
// Levels:  view = read the case only;  work = view + add hearings, notings, tasks, orders and files;  full = everything on the case (edit details, team, fees).
// Firm switch "Restrict advocates and staff to the cases they are assigned" (off by default, so nothing changes until the firm administrator turns it on).
// The firm administrator always has full access. Written once for every firm.
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore');
db.exec(`CREATE TABLE IF NOT EXISTS matter_team (matter_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, level TEXT NOT NULL DEFAULT 'work', added_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (matter_id, user_id))`);
const LEVELS = ['view', 'work', 'full'], RANK = { view: 1, work: 2, full: 3 };
const T = (req) => req.user.tenant_id;
const restrict = (t) => AI.getS(t, 'team_restrict') === '1';
try { db.exec('ALTER TABLE matters ADD COLUMN created_by INTEGER'); } catch (e) { /* already there */ }
// What an ADVOCATE may see. By default an advocate sees only the cases allotted to him or created by him, and none of the other modules.
// The firm administrator switches on, one by one, what advocates may also use. (Staff, telecallers and accounts follow the older single switch above.)
const ADV_KEYS = [['allcases', 'All cases of the firm (not only their own)'], ['clients', 'All clients'], ['ecourts', 'Court search and cause list'], ['calendar', 'Calendar'], ['tasks', 'Tasks page'], ['files', 'Firm-wide Files'],
  ['letters', 'Letters'], ['register', 'In-Out Register'], ['draft', 'AI Drafting'], ['limitation', 'Limitation'], ['messages', 'Messages'], ['mail', 'Mail'], ['chats', 'Chats'], ['crm', 'CRM (follow-ups, tickets, leads, calls)'],
  ['consents', 'Consents'], ['accounts', 'Accounts'], ['judgments', 'Judgments'], ['repository', 'Repository']];
// Advocates and staff: the firm switches modules on one by one (setting adv_mods / staff_mods). Accountants see accounts only and telecallers calling/CRM only, fixed.
const SETKEY = { advocate: 'adv_mods', staff: 'staff_mods' }, FIXED = { accounts: ['accounts'], telecaller: ['crm', 'chats'] };
const modOn = (t, role, k) => (SETKEY[role] ? String(AI.getS(t, SETKEY[role], '')).split(',').includes(k) : FIXED[role] ? FIXED[role].includes(k) : true);
const advOn = (t, k) => modOn(t, 'advocate', k);
const offList = (t, role) => (SETKEY[role] || FIXED[role] ? ADV_KEYS.map((x) => x[0]).filter((k) => !modOn(t, role, k)) : []);
const advOffList = (t) => offList(t, 'advocate');
// API areas that belong to each module; the check runs before the request reaches the route
const GATES = [['ecourts', /^\/api\/ecourts\/(search|causelist|structure|legal-check|import)/], ['draft', /^\/api\/ai\/(draft|drafts|formats|kinds|client-docs)/], ['calendar', /^\/api\/(calendar|dates)(\/|$)/],
  ['tasks', /^\/api\/tasks(\/|$)/], ['letters', /^\/api\/letters(\/|$)/], ['register', /^\/api\/(register|dak)(\/|$)/], ['messages', /^\/api\/messages(\/|$)/], ['mail', /^\/api\/mail(\/|$)/], ['chats', /^\/api\/chats(\/|$)/],
  ['crm', /^\/api\/(appointments|leads|tickets|tickets-count|followups|consents|contacts|consult-types|consult-fees|availability)(\/|$)/], ['consents', /^\/api\/consents(\/|$)/],
  ['accounts', /^\/api\/(books|bank|invoices|payments|payee-payments|payees|payee-sources|pay-schedules|recurring|expenses|ledger|cash|reports|upi|reminders)(\/|$)/], ['judgments', /^\/api\/judgments(\/|$)/], ['repository', /^\/api\/repository(\/|$)/]];
function gate(req, res, next) {
  const u = req.user; if (!u || !(SETKEY[u.role] || FIXED[u.role]) || !req.path.startsWith('/api/')) return next();
  const t = u.tenant_id, role = u.role; let key = null;
  for (const [k, rx] of GATES) if (rx.test(req.path)) { key = k; break; }
  if (!key && /^\/api\/fs\//.test(req.path) && !L.int((req.method === 'GET' ? req.query : req.body || {}).client_id)) key = 'files';
  if (key === 'tasks') {                                    // assigned work is always theirs to see and finish; the whole task board is a switch
    if (req.method === 'POST') { if (req.body && req.body.matter_id) key = null; }
    else if (req.method === 'GET' && !modOn(t, role, 'tasks')) { req.tasksMine = true; key = null; }
    else if (req.method !== 'GET') key = null;
  }
  if (key && !modOn(t, role, key)) return res.status(403).json({ error: 'This part of the portal has not been opened for your role by your firm.' });
  next();
}

module.exports = (app) => {
  // level of the signed-in user on one case: 'view' | 'work' | 'full' | 'client' | null (no access)
  const level = (req, m) => {
    const u = req.user; if (!u || !m || m.status === 'deleted') return null;
    if (u.role === 'client') return m.client_id === u.client_id ? 'client' : null;
    if (u.role === 'admin' || u.role === 'superadmin') return 'full';
    if (!['advocate', 'staff', 'accounts', 'telecaller'].includes(u.role)) return null;
    if (!restricted(req)) return 'full';
    if (m.assigned_to && m.assigned_to === u.id) return 'full';
    if (m.created_by && m.created_by === u.id) return m.assigned_to && m.assigned_to !== u.id ? 'view' : 'full';     // made the case; if it was handed on, he can still follow it
    const r = db.prepare('SELECT level FROM matter_team WHERE matter_id=? AND user_id=?').get(m.id, u.id);
    return r ? r.level : null;
  };
  const atLeast = (req, m, need) => { const lv = level(req, m); return !!lv && (lv === 'client' ? need === 'view' : RANK[lv] >= RANK[need]); };
  const restricted = (req) => { const r = req.user.role; return SETKEY[r] ? !modOn(T(req), r, 'allcases') : r === 'telecaller' ? true : r === 'accounts' ? true : false; };
  const clientRestricted = (req) => restricted(req) && !(req.user.role === 'accounts') && !(SETKEY[req.user.role] && modOn(T(req), req.user.role, 'clients'));
  // SQL fragment that keeps a restricted user to their cases (alias m = matters)
  const sqlOnly = (req) => (restricted(req) ? { sql: ' AND (m.assigned_to=? OR m.created_by=? OR EXISTS (SELECT 1 FROM matter_team tm WHERE tm.matter_id=m.id AND tm.user_id=?))', args: [req.user.id, req.user.id, req.user.id] } : { sql: '', args: [] });
  // files and clients: a restricted user reaches a client's papers only through a case they are on
  const clientLevel = (req, clientId) => {
    if (!clientRestricted(req)) return 'full'; let best = null;
    for (const m of db.prepare('SELECT * FROM matters WHERE client_id=? AND tenant_id=?').all(clientId, T(req))) { const lv = level(req, m); if (lv && (!best || RANK[lv] > RANK[best])) best = lv; }
    return best;
  };
  Object.assign(app.locals, { matterLevel: level, matterAtLeast: atLeast, teamRestricted: restricted, clientRestricted, teamSql: sqlOnly, clientLevel });

  const team = (m) => db.prepare(`SELECT tm.user_id, tm.level, u.name, u.role FROM matter_team tm JOIN users u ON u.id=tm.user_id WHERE tm.matter_id=? ORDER BY u.name`).all(m.id);
  const get = (req, res) => { const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req)); if (!m || !level(req, m)) { res.status(404).json({ error: 'Not found.' }); return null; } return m; };

  app.get('/api/matters/:id/team', L.office, (req, res) => {
    const m = get(req, res); if (!m) return;
    const people = db.prepare("SELECT id,name,role FROM users WHERE tenant_id=? AND role IN ('admin','advocate','staff') AND active=1 ORDER BY name").all(T(req));
    res.json({ members: team(m), people, levels: LEVELS, my_level: level(req, m), restrict: restrict(T(req)), can_manage: atLeast(req, m, 'full') && req.user.role !== 'client', lead: m.assigned_to || null });
  });
  app.put('/api/matters/:id/team', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const m = get(req, res); if (!m) return;
    if (!atLeast(req, m, 'full')) return res.status(403).json({ error: 'Only someone with full access to this case can change its team.' });
    const list = Array.isArray((req.body || {}).members) ? req.body.members : [], t = T(req);
    const ok = new Set(db.prepare("SELECT id FROM users WHERE tenant_id=? AND role IN ('admin','advocate','staff') AND active=1").all(t).map((x) => x.id));
    const clean = []; for (const x of list) { const id = L.int(x.user_id), lv = LEVELS.includes(x.level) ? x.level : 'work'; if (ok.has(id) && !clean.some((c) => c.id === id)) clean.push({ id, lv }); }
    // a restricted user cannot lock themselves out of the case they are managing
    if (restricted(req) && !clean.some((c) => c.id === req.user.id && c.lv === 'full') && m.assigned_to !== req.user.id) clean.push({ id: req.user.id, lv: 'full' });
    db.prepare('DELETE FROM matter_team WHERE matter_id=?').run(m.id);
    const ins = db.prepare('INSERT INTO matter_team(matter_id,tenant_id,user_id,level,added_by) VALUES (?,?,?,?,?)'); for (const c of clean) ins.run(m.id, t, c.id, c.lv, req.user.id);
    D.audit(t, req.user.id, 'matter_team', 'matter', m.id, clean.map((c) => c.id + ':' + c.lv).join(','), req.ip);
    res.json({ ok: true, members: team(m) });
  });
  app.get('/api/team/settings', L.need('admin'), (req, res) => res.json({ restrict: restrict(T(req)), keys: ADV_KEYS.map(([k, l]) => ({ key: k, label: l, on: advOn(T(req), k), staff: modOn(T(req), 'staff', k) })) }));
  app.put('/api/team/settings', L.need('admin'), (req, res) => {
    const b = req.body || {}, t = T(req);
    if (b.restrict !== undefined) AI.setS(t, 'team_restrict', b.restrict ? '1' : '0');
    for (const [role, field] of [['advocate', 'advocate'], ['staff', 'staff']]) if (Array.isArray(b[field])) { AI.setS(t, SETKEY[role], ADV_KEYS.map((x) => x[0]).filter((k) => b[field].includes(k)).join(',')); D.audit(t, req.user.id, role + '_access_changed', 'settings', 0, AI.getS(t, SETKEY[role], ''), req.ip); }
    res.json({ ok: true, restrict: restrict(t) });
  });
};
Object.assign(module.exports, { LEVELS, gate, advOffList, offList, ADV_KEYS });
