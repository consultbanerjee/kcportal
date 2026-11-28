'use strict';
// CASE LAW: the portal's window onto the separate KC Search service (search.kclegal.us). The service keeps its own judgments database; this file only
// asks it questions (server to server, with a private key) and passes the answers on. Same for every firm; gated by the Research Desk switches.
const rateLimit = require('express-rate-limit');
const L = require('../lib'); const D = require('../db'); const db = D.db; const EX = require('../exportdoc'); const AI = require('../aicore');
const T = (req) => req.user.tenant_id;
const URLB = () => String(process.env.SEARCH_URL || 'http://search:3100').replace(/\/+$/, ''), KEY = () => process.env.SEARCH_API_KEY || '';
const configured = () => !!KEY();
const CREDIT = 'Judgment data: Indian High Court Judgments and Indian Supreme Court Judgments, compiled by Dattam Labs from the eCourts and Supreme Court websites, CC-BY-4.0.';
async function sf(path, ms = 15000) {
  if (!configured()) { const e = new Error('The case-law database is not connected yet.'); e.status = 503; throw e; }
  const r = await fetch(URLB() + path, { headers: { 'x-api-key': KEY() }, signal: AbortSignal.timeout(ms) }).catch(() => { const e = new Error('The case-law database did not answer. Please try again shortly.'); e.status = 502; throw e; });
  return r;
}
// the service marks hits with <mark>; everything else is escaped so nothing from a judgment can run in the page
const safeSnip = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>').slice(0, 1200);
const okFolder = (f) => /^[A-Za-z]{2,12}$/.test(String(f)), okId = (i) => /^\d{1,12}$/.test(String(i));

module.exports = (app) => {
  const FO = require('./research').firmOn;
  const OFF = (req, res, next) => (FO(T(req)) ? next() : res.status(403).json({ error: 'The Research Desk has been switched off by your firm.' }));
  const lim = rateLimit({ windowMs: 3600000, limit: 200, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => 'cl' + req.user.id, message: { error: 'Many searches in the last hour. Please try again a little later.' } });
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

  app.get('/api/research/caselaw/status', L.office, OFF, async (req, res) => {
    if (!configured()) return res.json({ on: false, courts: [], credit: CREDIT });
    try { const r = await sf('/api/v1/courts', 6000); const j = await r.json(); res.json({ on: r.ok, courts: j.courts || [], credit: CREDIT }); } catch (e) { res.json({ on: false, courts: [], credit: CREDIT }); }
  });
  app.get('/api/research/caselaw/search', L.office, OFF, lim, async (req, res) => {
    const q = L.str(req.query.q, 300).trim(); if (q.length < 3) return res.json({ results: [], credit: CREDIT });
    const p = new URLSearchParams({ q, limit: String(Math.min(L.int(req.query.limit) || 20, 30)), offset: String(Math.max(L.int(req.query.offset) || 0, 0)), sort: req.query.sort === 'date' ? 'date' : 'rank' });
    const courts = String(req.query.courts || '').split(',').filter(okFolder).slice(0, 40).join(','); if (courts) p.set('courts', courts);
    for (const k of ['year_from', 'year_to']) { const v = L.int(req.query[k]); if (v > 1900 && v < 2100) p.set(k, String(v)); }
    try {
      const r = await sf('/api/v1/search?' + p); const j = await r.json().catch(() => ({})); if (!r.ok) return res.status(502).json({ error: 'The case-law search could not be completed.' });
      res.json({ credit: CREDIT, ms: j.ms, more: !!j.more, courts: j.courts, results: (j.results || []).map((x) => ({ ...x, snip: safeSnip(x.snip) })) });
    } catch (e) { fail(res, e); }
  });
  const getDoc = async (folder, id) => { const r = await sf(`/api/v1/doc/${folder}/${id}`); if (r.status === 404) return null; if (!r.ok) { const e = new Error('Could not read the judgment.'); e.status = 502; throw e; } return (await r.json()).doc; };
  app.get('/api/research/caselaw/doc/:folder/:id', L.office, OFF, lim, async (req, res) => {
    if (!okFolder(req.params.folder) || !okId(req.params.id)) return res.status(400).json({ error: 'Not found.' });
    try { const d = await getDoc(req.params.folder, req.params.id); if (!d) return res.status(404).json({ error: 'Not found.' }); res.json({ credit: CREDIT, doc: { ...d, body: String(d.body || '').slice(0, 300000), raw_html: undefined } }); } catch (e) { fail(res, e); }
  });
  const specOf = (d) => ({ firm: '', title: d.title || 'Judgment', subtitle: [d.court, d.citation, d.decision_date].filter(Boolean).join(' · '), sections: [
    { heading: 'Details', kv: [['Court', d.court], ['Case number', d.case_no], ['Decided on', d.decision_date], ['Judge', d.judge], ['Citation', d.citation], ['Parties', d.parties], ['Disposal', d.disposal]] },
    { heading: 'Judgment', text: d.body ? String(d.body).slice(0, 250000) : 'The full text is not stored in the search database. Open the original judgment from the portal.' },
    { heading: 'Source', text: CREDIT }] });
  // download as Word or PDF. PDF is the original court file when we hold it, otherwise a PDF made from the text.
  app.get('/api/research/caselaw/doc/:folder/:id/:fmt', L.office, OFF, lim, async (req, res) => {
    const { folder, id, fmt } = req.params; if (!okFolder(folder) || !okId(id) || !['docx', 'pdf'].includes(fmt)) return res.status(400).json({ error: 'Choose docx or pdf.' });
    try {
      const d = await getDoc(folder, id); if (!d) return res.status(404).json({ error: 'Not found.' });
      const name = String(d.title || 'judgment').replace(/[^\w .-]/g, '_').slice(0, 80) || 'judgment';
      if (fmt === 'pdf') {
        const r = await sf(`/api/v1/doc/${folder}/${id}/pdf`, 90000).catch(() => null);
        if (r && r.ok) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.subarray(0, 4).toString() === '%PDF') return EX.send(res, buf, 'pdf', name); }
      }
      const spec = specOf(d); if (fmt === 'pdf' && !d.body) return res.status(404).json({ error: 'The original file is not available right now.' });
      return EX.send(res, await EX.build(spec, fmt), fmt, name);
    } catch (e) { fail(res, e); }
  });
  app.post('/api/research/caselaw/to-case', L.office, OFF, async (req, res) => {
    const b = req.body || {}; if (!okFolder(b.folder) || !okId(b.id)) return res.status(400).json({ error: 'Not found.' });
    const m = db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(b.matter_id), T(req));
    if (!m || !app.locals.matterAtLeast(req, m, 'work')) return res.status(404).json({ error: 'Not found.' });
    try {
      const d = await getDoc(b.folder, b.id); if (!d) return res.status(404).json({ error: 'Not found.' });
      const note = ['Judgment — ' + (d.title || ''), [d.court, d.case_no, d.citation, d.decision_date, d.judge].filter(Boolean).join(' · '), '', String(d.body || '').slice(0, 1200)].join('\n').slice(0, 8000);
      db.prepare('INSERT INTO notings(tenant_id,matter_id,user_id,note) VALUES (?,?,?,?)').run(T(req), m.id, req.user.id, note);
      D.audit(T(req), req.user.id, 'caselaw_to_case', 'matter', m.id, String(d.title || '').slice(0, 80), L.ip(req)); res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  // ---- Reading the judgment: the reader's own highlights / underlines (kept per person), annotated copies, filing into a client's Judgements folder ----
  db.exec('CREATE TABLE IF NOT EXISTS cl_marks (tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, folder TEXT NOT NULL, doc_id TEXT NOT NULL, marks TEXT NOT NULL DEFAULT \'[]\', updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(tenant_id,user_id,folder,doc_id))');
  const cleanMarks = (a) => (Array.isArray(a) ? a : []).slice(0, 3000).map((m) => ({ s: parseInt(m && m.s, 10), e: parseInt(m && m.e, 10), k: m && m.k === 'h' ? 'h' : 'u', c: /^#[0-9a-fA-F]{6}$/.test(String(m && m.c)) ? String(m.c) : '#000000' })).filter((m) => Number.isInteger(m.s) && Number.isInteger(m.e) && m.s >= 0 && m.e > m.s && m.e <= 400000);
  const annSpec = (d, marks) => { const sp = specOf(d), body = String(d.body || '').slice(0, 250000); const j = sp.sections.find((x) => x.heading === 'Judgment'); if (j && d.body) { j.text = body; j.marks = cleanMarks(marks).filter((m) => m.s < body.length).map((m) => ({ ...m, e: Math.min(m.e, body.length) })); } return sp; };
  const fname = (d, tail) => (String(d.title || 'judgment').replace(/[^\w .,()-]/g, '_').slice(0, 80).trim() || 'judgment') + (tail || '');
  app.get('/api/research/caselaw/marks/:folder/:id', L.office, OFF, (req, res) => {
    if (!okFolder(req.params.folder) || !okId(req.params.id)) return res.status(400).json({ error: 'Not found.' });
    const r = db.prepare('SELECT marks FROM cl_marks WHERE tenant_id=? AND user_id=? AND folder=? AND doc_id=?').get(T(req), req.user.id, req.params.folder, req.params.id);
    let m = []; try { m = JSON.parse(r ? r.marks : '[]'); } catch (e) {} res.json({ marks: cleanMarks(m) });
  });
  app.put('/api/research/caselaw/marks/:folder/:id', L.office, OFF, (req, res) => {
    if (!okFolder(req.params.folder) || !okId(req.params.id)) return res.status(400).json({ error: 'Not found.' });
    const m = cleanMarks((req.body || {}).marks);
    if (!m.length) db.prepare('DELETE FROM cl_marks WHERE tenant_id=? AND user_id=? AND folder=? AND doc_id=?').run(T(req), req.user.id, req.params.folder, req.params.id);
    else db.prepare('INSERT INTO cl_marks(tenant_id,user_id,folder,doc_id,marks) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,user_id,folder,doc_id) DO UPDATE SET marks=excluded.marks, updated_at=CURRENT_TIMESTAMP').run(T(req), req.user.id, req.params.folder, req.params.id, JSON.stringify(m));
    res.json({ ok: true });
  });
  // the original court PDF when held, otherwise a PDF made from the text
  const pdfOf = async (folder, id, d) => {
    const r = await sf(`/api/v1/doc/${folder}/${id}/pdf`, 90000).catch(() => null);
    if (r && r.ok) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.subarray(0, 4).toString() === '%PDF') return buf; }
    return d.body ? EX.build(specOf(d), 'pdf') : null;
  };
  app.post('/api/research/caselaw/doc/:folder/:id/annotated/:fmt', L.office, OFF, lim, async (req, res) => {
    const { folder, id, fmt } = req.params; if (!okFolder(folder) || !okId(id) || !['docx', 'pdf'].includes(fmt)) return res.status(400).json({ error: 'Choose docx or pdf.' });
    try { const d = await getDoc(folder, id); if (!d) return res.status(404).json({ error: 'Not found.' }); EX.send(res, await EX.build(annSpec(d, (req.body || {}).marks), fmt), fmt, fname(d, ' - marked')); } catch (e) { fail(res, e); }
  });
  // file into a client's folder: Judgements (made if it is missing). Rights are the same as for adding files to that client.
  const clientDir = (req, res) => {
    const cid = L.int((req.body || {}).client_id), t = T(req), H = app.locals.fsHelpers;
    if (!cid || !db.prepare('SELECT 1 FROM clients WHERE id=? AND tenant_id=?').get(cid, t)) { res.status(404).json({ error: 'Choose a client.' }); return null; }
    const lv = app.locals.clientLevel ? app.locals.clientLevel(req, cid) : 'edit'; if (!lv || lv === 'view') { res.status(403).json({ error: 'You are not on a case for this client with rights to add files.' }); return null; }
    if (!H) { res.status(503).json({ error: 'Files are not ready yet.' }); return null; }
    H.seed(t, cid, req.user.id);
    const f = db.prepare("SELECT id FROM fs_nodes WHERE tenant_id=? AND client_id=? AND parent_id IS NULL AND kind='folder' AND deleted_at IS NULL AND lower(name)='judgements'").get(t, cid);
    return { cid, t, H, parent: f ? f.id : H.ensurePath(t, cid, ['Judgements'], req.user.id, false) };
  };
  app.post('/api/research/caselaw/to-client', L.office, OFF, lim, async (req, res) => {
    const b = req.body || {}; if (!okFolder(b.folder) || !okId(b.id)) return res.status(400).json({ error: 'Not found.' });
    const kinds = { pdf: ['pdf', ''], docx: ['docx', ''], annotated_pdf: ['pdf', ' - marked'], annotated_docx: ['docx', ' - marked'] }, k = kinds[b.kind]; if (!k) return res.status(400).json({ error: 'Choose what to save.' });
    const dir = clientDir(req, res); if (!dir) return;
    try {
      const d = await getDoc(b.folder, b.id); if (!d) return res.status(404).json({ error: 'Not found.' });
      let buf; if (b.kind === 'pdf') buf = await pdfOf(b.folder, b.id, d); else if (b.kind === 'docx') buf = await EX.build(specOf(d), 'docx'); else buf = await EX.build(annSpec(d, b.marks), k[0]);
      if (!buf) return res.status(404).json({ error: 'The original file is not available right now.' });
      const r = await dir.H.putFile(dir.t, { clientId: dir.cid, parent: dir.parent, name: fname(d, k[1]) + '.' + k[0], buffer: buf, mime: EX.MIME[k[0]], uid: req.user.id, visible: false });
      D.audit(dir.t, req.user.id, 'caselaw_to_client', 'fs', r.id, r.name.slice(0, 80), L.ip(req)); res.json({ ok: true, name: r.name });
    } catch (e) { fail(res, e); }
  });
  app.post('/api/research/caselaw/note-to-client', L.office, OFF, async (req, res) => {
    const b = req.body || {}, note = L.str(b.note, 20000).trim(); if (!note) return res.status(400).json({ error: 'The note is empty.' });
    const dir = clientDir(req, res); if (!dir) return;
    try {
      const title = L.str(b.title, 200) || 'Judgment';
      const buf = await EX.build({ firm: '', title: 'Note on: ' + title, subtitle: L.str(b.sub, 300), sections: [{ heading: 'Note', text: note }] }, 'docx');
      const r = await dir.H.putFile(dir.t, { clientId: dir.cid, parent: dir.parent, name: (title.replace(/[^\w .,()-]/g, '_').slice(0, 70).trim() || 'judgment') + ' - note.docx', buffer: buf, mime: EX.MIME.docx, uid: req.user.id, visible: false });
      D.audit(dir.t, req.user.id, 'caselaw_note_to_client', 'fs', r.id, r.name.slice(0, 80), L.ip(req)); res.json({ ok: true, name: r.name });
    } catch (e) { fail(res, e); }
  });
  // ---- Super Admin: run the whole judgments engine from inside the portal (no need to open the search service's own admin page) ----
  const SA = L.need('superadmin');
  const sp = async (path, body) => {
    if (!configured()) { const e = new Error('The case-law database is not connected yet.'); e.status = 503; throw e; }
    const r = await fetch(URLB() + '/api/v1/admin' + path, { method: body ? 'POST' : 'GET', headers: { 'x-api-key': KEY(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) }).catch(() => { const e = new Error('The case-law engine did not answer.'); e.status = 502; throw e; });
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'The case-law engine refused this.'); e.status = r.status === 400 ? 400 : 502; throw e; } return j;
  };
  app.get('/api/platform/caselaw/engine', SA, async (req, res) => {
    try { const j = await sp('/state'); delete j.drive.client_id; res.json(j); } catch (e) { fail(res, e); }
  });
  app.post('/api/platform/caselaw/engine/:action', SA, async (req, res) => {
    const a = req.params.action, b = req.body || {};
    try {
      if (a === 'court') { if (!/^[A-Za-z0-9_-]{1,12}$/.test(String(b.code)) || !['off', 'meta', 'full'].includes(b.tier)) return res.status(400).json({ error: 'Bad request.' }); await sp('/court', { code: b.code, tier: b.tier }); }
      else if (a === 'settings') { const o = {}; if (b.auto !== undefined) o.auto = !!b.auto; for (const k of ['hour', 'delay_ms', 'min_free_gb', 'concurrency']) if (b[k] !== undefined) o[k] = L.int(b[k]); await sp('/settings', o); }
      else if (a === 'run') await sp('/run', b.code && /^[A-Za-z0-9_-]{1,12}$/.test(String(b.code)) ? { code: b.code } : {});
      else if (a === 'pause') await sp('/pause', { paused: !!b.paused });
      else if (a === 'stop') await sp('/stop', {});
      else return res.status(404).json({ error: 'Not found.' });
      D.audit(null, req.user.id, 'caselaw_engine_' + a, 'search', 0, JSON.stringify(b).slice(0, 120), L.ip(req)); res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  // One time after this release: the engine updates every day at 3 am India time (most judgments are uploaded by then), two files at once,
  // PDFs stop if the server disk falls below 15 GB free, and a first full update is started so the library is brought up to date.
  setTimeout(async () => {
    try {
      if (!configured() || AI.getS(0, 'cl_engine_cfg', '') === 'v63') return;
      await sp('/settings', { auto: true, hour: 3, concurrency: 2, min_free_gb: 15 }); AI.setS(0, 'cl_engine_cfg', 'v63');
      await sp('/run', {});
    } catch (e) { console.error('caselaw engine config', e.message); }
  }, 120000).unref();
  // used by the AI answer: a few real judgments to read first, so the answer rests on cases that exist
  app.locals.caselawContext = async (q) => {
    if (!configured()) return '';
    try {
      const r = await sf('/api/v1/search?' + new URLSearchParams({ q: String(q).replace(/["()*:^]/g, ' ').slice(0, 200), limit: '4', sort: 'rank' }), 5000); if (!r.ok) return '';
      const j = await r.json(); const rs = (j.results || []).slice(0, 4); if (!rs.length) return '';
      return '\n\nJudgments found in the firm\'s case-law database (these exist; read them before answering and cite them by court, case and date):\n' + rs.map((x, i) => `${i + 1}. ${x.title} — ${x.court || x.folder || ''} — ${x.decision_date || x.year || ''} ${x.citation ? '— ' + x.citation : ''}\n   ${String(x.snip || '').replace(/<[^>]+>/g, '').slice(0, 500)}`).join('\n');
    } catch (e) { return ''; }
  };
};
module.exports.CREDIT = CREDIT;
