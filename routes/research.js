'use strict';
// RESEARCH DESK: one place to look up law. Ask a question in plain words (answered from Indian law only, precedents named and checked for being overruled),
// or search the firm's own judgments library by keyword, citation, party, Act or judge, with links to the official sources.
// Two switches: the Super Admin can leave it out of a firm's plan (module "research"), and the firm administrator can switch it off for the firm. Same for every firm.
const rateLimit = require('express-rate-limit');
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore');
db.exec(`CREATE TABLE IF NOT EXISTS research_log (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL, query TEXT NOT NULL, answer TEXT, matter_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS ix_research_user ON research_log(tenant_id, user_id, id);`);
const T = (req) => req.user.tenant_id;
const firmOn = (t) => AI.getS(t, 'research_on', '1') !== '0';
const MODES = { keyword: 'Keyword', citation: 'Citation', party: 'Party name', act: 'Act / section', judge: 'Judge' };
const SOURCES = (q) => [
  ['Supreme Court of India', 'https://www.sci.gov.in/judgements-judgement-date/'], ['eCourts judgments (High Courts and district courts)', 'https://judgments.ecourts.gov.in/'],
  ['Indian Kanoon', 'https://indiankanoon.org/search/?formInput=' + encodeURIComponent(q || '')], ['India Code (Acts and Rules)', 'https://www.indiacode.nic.in/'], ['eCourts services (case status, cause lists)', 'https://services.ecourts.gov.in/'],
];
const SYSTEM = (firm, forum) => `You are the legal research assistant of ${firm}, an Indian law firm. Answer only under Indian law, using Indian statutes and judgments of Indian courts and tribunals.
${forum ? `The matter is before: ${forum}. Look first for decisions of that same forum or tribunal, then the High Court, then the Supreme Court.` : 'Prefer the Supreme Court, then the relevant High Court or tribunal.'}
Rules: (1) Name a case only if you are sure it exists; give court, year and citation when you know them, and say "citation to be verified" when you do not. Never invent a case, citation or quotation. (2) For every precedent you rely on, say what it decided and whether it has been overruled, doubted or distinguished; if it was overruled, say so first and give the position now. (3) Say plainly what the law is, the arguments for each side, and the practical next step. (4) Mention the Bharatiya Nyaya Sanhita / BNSS / BSA equivalents where an old criminal law section is involved. (5) Keep to what was asked, in clear short paragraphs; no headings beyond what helps. Close with one line: "Please verify every citation on the official report before relying on it."`;

module.exports = (app) => {
  const OFF = (req, res, next) => (firmOn(T(req)) ? next() : res.status(403).json({ error: 'The Research Desk has been switched off by your firm.' }));
  const lim = rateLimit({ windowMs: 3600000, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => 'r' + req.user.id, message: { error: 'Many questions in the last hour. Please try again a little later.' } });
  const ask = async (req, res, kind, user, forum, saveQ) => {
    const t = T(req);
    if (!AI.allowed(t)) return res.status(403).json({ error: 'AI is not switched on for your firm. Please contact the portal provider.' });
    const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'the firm';
    try {
      const r = await AI.call(t, 'research', { system: SYSTEM(firm, forum), messages: [{ role: 'user', content: user }], max_tokens: 2500 });
      const a = AI.textOf(r);
      const id = db.prepare('INSERT INTO research_log(tenant_id,user_id,kind,query,answer) VALUES (?,?,?,?,?)').run(t, req.user.id, kind, saveQ, a).lastInsertRowid;
      res.json({ id, answer: a });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };

  app.get('/api/research/status', L.office, (req, res) => res.json({ on: firmOn(T(req)), ai: AI.allowed(T(req)), modes: MODES }));
  app.put('/api/research/settings', L.need('admin'), (req, res) => {
    AI.setS(T(req), 'research_on', (req.body || {}).on ? '1' : '0'); D.audit(T(req), req.user.id, 'research_switch', 'settings', 0, (req.body || {}).on ? 'on' : 'off', L.ip(req)); res.json({ ok: true, on: firmOn(T(req)) });
  });

  app.get('/api/research/search', L.office, OFF, (req, res) => {
    const t = T(req), mode = MODES[req.query.mode] ? req.query.mode : 'keyword', raw = L.str(req.query.q, 120).trim();
    if (raw.length < 3) return res.json({ judgments: [], matters: [], sources: SOURCES('') });
    const q = '%' + raw.replace(/[%_]/g, '') + '%';
    const col = { keyword: ['title', 'summary', 'subject', 'citation', 'case_no', 'court', 'judge'], citation: ['citation', 'case_no'], party: ['title', 'case_no'], act: ['subject', 'summary', 'title'], judge: ['judge'] }[mode];
    const judgments = db.prepare(`SELECT id,court,case_no,title,judge,decided_on,citation,subject,source_url FROM judgments WHERE tenant_id=? AND (${col.map((c) => c + ' LIKE ?').join(' OR ')}) ORDER BY decided_on DESC LIMIT 40`).all(t, ...col.map(() => q));
    let matters = [];
    if (mode === 'party') { const f = app.locals.teamSql(req); matters = db.prepare("SELECT m.id,m.file_no,m.title,m.opposite_party,m.forum FROM matters m WHERE m.tenant_id=? AND m.status<>'deleted' AND (m.title LIKE ? OR m.opposite_party LIKE ?)" + f.sql + ' LIMIT 20').all(t, q, q, ...f.args); }
    res.json({ judgments, matters, sources: SOURCES(raw) });
  });

  app.post('/api/research/ask', L.office, OFF, lim, (req, res) => {
    const q = L.str((req.body || {}).q, 3000).trim(); if (q.length < 8) return res.status(400).json({ error: 'Please write your question in a sentence or two.' });
    let forum = ''; const mid = L.int((req.body || {}).matter_id);
    if (mid) { const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(mid, T(req)); if (!m || !app.locals.matterAtLeast(req, m, 'view')) return res.status(404).json({ error: 'Not found.' }); forum = m.forum || ''; }
    return (app.locals.caselawContext ? app.locals.caselawContext(q) : Promise.resolve('')).then((ctx) => ask(req, res, 'ask', q + ctx, forum, q));
  });
  app.post('/api/research/overruled', L.office, OFF, lim, (req, res) => {
    const c = L.str((req.body || {}).case, 300).trim(); if (c.length < 5) return res.status(400).json({ error: 'Give the case name or citation.' });
    return ask(req, res, 'overruled', `Check this Indian precedent: "${c}". Say what it decided, whether it has been overruled, doubted, distinguished or affirmed by a later larger bench or by the Supreme Court, and the current position. If you cannot be sure the case exists, say so.`, '', c);
  });
  app.get('/api/research/history', L.office, OFF, (req, res) => res.json(db.prepare('SELECT id,kind,query,answer,created_at FROM research_log WHERE tenant_id=? AND user_id=? ORDER BY id DESC LIMIT 30').all(T(req), req.user.id)));
  // keep an answer on a case file as a noting
  app.post('/api/research/save', L.office, OFF, (req, res) => {
    const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int((req.body || {}).matter_id), T(req));
    const h = db.prepare('SELECT * FROM research_log WHERE id=? AND tenant_id=? AND user_id=?').get(L.int((req.body || {}).id), T(req), req.user.id);
    if (!m || !h || !app.locals.matterAtLeast(req, m, 'work')) return res.status(404).json({ error: 'Not found.' });
    db.prepare('INSERT INTO notings(tenant_id,matter_id,user_id,note) VALUES (?,?,?,?)').run(T(req), m.id, req.user.id, ('Research — ' + h.query + '\n\n' + (h.answer || '')).slice(0, 8000));
    D.audit(T(req), req.user.id, 'research_saved', 'matter', m.id, h.query.slice(0, 80), L.ip(req)); res.json({ ok: true });
  });
};
Object.assign(module.exports, { firmOn });
