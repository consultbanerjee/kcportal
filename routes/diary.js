'use strict';
// CASE DIARY: a dated, step-by-step record of each case - office meetings and advice, notices, filing, copy service and the court's own dates and orders.
// Court entries are read in from the court data already stored for the case (no extra cost); every entry can be added, edited, reordered or removed by hand.
// Notice reply clock: when a notice is marked sent, the reply period runs; if it ends with no reply, the diary says so and the holder of the file is alerted.
// Written once for every firm.
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore'); const WA = require('./whatsapp');
db.exec(`CREATE TABLE IF NOT EXISTS matter_diary (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER NOT NULL, entry_date TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, note TEXT, link TEXT,
  source TEXT NOT NULL DEFAULT 'manual', ext_key TEXT, pos REAL NOT NULL DEFAULT 0, client_visible INTEGER NOT NULL DEFAULT 0, meta TEXT, by_user INTEGER, by_name TEXT, edited_at TEXT, deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_diary_ext ON matter_diary(matter_id, ext_key) WHERE ext_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS ix_diary_m ON matter_diary(matter_id, pos);
  CREATE TABLE IF NOT EXISTS matter_diary_log (id INTEGER PRIMARY KEY, entry_id INTEGER, user_id INTEGER, action TEXT, old TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);`);

// kind -> [label, group]. Groups: office / papers / court / note
const KINDS = {
  meeting: ['First meeting / meeting', 'office'], advice: ['Advice given', 'office'], no_reply: ['No reply received', 'office'], advised_file: ['Client advised to file', 'office'],
  notice_drafted: ['Notice drafted', 'papers'], notice_sent: ['Notice sent', 'papers'], notice_received: ['Notice delivered', 'papers'], reply: ['Reply received', 'papers'],
  case_drafted: ['Case drafted', 'papers'], filed: ['Case filed', 'papers'], copy_prepared: ['Copy service prepared', 'papers'], copy_served: ['Copy service filed', 'papers'],
  hearing: ['Hearing', 'court'], order: ['Order', 'court'], next_date: ['Next date', 'court'], note: ['Own note', 'note'],
};
const STAGES = ['Consultation', 'Notice', 'Reply period', 'Filing', 'Listed in court', 'Disposed'];
const STAGE_OF = { meeting: 0, advice: 0, notice_drafted: 1, notice_sent: 1, notice_received: 1, reply: 2, no_reply: 2, advised_file: 3, case_drafted: 3, filed: 3, copy_prepared: 4, copy_served: 4, hearing: 4, order: 4, next_date: 4 };
const T = (req) => req.user.tenant_id, isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const replyDays = (t) => Math.max(1, Math.min(180, L.int(AI.getS(t, 'diary_reply_days', '15'), 15)));
const J = (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };

// where a new entry goes: just before the first entry dated later, else at the end (positions are spaced so any entry can be slotted between two others)
function posFor(mid, date) {
  const rows = db.prepare('SELECT entry_date d, pos FROM matter_diary WHERE matter_id=? ORDER BY pos').all(mid); if (!rows.length) return 1;
  const k = rows.findIndex((r) => r.d > date); if (k < 0) return rows[rows.length - 1].pos + 1; if (k === 0) return rows[0].pos - 1; return (rows[k - 1].pos + rows[k].pos) / 2;
}
function put(t, mid, e) {
  const r = db.prepare('INSERT INTO matter_diary(tenant_id,matter_id,entry_date,kind,title,note,link,source,ext_key,pos,client_visible,meta,by_user,by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(t, mid, e.date, e.kind, e.title || null, e.note || null, e.link || null, e.source || 'manual', e.ext || null, posFor(mid, e.date), e.visible ? 1 : 0, e.meta ? JSON.stringify(e.meta) : null, e.by || null, e.byName || null);
  return r.lastInsertRowid;
}
// read the court's dates and orders for this case into the diary (once each; an entry removed by the office is not brought back)
function syncCourt(t, m) {
  const link = db.prepare('SELECT snapshot FROM matter_ecourt WHERE matter_id=?').get(m.id), E = require('./ecourts'); let n = 0;
  const add = (ext, e) => { if (db.prepare('SELECT 1 FROM matter_diary WHERE matter_id=? AND ext_key=?').get(m.id, ext)) return; put(t, m.id, { ...e, source: 'court', ext, byName: 'eCourts' }); n++; };
  for (const h of db.prepare("SELECT * FROM hearings WHERE matter_id=? AND source<>'manual'").all(m.id)) add('h:' + h.hearing_date, { date: h.hearing_date, kind: 'hearing', title: h.purpose || 'Hearing', note: [h.outcome, h.next_date ? 'Next date: ' + h.next_date : ''].filter(Boolean).join(' — ') });
  if (link && link.snapshot) {
    let d = null; try { d = JSON.parse(link.snapshot); } catch (e) { /* ignore */ }
    if (d) {
      const I = E.identity(d);
      if (I.case_date || I.filed) add('filed', { date: String(I.case_date || I.filed).slice(0, 10), kind: 'filed', title: 'Petition filed', note: [I.court, I.case_no, I.cnr ? 'CNR ' + I.cnr : ''].filter(Boolean).join(' · ') });
      E.orderList(d).forEach((o, i) => { if (o.date) add(`o:${o.date}:${i}`, { date: o.date, kind: 'order', title: o.kind || 'Order', note: (o.summary || []).join(' ') || (o.next ? 'Next date: ' + o.next : '') }); });
    }
  }
  return n;
}
function stageOf(mid) {
  let cur = -1; for (const r of db.prepare('SELECT kind FROM matter_diary WHERE matter_id=? AND deleted_at IS NULL').all(mid)) cur = Math.max(cur, STAGE_OF[r.kind] ?? -1);
  const ec = db.prepare('SELECT status FROM matter_ecourt WHERE matter_id=?').get(mid); if (ec) { cur = Math.max(cur, 4); if (/dispos/i.test(ec.status || '')) cur = 5; }
  return cur;
}
// the reply clock of a sent notice
function clockOf(r) { const m = J(r.meta); return m.due ? { due: m.due, days: m.days, over: !m.closed && m.due < today(), left: Math.round((new Date(m.due) - new Date(today())) / 864e5), closed: !!m.closed } : null; }

async function sendNote(t, u, subject, text) {
  if (!u) return;
  try { const M = require('./aimail'); if (u.email && M.mailReady(t)) await M.sendMail(t, { to: u.email, subject, text }); } catch (e) { /* best effort */ }
  try { if (u.phone && WA.configured(t) && WA.normPhone(u.phone)) await WA.sendToStaff(t, u.phone, [u.name, text.split('\n').filter(Boolean)[1] || subject, (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '']); } catch (e) { /* best effort */ }
}
async function tick() {
  for (const r of db.prepare("SELECT * FROM matter_diary WHERE kind='notice_sent' AND deleted_at IS NULL AND meta IS NOT NULL").all()) {
    const mt = J(r.meta); if (!mt.due || mt.closed || mt.alerted || mt.due >= today()) continue;
    const m = db.prepare("SELECT * FROM matters WHERE id=? AND status<>'deleted'").get(r.matter_id); if (!m) continue;
    // a reply or "no reply" entry after the notice already settles it
    mt.alerted = 1; db.prepare('UPDATE matter_diary SET meta=? WHERE id=?').run(JSON.stringify(mt), r.id);
    put(r.tenant_id, m.id, { date: mt.due, kind: 'no_reply', title: 'No reply received', note: `The ${mt.days}-day reply period for the notice sent on ${r.entry_date} is over and no reply has been recorded. Advise the client about filing.`, source: 'system', byName: 'Portal' });
    const u = m.assigned_to && db.prepare('SELECT id,name,email,phone FROM users WHERE id=?').get(m.assigned_to);
    await sendNote(r.tenant_id, u, `Reply period over: ${m.file_no}`, `Dear ${u ? u.name : ''},\nThe reply period for the notice in ${m.file_no} — ${m.title} ended on ${mt.due} with no reply recorded. Please advise the client about filing.\n${process.env.PUBLIC_URL || ''}/#/matter/${m.id}`);
  }
}
let timer; function startWorker() { timer = setInterval(() => tick().catch((e) => console.error('diary', e.message)), 60 * 60 * 1000); if (timer.unref) timer.unref(); setTimeout(() => tick().catch(() => {}), 40000).unref(); }

module.exports = (app) => {
  const OFF = L.need('admin', 'advocate', 'staff', 'telecaller', 'accounts');
  const matter = (req, res, need) => {
    const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req));
    if (!m || !app.locals.matterLevel(req, m)) { res.status(404).json({ error: 'Not found.' }); return null; }
    if (need && !app.locals.matterAtLeast(req, m, need)) { res.status(403).json({ error: 'You have view-only access to this case.' }); return null; }
    return m;
  };
  const entry = (req, res, need) => { const e = db.prepare('SELECT * FROM matter_diary WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(L.int(req.params.id), T(req)); const m = e && db.prepare('SELECT * FROM matters WHERE id=?').get(e.matter_id);
    if (!e || !m || !app.locals.matterAtLeast(req, m, need)) { res.status(e ? 403 : 404).json({ error: e ? 'You cannot change this entry.' : 'Not found.' }); return []; } return [e, m]; };
  const log = (e, req, action) => db.prepare('INSERT INTO matter_diary_log(entry_id,user_id,action,old) VALUES (?,?,?,?)').run(e.id, req.user.id, action, JSON.stringify({ date: e.entry_date, kind: e.kind, title: e.title, note: e.note }));
  const shape = (r, cli) => ({ id: r.id, date: r.entry_date, kind: r.kind, label: (KINDS[r.kind] || [r.kind])[0], group: (KINDS[r.kind] || [0, 'note'])[1], title: r.title, note: r.note, link: cli ? null : r.link, source: r.source,
    visible: !!r.client_visible, by: cli ? null : r.by_name, clock: r.kind === 'notice_sent' && !cli ? clockOf(r) : null, edited: !!r.edited_at });

  app.get('/api/matters/:id/diary', L.requireLogin, (req, res) => {
    const m = matter(req, res); if (!m) return; const cli = req.user.role === 'client';
    if (!cli) { try { syncCourt(T(req), m); } catch (e) { console.error('diary sync', e.message); } }
    let rows = db.prepare('SELECT * FROM matter_diary WHERE matter_id=? AND deleted_at IS NULL ORDER BY pos, id').all(m.id); if (cli) rows = rows.filter((r) => r.client_visible);
    res.json({ entries: rows.map((r) => shape(r, cli)), stages: STAGES, stage: cli ? null : stageOf(m.id), kinds: Object.entries(KINDS).map(([k, v]) => ({ kind: k, label: v[0], group: v[1] })), reply_days: replyDays(T(req)),
      can_edit: !cli && app.locals.matterAtLeast(req, m, 'work') });
  });
  app.post('/api/matters/:id/diary', OFF, (req, res) => {
    const m = matter(req, res, 'work'); if (!m) return; const b = req.body || {}, kind = KINDS[b.kind] ? b.kind : null, date = String(b.date || '').slice(0, 10);
    if (!L.must(res, kind && isDate(date), 'Choose the date and the type of entry.')) return;
    if (!L.must(res, L.str(b.note, 3000) || L.str(b.title, 200), 'Write the entry.')) return;
    let meta = null; if (kind === 'notice_sent') { const days = Math.max(1, Math.min(180, L.int(b.reply_days, replyDays(T(req))))); meta = { days, due: addDays(date, days) }; }
    const id = put(T(req), m.id, { date, kind, title: L.str(b.title, 200), note: L.str(b.note, 3000), link: L.str(b.link, 300), visible: !!b.visible, meta, by: req.user.id, byName: req.user.name });
    // delivery date starts the reply clock; a reply (or advice to file) stops it
    const sent = () => db.prepare("SELECT * FROM matter_diary WHERE matter_id=? AND kind='notice_sent' AND deleted_at IS NULL ORDER BY pos DESC, id DESC").get(m.id);
    if (kind === 'notice_received') { const s = sent(); if (s) { const mt = J(s.meta), days = mt.days || replyDays(T(req)); db.prepare('UPDATE matter_diary SET meta=? WHERE id=?').run(JSON.stringify({ ...mt, days, due: addDays(date, days), alerted: 0 }), s.id); } }
    if (kind === 'reply') { const s = sent(); if (s) db.prepare('UPDATE matter_diary SET meta=? WHERE id=?').run(JSON.stringify({ ...J(s.meta), closed: 1 }), s.id); }
    D.audit(T(req), req.user.id, 'diary_added', 'matter', m.id, kind, req.ip); res.json({ ok: true, id });
  });
  app.put('/api/diary/:id', OFF, (req, res) => {
    const [e, m] = entry(req, res, 'work'); if (!e) return; const b = req.body || {}, court = e.source !== 'manual';
    log(e, req, 'edit');
    const date = !court && isDate(b.date) ? b.date : e.entry_date, kind = !court && KINDS[b.kind] ? b.kind : e.kind;
    db.prepare('UPDATE matter_diary SET entry_date=?, kind=?, title=?, note=?, link=?, client_visible=?, edited_at=? WHERE id=?').run(date, kind, court ? e.title : L.str(b.title ?? e.title, 200), L.str(b.note ?? e.note, 3000), L.str(b.link ?? e.link, 300), b.visible === undefined ? e.client_visible : (b.visible ? 1 : 0), new Date().toISOString(), e.id);
    if (e.kind === 'notice_sent' && date !== e.entry_date) { const mt = J(e.meta); if (mt.days) db.prepare('UPDATE matter_diary SET meta=? WHERE id=?').run(JSON.stringify({ ...mt, due: addDays(date, mt.days), alerted: 0 }), e.id); }
    res.json({ ok: true });
  });
  app.delete('/api/diary/:id', OFF, (req, res) => {
    const [e] = entry(req, res, 'work'); if (!e) return;
    if (e.source !== 'manual' && e.by_user !== req.user.id && req.user.role !== 'admin') { const m = db.prepare('SELECT * FROM matters WHERE id=?').get(e.matter_id); if (!app.locals.matterAtLeast(req, m, 'full')) return res.status(403).json({ error: 'Only someone with full access can remove a court entry.' }); }
    log(e, req, 'delete'); db.prepare('UPDATE matter_diary SET deleted_at=? WHERE id=?').run(new Date().toISOString(), e.id); res.json({ ok: true });
  });
  // your own order: send the entry ids in the order wanted (ids you did not send keep their place at the end)
  app.put('/api/matters/:id/diary/order', OFF, (req, res) => {
    const m = matter(req, res, 'work'); if (!m) return; const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map((x) => L.int(x));
    const have = new Set(db.prepare('SELECT id FROM matter_diary WHERE matter_id=? AND deleted_at IS NULL').all(m.id).map((x) => x.id)), seq = ids.filter((x, i) => have.has(x) && ids.indexOf(x) === i);
    const rest = db.prepare('SELECT id FROM matter_diary WHERE matter_id=? AND deleted_at IS NULL ORDER BY pos, id').all(m.id).map((x) => x.id).filter((x) => !seq.includes(x));
    const up = db.prepare('UPDATE matter_diary SET pos=? WHERE id=?'); db.exec('BEGIN'); try { [...seq, ...rest].forEach((x, i) => up.run(i + 1, x)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  });
  app.post('/api/matters/:id/diary/sort', OFF, (req, res) => {
    const m = matter(req, res, 'work'); if (!m) return; const up = db.prepare('UPDATE matter_diary SET pos=? WHERE id=?');
    db.exec('BEGIN'); try { db.prepare('SELECT id FROM matter_diary WHERE matter_id=? AND deleted_at IS NULL ORDER BY entry_date, id').all(m.id).forEach((x, i) => up.run(i + 1, x.id)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  });
  app.put('/api/diary/settings/reply-days', L.need('admin'), (req, res) => { AI.setS(T(req), 'diary_reply_days', String(Math.max(1, Math.min(180, L.int((req.body || {}).days, 15))))); res.json({ ok: true }); });
};
Object.assign(module.exports, { tick, startWorker, syncCourt, KINDS });
