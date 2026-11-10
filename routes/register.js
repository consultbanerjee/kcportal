'use strict';
// In-Out Register: every inward and outward letter / communication, optionally tied to a client and a case.
// Only the Inward / Outward number is compulsory; entries may carry any date (back-dating is normal); the numbering format can be changed.
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

const FIELDS = ['entry_date', 'entry_time', 'party', 'their_ref', 'subject', 'enclosures', 'dept', 'action', 'signature', 'remarks', 'reply_to', 'mode', 'tracking'];
const MAXLEN = { subject: 1000, enclosures: 1000, remarks: 1000, party: 400 };
const DEF = { in: '{P}/IN/{YYYY}/{N:4}', out: '{P}/OUT/{YYYY}/{N:4}' };
const pad = (n, w) => String(n).padStart(w, '0');
const fmtOf = (t, kind) => AI.getS(t, 'reg_fmt_' + kind) || DEF[kind];
const yearly = (fmt) => /\{YY(YY)?\}/.test(fmt);
const render = (t, fmt, n, year) => {
  const p = (db.prepare('SELECT prefix FROM tenants WHERE id=?').get(t) || {}).prefix || 'KC';
  return fmt.replace(/\{P\}/g, p).replace(/\{YYYY\}/g, year).replace(/\{YY\}/g, String(year).slice(-2)).replace(/\{N(?::(\d+))?\}/g, (m, w) => pad(n, +w || 1));
};
const ckind = (kind) => (kind === 'in' ? 'in' : 'out');
// next free number for the year of the entry date (so a back-dated entry takes a number of its own year)
function generate(t, kind, date) {
  const fmt = fmtOf(t, kind), year = date && /^\d{4}/.test(date) ? +date.slice(0, 4) : new Date().getFullYear(), ck = yearly(fmt) ? year : 0;
  const row = db.prepare('SELECT n FROM counters WHERE tenant_id=? AND kind=? AND year=?').get(t, 'reg_' + kind, ck);
  let n = (row ? row.n : 0) + 1, no;
  for (let g = 0; g < 10000; g++, n++) { no = render(t, fmt, n, year); if (!db.prepare('SELECT 1 FROM register WHERE tenant_id=? AND kind=? AND no=?').get(t, kind, no)) break; }
  db.prepare('INSERT INTO counters(tenant_id,kind,year,n) VALUES (?,?,?,?) ON CONFLICT(tenant_id,kind,year) DO UPDATE SET n=excluded.n').run(t, 'reg_' + kind, ck, n);
  return no;
}
const clean = (b) => { const o = {}; for (const k of FIELDS) if (b[k] !== undefined) o[k] = L.str(b[k], MAXLEN[k] || 300); if (o.entry_date && !L.isDate(o.entry_date)) o.entry_date = ''; return o; };

module.exports = (app) => {
  const T = (req) => req.user.tenant_id, OFFICE = L.need('admin', 'advocate', 'staff'), BOSS = L.need('admin', 'advocate');
  const clientOk = (t, id) => !id || db.prepare('SELECT 1 FROM clients WHERE id=? AND tenant_id=?').get(id, t);

  app.get('/api/register', OFFICE, (req, res) => {
    const t = T(req), w = ['r.tenant_id=?'], a = [t];
    if (req.query.kind === 'in' || req.query.kind === 'out') { w.push('r.kind=?'); a.push(req.query.kind); }
    if (L.int(req.query.client_id)) { w.push('r.client_id=?'); a.push(L.int(req.query.client_id)); }
    if (L.isDate(req.query.from)) { w.push('r.entry_date>=?'); a.push(req.query.from); }
    if (L.isDate(req.query.to)) { w.push('r.entry_date<=?'); a.push(req.query.to); }
    const q = L.str(req.query.q, 80); if (q) { w.push('(r.no LIKE ? OR r.party LIKE ? OR r.subject LIKE ? OR r.their_ref LIKE ? OR r.tracking LIKE ? OR c.name LIKE ?)'); a.push(...Array(6).fill('%' + q + '%')); }
    res.json(db.prepare(`SELECT r.*, c.name AS client_name, m.file_no FROM register r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN matters m ON m.id=r.matter_id
      WHERE ${w.join(' AND ')} ORDER BY COALESCE(r.entry_date,'') DESC, r.id DESC LIMIT 1000`).all(...a));
  });

  app.get('/api/register/format', OFFICE, (req, res) => {
    const t = T(req), out = {};
    for (const k of ['in', 'out']) { const fmt = fmtOf(t, k), year = new Date().getFullYear(), ck = yearly(fmt) ? year : 0; const row = db.prepare('SELECT n FROM counters WHERE tenant_id=? AND kind=? AND year=?').get(t, 'reg_' + k, ck); out[k] = { fmt, next: (row ? row.n : 0) + 1, example: render(t, fmt, (row ? row.n : 0) + 1, year) }; }
    res.json(out);
  });
  // restructure the numbering: pattern with {P} (firm prefix) {YYYY} {YY} {N:4} (running number, 4 digits) and the number to continue from
  app.put('/api/register/format', BOSS, (req, res) => {
    const t = T(req), kind = ckind(req.body.kind), fmt = L.str(req.body.fmt, 80) || DEF[kind];
    if (!L.must(res, /\{N(:\d+)?\}/.test(fmt), 'The pattern must contain {N} or {N:4} for the running number.')) return;
    AI.setS(t, 'reg_fmt_' + kind, fmt);
    const next = L.int(req.body.next);
    if (next && next > 0) { const year = new Date().getFullYear(), ck = yearly(fmt) ? year : 0; db.prepare('INSERT INTO counters(tenant_id,kind,year,n) VALUES (?,?,?,?) ON CONFLICT(tenant_id,kind,year) DO UPDATE SET n=excluded.n').run(t, 'reg_' + kind, ck, next - 1); }
    audit(t, req.user.id, 'register_format', 'register', 0, kind + ': ' + fmt, L.ip(req));
    res.json({ ok: true, example: render(t, fmt, next || 1, new Date().getFullYear()) });
  });

  app.post('/api/register', OFFICE, (req, res) => {
    const t = T(req), kind = ckind(req.body.kind), f = clean(req.body), clientId = L.int(req.body.client_id), matterId = L.int(req.body.matter_id);
    if (!clientOk(t, clientId)) return res.status(400).json({ error: 'Choose a client from the list.' });
    if (matterId && !db.prepare('SELECT 1 FROM matters WHERE id=? AND tenant_id=?').get(matterId, t)) return res.status(400).json({ error: 'Case not found.' });
    if (!f.entry_date) f.entry_date = new Date().toISOString().slice(0, 10);
    let no = L.str(req.body.no, 80);
    if (no) { if (db.prepare('SELECT 1 FROM register WHERE tenant_id=? AND kind=? AND no=?').get(t, kind, no)) return res.status(409).json({ error: `${kind === 'in' ? 'Inward' : 'Outward'} No. ${no} is already used.` }); }
    else no = generate(t, kind, f.entry_date);
    const cols = ['tenant_id', 'kind', 'no', 'client_id', 'matter_id', 'created_by', ...Object.keys(f)];
    const r = db.prepare(`INSERT INTO register(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(t, kind, no, clientId, matterId, req.user.id, ...Object.values(f));
    audit(t, req.user.id, 'register_added', 'register', r.lastInsertRowid, kind + ' ' + no, L.ip(req));
    res.json({ id: r.lastInsertRowid, no });
  });

  app.patch('/api/register/:id', OFFICE, (req, res) => {
    const t = T(req), row = db.prepare('SELECT * FROM register WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const f = clean(req.body), set = [], a = [];
    if (req.body.no !== undefined) {
      const no = L.str(req.body.no, 80); if (!no) return res.status(400).json({ error: 'The number cannot be empty.' });
      if (no !== row.no && db.prepare('SELECT 1 FROM register WHERE tenant_id=? AND kind=? AND no=? AND id<>?').get(t, row.kind, no, row.id)) return res.status(409).json({ error: `No. ${no} is already used.` });
      set.push('no=?'); a.push(no);
    }
    if (req.body.client_id !== undefined) { const c = L.int(req.body.client_id); if (!clientOk(t, c)) return res.status(400).json({ error: 'Choose a client from the list.' }); set.push('client_id=?'); a.push(c); }
    if (req.body.matter_id !== undefined) { const m = L.int(req.body.matter_id); if (m && !db.prepare('SELECT 1 FROM matters WHERE id=? AND tenant_id=?').get(m, t)) return res.status(400).json({ error: 'Case not found.' }); set.push('matter_id=?'); a.push(m); }
    for (const [k, v] of Object.entries(f)) { set.push(k + '=?'); a.push(v); }
    if (!set.length) return res.json({ ok: true });
    db.prepare(`UPDATE register SET ${set.join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...a, row.id);
    res.json({ ok: true });
  });

  app.delete('/api/register/:id', BOSS, (req, res) => {
    const t = T(req), row = db.prepare('SELECT * FROM register WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    db.prepare('DELETE FROM register WHERE id=?').run(row.id);
    audit(t, req.user.id, 'register_deleted', 'register', row.id, row.kind + ' ' + row.no, L.ip(req));
    res.json({ ok: true });
  });
};
