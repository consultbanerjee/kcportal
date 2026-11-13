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
