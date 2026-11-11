'use strict';
// Case history: a precise dated chronology of a case (particulars, present position, every hearing and order, pending work,
// documents on file). Download as Word or PDF at any time; a copy is also kept in Files → Case history and refreshed each night.
const crypto = require('crypto');
const L = require('../lib');
const AI = require('../aicore');
const X = require('../exportdoc');
const { db, audit } = L;
const { dmy } = require('../ecourtpdf');

db.exec('CREATE TABLE IF NOT EXISTS case_history_files (matter_id INTEGER NOT NULL, fmt TEXT NOT NULL, node_id INTEGER, name TEXT, hash TEXT, saved_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(matter_id,fmt))');
let APP = null;
const safe = (s, n = 90) => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const d8 = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');

function historySpec(t, m) {
  const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '', cl = db.prepare('SELECT name FROM clients WHERE id=?').get(m.client_id) || {};
  const link = db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id); let snap = null, b = null, orders = [];
  if (link && link.snapshot) { try { const EC = require('./ecourts'); snap = JSON.parse(link.snapshot); b = EC.brief(snap); orders = EC.orderList(snap); } catch (e) {} }
  const saved = new Map(db.prepare("SELECT key,name FROM ecourt_files WHERE matter_id=? AND key<>'summary'").all(m.id).map((r) => [r.key, r.name])), key = (o) => String(o.file || o.url || '').trim();
  const hearings = db.prepare('SELECT hearing_date,purpose,outcome,next_date,source FROM hearings WHERE matter_id=? ORDER BY hearing_date, id').all(m.id);
  const ev = [];
  if (m.created_at) ev.push([d8(m.created_at), 'File opened', `File no. ${m.file_no}`]);
  if (b && b.filing_date) ev.push([b.filing_date, 'Case filed', [b.case_type, b.case_number].filter(Boolean).join(' ')]);
  for (const h of hearings) ev.push([d8(h.hearing_date), 'Hearing', [h.purpose, h.outcome && 'Outcome: ' + h.outcome, h.next_date && 'Next date: ' + dmy(h.next_date)].filter(Boolean).join('\n')]);
  for (const o of orders) ev.push([d8(o.date), o.kind || 'Order', [o.type, saved.get(key(o)) && 'Copy in Files: ' + saved.get(key(o))].filter(Boolean).join('\n')]);
  if (b && b.decision_date) ev.push([b.decision_date, 'Decided / disposed', b.status || '']);
  const rows = ev.filter((e) => e[0]).sort((a, c) => a[0].localeCompare(c[0])).filter((e, i, a) => !a.slice(0, i).some((p) => p[0] === e[0] && p[1] === e[1] && p[2] === e[2])).map((e) => [dmy(e[0]), e[1], e[2]]);
  const tasks = db.prepare("SELECT t.title,t.due_date,t.priority,u.name who FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.matter_id=? AND t.status<>'done' ORDER BY COALESCE(t.due_date,'9999')").all(m.id);
  let docs = []; try { docs = require('./caseargs').caseFiles(t, m).filter((f) => !/^Order\d+_/.test(f.name)).slice(0, 60); } catch (e) {}
  const adv = m.assigned_to && (db.prepare('SELECT name FROM users WHERE id=?').get(m.assigned_to) || {}).name;
  const next = b && b.next_date ? b.next_date : (hearings.filter((h) => h.next_date).map((h) => h.next_date).sort().pop() || '');
  const today = new Date().toISOString().slice(0, 10);
  return { firm, title: 'Case History', landscape: false, subtitle: `${cl.name || ''} — ${m.title}. Compiled ${dmy(today)} from the firm's records${b ? ' and the eCourts record' : ''}.`, sections: [
    { heading: 'Case particulars', kv: [['File no.', m.file_no], ['Client', cl.name], ['Matter', m.title], ['Forum', m.forum], ['Case no.', m.case_no || (b && b.case_number)], ['CNR', link && link.cnr], ['Petitioner(s)', b && b.petitioners.join('; ')], ['Respondent(s)', (b && b.respondents.join('; ')) || m.opposite_party],
      ['Judge(s)', b && b.judges.join('; ')], ['Advocate in charge', adv], ['Opened', dmy(d8(m.created_at))]] },
    ...(m.summary ? [{ heading: 'Brief facts', text: m.summary }] : []),
    { heading: 'Present position', kv: [['Status', (b && b.status) || m.status], ['Stage', m.stage], ['Last hearing', b && b.last_date && dmy(b.last_date)], ['Next hearing', next && dmy(next)], ['Purpose', b && b.purpose]] },
    { heading: `Chronology (${rows.length} entries)`, cols: [{ h: 'Date', w: 1.1 }, { h: 'Event', w: 1.5 }, { h: 'Details', w: 4 }], rows },
    { heading: 'Pending work', cols: [{ h: 'Task', w: 4 }, { h: 'Due', w: 1.2 }, { h: 'With', w: 1.5 }], rows: tasks.map((x) => [x.title, x.due_date ? dmy(x.due_date) : '', x.who || '']) },
    ...(docs.length ? [{ heading: `Documents on file (${docs.length})`, cols: [{ h: 'Document', w: 4 }, { h: 'Folder', w: 3 }], rows: docs.map((f) => [f.name, f.path]) }] : []) ] };
}
const hashOf = (spec) => crypto.createHash('sha1').update(JSON.stringify(spec.sections)).digest('hex');

// keeps one current Word and one PDF in the client's Files → Case history → <file no>; the older copies move to the bin
async function saveHistory(t, m, { force = false, userId = null } = {}) {
  const h = APP && APP.locals.fsHelpers; if (!h) return { skipped: true };
  const spec = historySpec(t, m), hash = hashOf(spec), have = db.prepare('SELECT * FROM case_history_files WHERE matter_id=?').all(m.id);
  if (!force && have.length === 2 && have.every((r) => r.hash === hash)) return { unchanged: true };
  h.seed(t, m.client_id, userId); const parent = h.ensurePath(t, m.client_id, ['Case history'], userId, false);
  for (const fmt of ['docx', 'pdf']) {
    const prev = have.find((r) => r.fmt === fmt); if (prev && prev.node_id) db.prepare("UPDATE fs_nodes SET deleted_at=datetime('now') WHERE id=? AND tenant_id=?").run(prev.node_id, t);
    const r = await h.putFile(t, { clientId: m.client_id, parent, name: `Case history - ${safe(m.file_no, 40)} - ${safe(m.title, 50)}.${fmt}`, buffer: await X.build(spec, fmt), mime: X.MIME[fmt], uid: userId, matterId: m.id });
    db.prepare('INSERT OR REPLACE INTO case_history_files(matter_id,fmt,node_id,name,hash,saved_at) VALUES (?,?,?,?,?,datetime(\'now\'))').run(m.id, fmt, r.id, r.name, hash);
  }
  return { ok: true };
}
const refreshIfSaved = async (t, m) => { if (db.prepare('SELECT 1 FROM case_history_files WHERE matter_id=?').get(m.id)) return saveHistory(t, m); };

let running = false;
async function nightly() {
  if (running) return; running = true;
  try { for (const m of db.prepare("SELECT m.* FROM matters m JOIN case_history_files c ON c.matter_id=m.id WHERE m.status='open' GROUP BY m.id").all()) { try { await saveHistory(m.tenant_id, m); } catch (e) { console.error('history', m.file_no, e.message); } } } finally { running = false; }
}
const startWorker = () => {
  const tick = () => { const n = new Date(Date.now() + 5.5 * 3600e3), day = n.toISOString().slice(0, 10); if (n.getUTCHours() >= 4 && AI.getS(0, 'history_last_day', '') !== day) { AI.setS(0, 'history_last_day', day); nightly().catch((e) => console.error('history', e.message)); } };
  const a = setTimeout(tick, 5 * 60 * 1000), b = setInterval(tick, 10 * 60 * 1000); a.unref && a.unref(); b.unref && b.unref();
};

module.exports = (app) => {
  APP = app;
  const T = (req) => req.user.tenant_id, OFF = L.need('admin', 'advocate', 'staff');
  const matterOf = (req) => { const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req)); return m && (!app.locals.matterLevel || app.locals.matterLevel(req, m)) ? m : undefined; };
  app.get('/api/matters/:id/history/info', OFF, (req, res) => { const m = matterOf(req); if (!m) return res.status(404).json({ error: 'Not found.' }); const r = db.prepare('SELECT MAX(saved_at) at, MAX(name) name FROM case_history_files WHERE matter_id=?').get(m.id); res.json({ saved: !!(r && r.at), saved_at: r && r.at }); });
  app.get('/api/matters/:id/history/:fmt', OFF, async (req, res) => {
    const m = matterOf(req), f = req.params.fmt; if (!m || !['docx', 'pdf'].includes(f)) return res.status(404).json({ error: 'Not found.' });
    try { const buf = await X.build(historySpec(T(req), m), f); audit(T(req), req.user.id, 'case_history_download', 'matter', m.id, f, L.ip(req)); X.send(res, buf, f, `Case history - ${safe(m.file_no, 40)} - ${safe(m.title, 50)}`); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Could not make the file: ' + String(e.message).slice(0, 150) }); }
  });
  app.post('/api/matters/:id/history/save', OFF, async (req, res) => {
    const m = matterOf(req); if (!m) return res.status(404).json({ error: 'Not found.' });
    try { const r = await saveHistory(T(req), m, { force: true, userId: req.user.id }); audit(T(req), req.user.id, 'case_history_saved', 'matter', m.id, null, L.ip(req)); res.json({ ok: true, ...r }); } catch (e) { res.status(500).json({ error: 'Could not save: ' + String(e.message).slice(0, 150) }); }
  });

  // letters (outward correspondence): Word or PDF on the firm's letter pad
  app.get('/api/letters/:id/download/:fmt', L.requireLogin, async (req, res) => {
    const t = T(req), f = req.params.fmt, l = db.prepare('SELECT * FROM letters WHERE id=? AND tenant_id=?').get(L.int(req.params.id), t);
    if (!l || !['docx', 'pdf'].includes(f)) return res.status(404).json({ error: 'Not found.' });
    if (req.user.role === 'client' && (l.client_id !== req.user.client_id || !l.client_visible || l.status !== 'sent')) return res.status(404).json({ error: 'Not found.' });
    if (req.user.role === 'telecaller') return res.status(403).json({ error: 'Not allowed.' });
    try {
      const H = require('../drafthouse'), DOC = require('../draftdoc'), fmt = { ...H.PROFILES.letter, page: 'A4', profile: 'letter' }; let lh = null;
      try { const p = require('./template').publicAsset(t, 'letterhead'); const tpl = db.prepare('SELECT settings FROM tenant_templates WHERE tenant_id=?').get(t); const top = Number(JSON.parse((tpl && tpl.settings) || '{}').top_mm) || 50; if (p) lh = { path: p, topMm: top }; } catch (e) {}
      const sg = AI.firmInfo(t).signatory, text = `@L Ref. No. ${l.ref_no || 'DRAFT'}\n@R Date: ${dmy(d8(l.sent_at || l.created_at))}\n\n@L To,\n@B ${l.to_name}\n\n@B Subject: ${l.subject}\n\n${l.body}\n\n${sg ? '@R ' + sg : ''}`;
      const buf = f === 'pdf' ? Buffer.from((await DOC.toPdf(text, fmt, { letterhead: lh })).bytes) : await DOC.toDocx(text, fmt, { title: l.subject, author: AI.firmInfo(t).name });
      audit(t, req.user.id, 'letter_download', 'letter', l.id, f, L.ip(req)); X.send(res, buf, f, `${l.ref_no || 'Letter'} - ${safe(l.subject, 60)}`);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Could not make the file: ' + String(e.message).slice(0, 150) }); }
  });
  // generic Word / PDF export of a table the person is looking at (registers, chat and activity records)
  app.post('/api/export/:fmt', OFF, async (req, res) => {
    const f = req.params.fmt, b = req.body || {}; if (!['docx', 'pdf'].includes(f)) return res.status(400).json({ error: 'Choose docx or pdf.' });
    if (['chat', 'activity'].includes(b.restricted) && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the Admin may save this record.' });
    const cols = (Array.isArray(b.cols) ? b.cols : []).slice(0, 14).map((c) => ({ h: L.str(c && c.h != null ? c.h : c, 80), w: Number(c && c.w) || 1 })), rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000).map((r) => cols.map((_, i) => L.str((Array.isArray(r) ? r[i] : '') == null ? '' : (Array.isArray(r) ? r[i] : ''), 1500)));
    if (!cols.length) return res.status(400).json({ error: 'Nothing to export.' });
    try {
      const spec = { firm: (db.prepare('SELECT name FROM tenants WHERE id=?').get(T(req)) || {}).name || '', title: L.str(b.title, 120) || 'Export', subtitle: L.str(b.subtitle, 250), landscape: cols.length > 4, sections: [{ cols, rows }] };
      audit(T(req), req.user.id, 'export_' + f, 'export', 0, spec.title.slice(0, 60), L.ip(req)); X.send(res, await X.build(spec, f), f, spec.title);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Could not make the file.' }); }
  });
};
Object.assign(module.exports, { historySpec, saveHistory, refreshIfSaved, startWorker, nightly });
