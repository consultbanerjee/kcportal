'use strict';
// Daily cause lists from the courts' own websites. Calcutta High Court is built in; other courts, tribunals and forums are added
// by the Super Admin as a "list page + link pattern" (Platform → Server and renewals → Cause list sources). Every list found is
// read once, each firm's open cases are matched by case number (and party name), and every listing is recorded permanently as a
// hearing date on the case. Runs at 8:00, 8:30, 9:00, 10:00 and 11:30 pm India time; a missed run is made up when the server is back.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS cause_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, ext_id TEXT NOT NULL, title TEXT, list_date TEXT, side TEXT, url TEXT,
  status TEXT NOT NULL DEFAULT 'new', tries INTEGER NOT NULL DEFAULT 0, chars INTEGER, hits INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(source, ext_id));
CREATE TABLE IF NOT EXISTS cause_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, matter_id INTEGER NOT NULL, list_id INTEGER NOT NULL, list_date TEXT NOT NULL,
  source TEXT, court_no TEXT, item_no TEXT, snippet TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(matter_id, list_date, source));
CREATE INDEX IF NOT EXISTS ix_cause_hits_t ON cause_hits(tenant_id, list_date);
`);

const SLOTS = [[20, 0], [20, 30], [21, 0], [22, 0], [23, 30]];
const CALCUTTA = { name: 'Calcutta High Court', key: 'calcutta-hc', index: 'https://www.calcuttahighcourt.gov.in/Notices/All', link: '/Notice-Files/CL/(\\d+)', must: 'cause\\s*list', forum: 'calcutta|high court at calcutta|\\bc\\.?h\\.?c\\b' };
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (compatible; KCPortal-CauseList/1.0)';

const sources = () => {
  let extra = []; try { extra = JSON.parse(AI.getS(0, 'cl_sources', '[]')); } catch (e) {}
  return [CALCUTTA, ...extra.filter((s) => s && s.index && s.link && s.name).map((s) => ({ ...s, key: 'x-' + String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), must: s.must || '', forum: s.forum || '' }))];
};

const forumOk = (src, forum) => { try { return !!src.forum && new RegExp(src.forum, 'i').test(String(forum || '')); } catch (e) { return false; } };

// "27.11.2026", "27/11/2026", "27-Nov-2026" → 2026-11-27
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  s = String(s || ''); let m = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})/); if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const strip = (h) => String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function get(url, binary) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(60000), redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
}
// The notice page lists each file with its title ("Daily Cause List Dated 27.11.2026 - Appellate Side Uploaded:26-Nov-2026 21:10:10").
function listLinks(html, src) {
  const out = [], re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,300})/gi, lk = new RegExp(src.link); let m;
  const mustRe = src.must ? new RegExp(src.must, 'i') : null;
  while ((m = re.exec(html))) {
    const href = m[1], idm = href.match(lk), id = idm && (idm[1] || idm[0]);
    if (!id) continue;
    const title = strip(m[2]) || strip(m[3]).slice(0, 140), ctx = strip(m[2] + ' ' + m[3]);
    if (mustRe && !mustRe.test(title + ' ' + ctx)) continue;
    out.push({ id, url: new URL(href, src.index).href, title: title.slice(0, 200), date: parseDate(title) || parseDate(ctx), side: /original/i.test(title) ? 'Original Side' : /appellate/i.test(title) ? 'Appellate Side' : /circuit|jalpaiguri|port blair/i.test(title) ? 'Circuit Bench' : '' });
  }
  return [...new Map(out.map((x) => [x.id, x])).values()];
}

const gsText = (file) => new Promise((resolve) => execFile('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=txtwrite', '-sOutputFile=-', file], { maxBuffer: 80 * 1024 * 1024, timeout: 120000 }, (e, out) => resolve(e ? '' : String(out))));
async function toText(buf) {
  if (buf.slice(0, 4).toString() === '%PDF') {
    const f = path.join(os.tmpdir(), 'cl-' + process.pid + '-' + Date.now() + '.pdf'); fs.writeFileSync(f, buf);
    try { return await gsText(f); } finally { fs.rmSync(f, { force: true }); }
  }
  return strip(buf.toString('utf8')).length > 200 ? buf.toString('utf8').replace(/<br\s*\/?>|<\/(p|tr|div|li)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : '';
}

// ---- matching ----
const ALNUM = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
// "WPA 1234 of 2026" / "W.P.A./1234/2026" / "CRR 567/2025" → { type:'WPA', no:'1234', year:'2026' } (several per field allowed)
function caseKeys(cn) {
  const keys = []; const re = /([A-Za-z][A-Za-z.\s()&-]{0,24}?)?[\s./-]*0*(\d{1,6})\s*(?:of|\/|-|\\)\s*((?:19|20)\d{2})/gi; let m;
  while ((m = re.exec(String(cn || '')))) keys.push({ type: ALNUM(m[1]).replace(/^(NO|CASENO|CASE)+/, ''), no: m[2], year: m[3] });
  return keys;
}
function lineHas(line, k) {
  const re = new RegExp('(^|[^0-9])0*' + k.no + '\\s*(?:of|/|-|\\\\|\\s)\\s*' + k.year + '(?![0-9])', 'i'); const m = re.exec(line); if (!m) return false;
  if (!k.type) return true;
  return ALNUM(line.slice(0, m.index + 1)).slice(-(k.type.length + 14)).includes(k.type);
}
function scan(text, matters) {
  const lines = text.split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim()), found = [], seen = new Set();
  const keyed = matters.map((m) => ({ m, keys: caseKeys(m.case_no) })).filter((x) => x.keys.length);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    for (const { m, keys } of keyed) {
      // the case number may wrap onto the next line, so test the line and the line joined with the next
      const joined = /(19|20)\d{2}/.test(lines[i]) || /^\d{1,3}[.)]\s/.test(lines[i + 1] || '') ? '' : lines[i] + ' ' + (lines[i + 1] || '');
      if (seen.has(m.id) || !keys.some((k) => lineHas(lines[i], k) || (joined && lineHas(joined, k)))) continue;
      seen.add(m.id);
      let court = '', item = ''; for (let j = i; j >= Math.max(0, i - 60); j--) { const c = lines[j].match(/court\s*(?:no\.?|room)?\s*[:.-]?\s*(\d{1,3})/i) || lines[j].match(/(?:^|\s)(?:Court|Hon'?ble).{0,40}?\b(\d{1,3})\b\s*$/i); if (c) { court = c[1]; break; } }
      const it = lines[i].match(/^\s*(\d{1,3})[.)\s]/); if (it) item = it[1];
      found.push({ m, court, item, snippet: lines.slice(Math.max(0, i - 1), i + 3).join(' ').slice(0, 400) });
    }
  }
  return found;
}

// ---- recording ----
const upMatters = (tid) => db.prepare("SELECT id, title, file_no, case_no, forum FROM matters WHERE tenant_id=? AND status='open' AND case_no IS NOT NULL AND TRIM(case_no)<>''").all(tid);
function record(list, text, src, only) {
  let n = 0; const ld = list.list_date;
  if (!ld) return 0;
  const tx = db.transaction((found, tid) => {
    for (const f of found) {
      const r = db.prepare('INSERT OR IGNORE INTO cause_hits(tenant_id,matter_id,list_id,list_date,source,court_no,item_no,snippet) VALUES (?,?,?,?,?,?,?,?)').run(tid, f.m.id, list.id, ld, src.key, f.court, f.item, f.snippet);
      if (!r.changes) continue; n++;
      const purpose = `Listed in ${src.name} cause list${list.side ? ' (' + list.side + ')' : ''}${f.court ? ', Court ' + f.court : ''}${f.item ? ', item ' + f.item : ''}`;
      if (!db.prepare("SELECT 1 FROM hearings WHERE matter_id=? AND hearing_date=? AND source='causelist'").get(f.m.id, ld))
        db.prepare("INSERT INTO hearings(tenant_id,matter_id,hearing_date,purpose,next_date,source) VALUES (?,?,?,?,?,'causelist')").run(tid, f.m.id, ld, purpose, ld);
    }
  });
  for (const f of db.prepare("SELECT id FROM tenants WHERE kind='firm' AND active=1").all()) {
    if (AI.getS(f.id, 'cl_auto', '1') !== '1' || (only && only.tid !== f.id)) continue;
    // only cases whose forum belongs to this source are searched in its lists
    const ms = upMatters(f.id).filter((m) => forumOk(src, m.forum) && (!only || m.id === only.mid));
    if (ms.length) tx(scan(text, ms), f.id);
  }
  return n;
}

let busy = false;
async function runOnce(why) {
  if (busy) return { busy: true }; busy = true; const sum = { new: 0, hits: 0, errors: [] };
  try {
    const horizon = ymd(new Date(istNow().getTime() - 2 * 86400e3));
    const forums = db.prepare("SELECT DISTINCT forum FROM matters WHERE status='open' AND case_no IS NOT NULL AND TRIM(case_no)<>''").all().map((r) => r.forum);
    for (const src of sources()) {
      if (!forums.some((f) => forumOk(src, f))) { sum.skipped = (sum.skipped || 0) + 1; continue; }   // no case of ours in this forum: nothing to fetch
      let html; try { html = await get(src.index); } catch (e) { sum.errors.push(src.name + ': ' + e.message); continue; }
      for (const x of listLinks(html, src).slice(0, 40)) {
        if (x.date && x.date < horizon) continue;                                    // old lists are not needed
        let row = db.prepare('SELECT * FROM cause_lists WHERE source=? AND ext_id=?').get(src.key, x.id);
        if (!row) { db.prepare('INSERT INTO cause_lists(source,ext_id,title,list_date,side,url) VALUES (?,?,?,?,?,?)').run(src.key, x.id, x.title, x.date, x.side, x.url); row = db.prepare('SELECT * FROM cause_lists WHERE source=? AND ext_id=?').get(src.key, x.id); sum.new++; }
        if (row.status === 'done' || row.tries >= 6) continue;
        try {
          const text = await toText(await get(x.url, true));
          if (text.length < 200) { db.prepare("UPDATE cause_lists SET tries=tries+1, status='retry', note='no readable text yet' WHERE id=?").run(row.id); continue; }
          const n = record(row, text, src); sum.hits += n;
          db.prepare("UPDATE cause_lists SET status='done', chars=?, hits=?, tries=tries+1, note=NULL WHERE id=?").run(text.length, n, row.id);
        } catch (e) { db.prepare("UPDATE cause_lists SET tries=tries+1, status='retry', note=? WHERE id=?").run(String(e.message).slice(0, 200), row.id); sum.errors.push(x.title + ': ' + e.message); }
      }
    }
    AI.setS(0, 'cl_last', JSON.stringify({ at: new Date().toISOString(), why, ...sum }));
    return sum;
  } finally { busy = false; }
}

// A list uploaded after a firm adds a case is picked up again at the next slot: lists already read are re-scanned only for hits not recorded yet.
async function rescanToday() {
  const today = ymd(istNow());
  for (const row of db.prepare("SELECT * FROM cause_lists WHERE status='done' AND list_date>=?").all(today)) {
    try { const src = sources().find((s) => s.key === row.source); if (!src) continue; const text = await toText(await get(row.url, true)); if (text.length > 200) record(row, text, src); } catch (e) {}
  }
}

// A case was added or its number/forum changed: run only the fetcher of that case's own court, for that case only.
const pending = new Map();
function onCase(matterId) {
  clearTimeout(pending.get(matterId));
  pending.set(matterId, setTimeout(async () => {
    pending.delete(matterId);
    try {
      const m = db.prepare("SELECT id, tenant_id, forum, case_no FROM matters WHERE id=? AND status='open'").get(matterId);
      if (!m || !String(m.case_no || '').trim() || AI.getS(m.tenant_id, 'cl_auto', '1') !== '1') return;
      const horizon = ymd(istNow());
      for (const src of sources().filter((s) => forumOk(s, m.forum))) {
        const html = await get(src.index);
        for (const x of listLinks(html, src).slice(0, 40)) {
          if (x.date && x.date < horizon) continue;
          let row = db.prepare('SELECT * FROM cause_lists WHERE source=? AND ext_id=?').get(src.key, x.id);
          if (!row) { db.prepare('INSERT INTO cause_lists(source,ext_id,title,list_date,side,url,status) VALUES (?,?,?,?,?,?,?)').run(src.key, x.id, x.title, x.date, x.side, x.url, 'new'); row = db.prepare('SELECT * FROM cause_lists WHERE source=? AND ext_id=?').get(src.key, x.id); }
          const text = await toText(await get(x.url, true)); if (text.length < 200) continue;
          const n = record(row, text, src, { tid: m.tenant_id, mid: m.id });
          if (n) db.prepare('UPDATE cause_lists SET hits=hits+? WHERE id=?').run(n, row.id);
        }
      }
    } catch (e) { console.error('causelist onCase', e.message); }
  }, 4000));
  if (pending.get(matterId).unref) pending.get(matterId).unref();
}

function startWorker() {
  const tick = async () => {
    const n = istNow(), day = ymd(n), mins = n.getUTCHours() * 60 + n.getUTCMinutes();
    const due = SLOTS.filter(([h, m]) => h * 60 + m <= mins && AI.getS(0, 'cl_slot_' + day + '_' + h + m, '') !== '1');
    if (!due.length) return;
    for (const [h, m] of due) AI.setS(0, 'cl_slot_' + day + '_' + h + m, '1');
    try { await runOnce('slot ' + due.map(([h, m]) => h + ':' + String(m).padStart(2, '0')).join(',')); if (due.length === 1) await rescanToday(); } catch (e) { console.error('causelist', e.message); }
  };
  const t = setInterval(tick, 60 * 1000), f = setTimeout(tick, 90 * 1000); t.unref && t.unref(); f.unref && f.unref();
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const SA = L.need('superadmin');
  // upcoming and recent cause-list entries for this firm's cases
  app.get('/api/causelist/hits', L.office, (req, res) => {
    res.json(db.prepare(`SELECT h.list_date, h.source, h.court_no, h.item_no, h.snippet, m.id matter_id, m.title, m.file_no, m.case_no, l.side
      FROM cause_hits h JOIN matters m ON m.id=h.matter_id JOIN cause_lists l ON l.id=h.list_id
      WHERE h.tenant_id=? AND h.list_date>=date('now','-7 days') ORDER BY h.list_date DESC, m.title LIMIT 300`).all(T(req)));
  });
  app.get('/api/platform/causelist', SA, (req, res) => {
    let last = {}; try { last = JSON.parse(AI.getS(0, 'cl_last', '{}')); } catch (e) {}
    res.json({ last, slots: SLOTS.map(([h, m]) => h + ':' + String(m).padStart(2, '0')), sources: sources().map((s) => ({ name: s.name, index: s.index, link: s.link, must: s.must, forum: s.forum, builtin: s.key === 'calcutta-hc' })),
      lists: db.prepare('SELECT title, list_date, side, status, hits, tries, note, source FROM cause_lists ORDER BY id DESC LIMIT 20').all() });
  });
  app.post('/api/platform/causelist/run', SA, async (req, res) => { res.json(await runOnce('manual').catch((e) => ({ errors: [e.message] }))); });
  app.put('/api/platform/causelist/sources', SA, (req, res) => {
    const arr = (Array.isArray(req.body.sources) ? req.body.sources : []).map((s) => ({ name: L.str(s.name, 80), index: L.str(s.index, 300), link: L.str(s.link, 200), must: L.str(s.must, 100), forum: L.str(s.forum, 150) })).filter((s) => s.name && /^https:\/\//.test(s.index) && s.link && s.forum);
    for (const s of arr) { try { new RegExp(s.link); if (s.must) new RegExp(s.must); if (s.forum) new RegExp(s.forum); } catch (e) { return res.status(400).json({ error: 'Bad link pattern for ' + s.name }); } }
    AI.setS(0, 'cl_sources', JSON.stringify(arr)); res.json({ ok: true });
  });
};
Object.assign(module.exports, { onCase, startWorker, listLinks, caseKeys, scan, parseDate, lineHas });
