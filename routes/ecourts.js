'use strict';
// Court data (eCourts): case search, full case record, orders, cause lists, automatic daily updates of linked cases,
// litigation check. Uses a licensed court-data service (eCourtsIndia partner API); there is no official eCourts API.
// The firm may enter its own key; otherwise the platform key (Super Admin) is used and usage is metered per firm.
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

const BASE = process.env.ECOURTS_BASE || 'https://webapi.ecourtsindia.com';
const CNR_RE = /^[A-Z]{4}[A-Z0-9]{12}$/;
db.exec(`CREATE TABLE IF NOT EXISTS matter_ecourt (matter_id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, cnr TEXT NOT NULL, snapshot TEXT, status TEXT, next_date TEXT, last_date TEXT, order_count INTEGER DEFAULT 0, fetched_at TEXT, fails INTEGER DEFAULT 0, last_error TEXT)`);
db.exec('CREATE TABLE IF NOT EXISTS ecourt_usage (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, kind TEXT, ref TEXT, cost_paise INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');

let transport = null; // tests replace this
const setTransport = (fn) => { transport = fn; };
const allowed = (t) => AI.svcMaster('courtdata') && AI.svcFirm(t, 'courtdata');
const keyOf = (t) => AI.secret(t, 'ecourts_key') || AI.secret(0, 'platform_ecourts_key') || process.env.ECOURTS_KEY || '';
const on = (t) => allowed(t) && AI.getS(t, 'ecourts_on', '1') === '1' && !!keyOf(t);
const rate = (t) => { const n = Number(AI.getS(t, 'ecourts_rate', '0.60')); return Math.round((Number.isFinite(n) && n >= 0 ? n : 0.6) * 100); };
const FREE = new Set(['states', 'districts', 'complexes', 'courts', 'dates', 'status', 'enums']);
// estimated cost in paise at the published pay-as-you-go prices (search 0.60, case 1.50, order PDF 3.75, order+AI 7.50, refresh 0.15, cause list 3.00); scaled if the firm's own search rate differs (e.g. subscription 0.20)
const PRICE = { search: 60, case: 150, order: 375, 'order-ai': 750, refresh: 15, causelist: 300, legal: 9900 };
const meter = (t, kind, ref, paise) => { try { const k = rate(t) / 60; db.prepare('INSERT INTO ecourt_usage(tenant_id,kind,ref,cost_paise) VALUES (?,?,?,?)').run(t, kind, String(ref || '').slice(0, 60), paise == null ? (FREE.has(kind) ? 0 : Math.round((PRICE[kind] || 60) * k)) : paise); } catch (e) {} };

// one call to the service. opts: {query, body, raw}
async function call(t, method, path, opts = {}) {
  const key = keyOf(t);
  if (!key && !opts.noauth) throw Object.assign(new Error('Court data is not set up for this firm yet. Please contact the portal provider.'), { status: 409 });
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(opts.query || {})) { if (Array.isArray(v)) v.filter((x) => x !== '' && x != null).forEach((x) => url.searchParams.append(k, x)); else if (v !== '' && v != null) url.searchParams.set(k, v); }
  const init = { method, headers: { Accept: 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 45000), redirect: 'manual' };
  if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const r = transport ? await transport({ method, url: url.toString(), init, path, query: opts.query, body: opts.body }) : await fetch(url, init);
  if (opts.raw) return r;
  let j = null; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('The court-data key was refused. Please contact the portal provider.'), { status: 502 });
  if (r.status === 402) throw Object.assign(new Error('The court-data account has no credit left. Add credit with the service provider.'), { status: 402 });
  if (r.status === 429) throw Object.assign(new Error('The court-data service is busy. Please try again in a minute.'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error((j && (j.message || (j.error && (j.error.message || j.error)))) || 'The court-data service returned an error (' + r.status + ').'), { status: r.status === 404 ? 404 : 502 });
  return (j && j.data !== undefined ? j.data : j) || {};
}

// ---- reading a case record tolerantly (the service adds fields over time) ----
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== '') return o[k]; return ''; };
const dateOnly = (s) => { const m = String(s || '').match(/\d{4}-\d{2}-\d{2}/); if (m) return m[0]; const d = String(s || '').match(/(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{4})/); return d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : ''; };
const names = (a) => (Array.isArray(a) ? a.map((x) => (typeof x === 'string' ? x : pick(x, 'name', 'fullName', 'party'))).filter(Boolean) : []);
function brief(d) {
  const c = (d && d.courtCaseData) || {};
  return { cnr: c.cnr, case_number: pick(c, 'caseNumber', 'registrationNumber', 'filingNumber'), case_type: pick(c, 'caseType', 'caseTypeRaw'), status: c.caseStatus || '', court: c.courtName || '', state: c.state || '', district: c.district || '',
    petitioners: names(c.petitioners), respondents: names(c.respondents), petitioner_advocates: names(c.petitionerAdvocates), respondent_advocates: names(c.respondentAdvocates), judges: names(c.judges),
    next_date: dateOnly(c.nextHearingDate), last_date: dateOnly(c.lastHearingDate), decision_date: dateOnly(c.decisionDate), filing_date: dateOnly(c.filingDate), purpose: c.purpose || '',
    order_count: (c.orderCount || 0) + (c.judgmentCount || 0) || (Array.isArray(c.judgmentOrders) ? c.judgmentOrders.length : 0) + (Array.isArray(c.interimOrders) ? c.interimOrders.length : 0) };
}
const orderList = (d) => { const c = (d && d.courtCaseData) || {}; return [...(c.judgmentOrders || []).map((o) => ({ ...o, kind: 'Judgment / final order' })), ...(c.interimOrders || []).map((o) => ({ ...o, kind: 'Interim order' }))]
  .map((o) => ({ date: dateOnly(pick(o, 'orderDate', 'date')), type: pick(o, 'orderType', 'type', 'kind'), kind: o.kind, url: pick(o, 'orderUrl', 'url', 'pdfUrl'), file: String(pick(o, 'filename', 'fileName', 'orderUrl', 'url') || '').split('/').pop().split('?')[0] })).filter((o) => o.url || o.file); };

function applyToMatter(t, m, d, prev) {
  const b = brief(d), set = [], args = [];
  if (!m.case_no && b.case_number) { set.push('case_no=?'); args.push(L.str(b.case_number, 100)); }
  if (!m.forum && b.court) { set.push('forum=?'); args.push(L.str(b.court + (b.district ? ', ' + b.district : ''), 200)); }
  if (!m.opposite_party && (b.respondents.length || b.petitioners.length)) { set.push('opposite_party=?'); args.push(L.str((b.respondents.length ? b.respondents : b.petitioners).join('; '), 250)); }
  if (!m.stage && b.status) { set.push('stage=?'); args.push(L.str(b.status, 100)); }
  if (set.length) db.prepare(`UPDATE matters SET ${set.join(',')} WHERE id=?`).run(...args, m.id);
  // hearing history -> hearings table (once per date)
  const c = (d && d.courtCaseData) || {}, have = new Set(db.prepare('SELECT hearing_date FROM hearings WHERE matter_id=?').all(m.id).map((h) => h.hearing_date));
  for (const h of Array.isArray(c.historyOfCaseHearings) ? c.historyOfCaseHearings : []) {
    const day = dateOnly(pick(h, 'businessOnDate', 'hearingDate', 'judgmentDate', 'date')); if (!day || have.has(day)) continue;
    db.prepare("INSERT INTO hearings(tenant_id,matter_id,hearing_date,purpose,outcome,next_date,source) VALUES (?,?,?,?,?,?,?)").run(t, m.id, day, L.str(pick(h, 'purposeOfHearing', 'purpose', 'purposeOfListing'), 250), L.str(pick(h, 'outcome', 'order', 'remarks'), 1000), dateOnly(pick(h, 'nextHearingDate', 'nextDate', 'hearingNextDate')) || null, 'ecourts'); have.add(day);
  }
  // the coming date (this is what the Calendar and reminders read)
  if (b.next_date && !db.prepare('SELECT 1 FROM hearings WHERE matter_id=? AND next_date=?').get(m.id, b.next_date))
    db.prepare("INSERT INTO hearings(tenant_id,matter_id,hearing_date,purpose,outcome,next_date,source) VALUES (?,?,?,?,?,?,?)").run(t, m.id, b.last_date || new Date().toISOString().slice(0, 10), L.str(b.purpose, 250), 'Updated from eCourts', b.next_date, 'ecourts');
  // tell the team when something changed since the last look
  const changes = [];
  if (prev) { if (prev.next_date && b.next_date && prev.next_date !== b.next_date) changes.push(`next date is now ${b.next_date} (was ${prev.next_date})`); if ((b.order_count || 0) > (prev.order_count || 0)) changes.push(`${b.order_count - prev.order_count} new order(s) uploaded`); if (prev.status && b.status && prev.status !== b.status) changes.push(`status is now ${b.status}`); }
  if (changes.length) {
    const who = m.assigned_to || (db.prepare("SELECT id FROM users WHERE tenant_id=? AND role='admin' AND active=1 ORDER BY id LIMIT 1").get(t) || {}).id || null;
    db.prepare("INSERT INTO tasks(tenant_id,matter_id,title,details,assigned_to,priority,status) VALUES (?,?,?,?,?,'high','todo')").run(t, m.id, `Court update: ${m.title}`.slice(0, 200), `eCourts shows: ${changes.join('; ')}. Check the case record.`, who);
  }
  return { b, changes };
}
const store = (t, m, cnr, d, err) => {
  const b = d ? brief(d) : null, prev = db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id);
  const pb = prev ? { next_date: prev.next_date, order_count: prev.order_count, status: prev.status } : null;
  if (d) {
    const res = applyToMatter(t, m, d, pb);
    db.prepare(`INSERT INTO matter_ecourt(matter_id,tenant_id,cnr,snapshot,status,next_date,last_date,order_count,fetched_at,fails,last_error) VALUES (?,?,?,?,?,?,?,?,datetime('now'),0,NULL)
      ON CONFLICT(matter_id) DO UPDATE SET cnr=excluded.cnr,snapshot=excluded.snapshot,status=excluded.status,next_date=excluded.next_date,last_date=excluded.last_date,order_count=excluded.order_count,fetched_at=excluded.fetched_at,fails=0,last_error=NULL`)
      .run(m.id, t, cnr, JSON.stringify(d).slice(0, 900000), b.status, b.next_date || null, b.last_date || null, b.order_count || 0);
    return res;
  }
  db.prepare(`INSERT INTO matter_ecourt(matter_id,tenant_id,cnr,fails,last_error) VALUES (?,?,?,1,?) ON CONFLICT(matter_id) DO UPDATE SET fails=fails+1,last_error=excluded.last_error`).run(m.id, t, cnr, String(err || '').slice(0, 200));
  return null;
};


// ---- local copy: case-summary PDF + every order, kept in the client's Files (so the record never depends on live court data) ----
db.exec('CREATE TABLE IF NOT EXISTS ecourt_files (matter_id INTEGER NOT NULL, key TEXT NOT NULL, node_id INTEGER, name TEXT, seq INTEGER, hash TEXT, saved_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(matter_id,key))');
try { db.exec('ALTER TABLE matter_ecourt ADD COLUMN archive_err TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE matter_ecourt ADD COLUMN archived_at TEXT'); } catch (e) {}
let APP = null;
const { summaryPdf, dmy } = require('../ecourtpdf');
const crypto = require('crypto');
const folderOf = (h, t, m) => { h.seed(t, m.client_id, null); return h.ensurePath(t, m.client_id, ['Judgements', String(m.file_no).replace(/\//g, '-')], null, false); };
// Saves what is not yet in Files. Orders are numbered Order1_dd-mm-yyyy, Order2_… in date order (numbers never change once given).

// the same court record as a Word / PDF spec for exportdoc (Word copy in Files, and downloads on the case page)
function recordSpec(t, m, d, ol, saved, fetchedAt) {
  const b = brief(d), c = d.courtCaseData || {}, cl = db.prepare('SELECT name FROM clients WHERE id=?').get(m.client_id) || {}, key = (o) => String(o.file || o.url || '').trim();
  const hs = (c.historyOfCaseHearings || []).map((x) => [pick(x, 'businessOnDate', 'hearingDate', 'date'), pick(x, 'purposeOfHearing', 'purpose'), x.nextHearingDate || '']).filter((r) => r[0]).sort((a, z) => dateOnly(z[0]).localeCompare(dateOnly(a[0]))).map((r) => [dmy(dateOnly(r[0])), r[1], r[2] ? dmy(dateOnly(r[2])) : '']);
  return { firm: (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '', title: 'Court Record', subtitle: `${(b.petitioners || []).join(', ')} vs ${(b.respondents || []).join(', ')}. Copied from the eCourts system on ${dmy(String(fetchedAt || '').slice(0, 10))}; check the official site or certified copy before relying on it in court.`, sections: [
    { heading: 'Our file', kv: [['File no.', m.file_no], ['Client', cl.name], ['Matter', m.title]] },
    { heading: 'Case', kv: [['CNR', b.cnr], ['Case type / no.', [b.case_type, b.case_number].filter(Boolean).join(' ')], ['Court', [b.court, b.district, b.state].filter(Boolean).join(', ')], ['Status', b.status], ['Next hearing', dmy(b.next_date)], ['Last hearing', dmy(b.last_date)], ['Purpose', b.purpose], ['Filing date', dmy(b.filing_date)], ['Decision date', dmy(b.decision_date)], ['Judge(s)', (b.judges || []).join('; ')], ['Acts and sections', typeof c.actsAndSections === 'string' ? c.actsAndSections : ''] ] },
    { heading: 'Parties and advocates', kv: [['Petitioner(s)', (b.petitioners || []).join('; ')], ['Advocate(s)', (b.petitioner_advocates || []).join('; ')], ['Respondent(s)', (b.respondents || []).join('; ')], ['Advocate(s)', (b.respondent_advocates || []).join('; ')]] },
    { heading: `History of hearings (${hs.length})`, cols: [{ h: 'Date', w: 1 }, { h: 'Purpose / business', w: 4 }, { h: 'Next date', w: 1 }], rows: hs },
    { heading: `Orders and judgments (${ol.length})`, cols: [{ h: 'Date', w: 1 }, { h: 'Kind', w: 2.5 }, { h: 'Saved in Files as', w: 3 }], rows: ol.map((o) => [dmy(o.date), [o.kind, o.type].filter(Boolean).join(' — '), saved[key(o)] || '(not downloaded yet)']) } ] };
}
async function archiveMatter(t, m, budget = { n: 60 }) {
  const h = APP && APP.locals.fsHelpers; if (!h || AI.getS(t, 'ecourts_archive', '1') !== '1') return { skipped: true };
  const link = db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id); if (!link || !link.snapshot) return { skipped: true };
  let d; try { d = JSON.parse(link.snapshot); } catch (e) { return { skipped: true }; }
  const b = brief(d), ol = orderList(d), parent = folderOf(h, t, m), errs = []; let got = 0;
  const have = new Map(db.prepare("SELECT key,name FROM ecourt_files WHERE matter_id=? AND key NOT IN ('summary','summary-docx')").all(m.id).map((r) => [r.key, r.name]));
  const key = (o) => String(o.file || o.url || '').trim();
  const todo = ol.filter((o) => key(o) && !have.has(key(o))).sort((x, y) => String(x.date || '9999').localeCompare(String(y.date || '9999')));
  let seq = (db.prepare("SELECT COALESCE(MAX(seq),0) n FROM ecourt_files WHERE matter_id=? AND key NOT IN ('summary','summary-docx')").get(m.id) || {}).n || 0;
  for (const o of todo) {
    if (budget.n <= 0) { errs.push('daily limit of downloads reached — the rest follow tomorrow'); break; }
    try {
      const buf = await orderBytes(t, link.cnr, o.file); budget.n--;
      const name = `Order${seq + 1}_${o.date ? dmy(o.date) : 'undated'}.pdf`;
      const r = await h.putFile(t, { clientId: m.client_id, parent, name, buffer: buf, mime: 'application/pdf', uid: null, matterId: m.id });
      seq++; got++; have.set(key(o), r.name);
      db.prepare('INSERT OR REPLACE INTO ecourt_files(matter_id,key,node_id,name,seq) VALUES (?,?,?,?,?)').run(m.id, key(o), r.id, r.name, seq);
    } catch (e) { errs.push(`${o.file}: ${e.message}`); if (e.status === 402 || e.status === 502) break; }
  }
  // the summary is rewritten only when something in it changed
  const saved = {}; for (const o of ol) saved[key(o)] = have.get(key(o)) || '';
  const hash = crypto.createHash('sha1').update(JSON.stringify([b, (d.courtCaseData || {}).historyOfCaseHearings || [], ol.map((o) => [key(o), saved[key(o)]]), (d.courtCaseData || {}).interlocutoryApplications || []])).digest('hex');
  const prev = db.prepare("SELECT * FROM ecourt_files WHERE matter_id=? AND key='summary'").get(m.id);
  let summary = false;
  if (!prev || prev.hash !== hash) {
    try {
      const c = d.courtCaseData || {}, cl = db.prepare('SELECT name FROM clients WHERE id=?').get(m.client_id) || {};
      const bytes = await summaryPdf({ firm: (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '', matter: m, client: cl.name || '', brief: b, orders: ol.map((o) => ({ ...o, key: key(o) })), saved, fetchedAt: link.fetched_at || new Date().toISOString(),
        detail: { acts: c.actsAndSections || '', hearings: c.historyOfCaseHearings || [], iAs: (c.interlocutoryApplications || []).slice(0, 60) } });
      if (prev && prev.node_id) db.prepare("UPDATE fs_nodes SET deleted_at=datetime('now') WHERE id=? AND tenant_id=?").run(prev.node_id, t);
      const r = await h.putFile(t, { clientId: m.client_id, parent, name: `Court record - ${String(m.file_no).replace(/\//g, '-')}.pdf`, buffer: bytes, mime: 'application/pdf', uid: null, matterId: m.id });
      db.prepare("INSERT OR REPLACE INTO ecourt_files(matter_id,key,node_id,name,hash) VALUES (?,'summary',?,?,?)").run(m.id, r.id, r.name, hash); summary = true;
      try { // Word copy beside the PDF
        const pw = db.prepare("SELECT * FROM ecourt_files WHERE matter_id=? AND key='summary-docx'").get(m.id); if (pw && pw.node_id) db.prepare("UPDATE fs_nodes SET deleted_at=datetime('now') WHERE id=? AND tenant_id=?").run(pw.node_id, t);
        const w = await h.putFile(t, { clientId: m.client_id, parent, name: `Court record - ${String(m.file_no).replace(/\//g, '-')}.docx`, buffer: await require('../exportdoc').build(recordSpec(t, m, d, ol, saved, link.fetched_at), 'docx'), mime: require('../exportdoc').MIME.docx, uid: null, matterId: m.id });
        db.prepare("INSERT OR REPLACE INTO ecourt_files(matter_id,key,node_id,name,hash) VALUES (?,'summary-docx',?,?,?)").run(m.id, w.id, w.name, hash);
      } catch (e) { errs.push('Word copy: ' + e.message); }
    } catch (e) { errs.push('summary: ' + e.message); }
  }
  db.prepare("UPDATE matter_ecourt SET archive_err=?, archived_at=CASE WHEN ?=0 THEN datetime('now') ELSE archived_at END WHERE matter_id=?").run(errs.length ? errs.join(' | ').slice(0, 500) : null, errs.length, m.id);
  return { orders: got, summary, errors: errs };
}

// ---- daily update of linked cases ----
async function syncMatter(t, m, budget) {
  const link = db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id); if (!link) return null;
  try { const d = await call(t, 'GET', '/api/partner/case/' + link.cnr); meter(t, 'case', link.cnr); const r = store(t, m, link.cnr, d); try { await archiveMatter(t, m, budget); } catch (e) { console.error('ecourts archive', e.message); } try { await require('./casehistory').refreshIfSaved(t, m); } catch (e) {} return r; }
  catch (e) { store(t, m, link.cnr, null, e.message); throw e; }
}
let running = false;
async function syncAll() {
  if (running) return; running = true;
  try {
    for (const f of db.prepare("SELECT id FROM tenants WHERE kind='firm' AND active=1").all()) {
      if (!on(f.id)) continue;
      const budget = { n: 150 }, done = new Set();
      if (AI.getS(f.id, 'ecourts_autosync', '1') === '1') {
        const cap = Math.min(200, L.int(AI.getS(f.id, 'ecourts_daily_cap', '40')) || 40);
        const rows = db.prepare(`SELECT m.*, e.fetched_at FROM matter_ecourt e JOIN matters m ON m.id=e.matter_id WHERE e.tenant_id=? AND m.status='open' AND e.fails<5
          AND (e.fetched_at IS NULL OR e.fetched_at < datetime('now','-12 hours')) AND COALESCE(e.status,'') NOT LIKE '%dispos%' ORDER BY e.fetched_at LIMIT ?`).all(f.id, cap);
        for (const m of rows) { done.add(m.id); try { await syncMatter(f.id, m, budget); } catch (e) { if (e.status === 402 || e.status === 502) break; } await new Promise((r) => setTimeout(r, 400)); }
      }
      // anything saved earlier but not yet fully copied to Files (a failed download, a new order found by hand) is finished from the stored record
      for (const m of db.prepare(`SELECT m.* FROM matter_ecourt e JOIN matters m ON m.id=e.matter_id WHERE e.tenant_id=? AND (e.archive_err IS NOT NULL OR e.archived_at IS NULL)`).all(f.id)) {
        if (done.has(m.id) || budget.n <= 0) continue; try { await archiveMatter(f.id, m, budget); } catch (e) { console.error('ecourts archive', e.message); }
      }
    }
    AI.setS(0, 'ecourts_last_sync', new Date().toISOString());
  } finally { running = false; }
}
// Every day at 2 am India time (if the server was off then, it runs as soon as it is back the same day).
const istDay = () => new Date(Date.now() + 5.5 * 3600e3);
const archiveInfo = (mid) => { const r = db.prepare("SELECT COUNT(*) n FROM ecourt_files WHERE matter_id=? AND key NOT IN ('summary','summary-docx')").get(mid), sm = db.prepare("SELECT name,saved_at FROM ecourt_files WHERE matter_id=? AND key='summary'").get(mid), e = db.prepare('SELECT archive_err,archived_at FROM matter_ecourt WHERE matter_id=?').get(mid) || {}; return { orders: r.n, summary: sm ? sm.name : null, summary_at: sm ? sm.saved_at : null, error: e.archive_err || null }; };
const startWorker = () => {
  const tick = () => { const n = istDay(), day = n.toISOString().slice(0, 10); if (n.getUTCHours() >= 2 && AI.getS(0, 'ecourts_last_day', '') !== day) { AI.setS(0, 'ecourts_last_day', day); syncAll().catch((e) => console.error('ecourts sync', e.message)); } };
  const first = setTimeout(tick, 3 * 60 * 1000), t = setInterval(tick, 10 * 60 * 1000); first.unref && first.unref(); t.unref && t.unref();
};

const okFile = (f) => /^[\w .()\-+,%]{1,200}$/.test(f);
async function orderBytes(t, cnr, file) {
  const r = await call(t, 'GET', `/api/partner/case/${cnr}/order/${encodeURIComponent(file)}`, { raw: true, query: { signed: 'true' }, timeout: 90000 }); meter(t, 'order', cnr);
  const ct = String(r.headers.get ? r.headers.get('content-type') : '') || '';
  if (/pdf|octet/i.test(ct)) return Buffer.from(await r.arrayBuffer());
  let j = {}; try { j = await r.json(); } catch (e) {}
  const data = j.data || j, u = pick(data, 'url', 'signedUrl', 'downloadUrl', 'pdfUrl', 'link');
  if (data.pdfBase64) return Buffer.from(data.pdfBase64, 'base64');
  if (u && /^https:\/\//.test(u)) { const f = await fetch(u, { signal: AbortSignal.timeout(90000) }); if (f.ok) return Buffer.from(await f.arrayBuffer()); }
  throw Object.assign(new Error('The order copy is not available from the court right now.'), { status: 404 });
}

module.exports = (app) => {
  APP = app;
  const T = (req) => req.user.tenant_id;
  const OFF = L.need('admin', 'advocate', 'staff');
  const gate = [OFF, (req, res, next) => (!allowed(T(req)) ? res.status(403).json({ error: 'This service is not active for your firm. Please contact the portal provider.' }) : AI.getS(T(req), 'ecourts_on', '1') !== '1' ? res.status(403).json({ error: 'This service is not active for your firm. Please contact the portal provider.' }) : !keyOf(T(req)) ? res.status(409).json({ error: 'Court data is not set up for your firm yet. Please contact the portal provider.', setup: true }) : next())];
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { if (e.status && e.status < 500 || e.status === 502) return res.status(e.status === 502 ? 502 : e.status).json({ error: e.message }); console.error('ecourts', e.message); res.status(502).json({ error: 'The court-data service could not be reached. Please try again.' }); } };
  const month = () => new Date().toISOString().slice(0, 7);
  const matterOf = (req, id) => db.prepare('SELECT * FROM matters WHERE id=? AND tenant_id=?').get(L.int(id), T(req));

  // ---- settings ----
  app.get('/api/ecourts/config', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const t = T(req), u = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(cost_paise),0) c FROM ecourt_usage WHERE tenant_id=? AND created_at>=date('now','start of month')").get(t);
    res.json({ allowed: allowed(t), on: AI.getS(t, 'ecourts_on', '1') === '1', ready: on(t), key_own: !!AI.secret(t, 'ecourts_key'), key_platform: !!AI.secret(0, 'platform_ecourt_key') || !!AI.secret(0, 'platform_ecourts_key') || !!process.env.ECOURTS_KEY,
      key_hint: AI.secret(t, 'ecourts_key') ? '…' + AI.secret(t, 'ecourts_key').slice(-4) : '', autosync: AI.getS(t, 'ecourts_autosync', '1') === '1', archive: AI.getS(t, 'ecourts_archive', '1') === '1', daily_cap: AI.getS(t, 'ecourts_daily_cap', '40'), rate: AI.getS(t, 'ecourts_rate', '0.60'),
      usage: { calls: u.n, est_cost_paise: u.c, month: month() }, linked: db.prepare('SELECT COUNT(*) n FROM matter_ecourt WHERE tenant_id=?').get(t).n, last_sync: AI.getS(0, 'ecourts_last_sync', '') });
  });
  app.put('/api/ecourts/config', L.need('admin'), (req, res) => {
    const t = T(req), b = req.body || {};
    if (b.on !== undefined) AI.setS(t, 'ecourts_on', b.on ? '1' : '0');
    if (b.archive !== undefined) AI.setS(t, 'ecourts_archive', b.archive ? '1' : '0');
    if (b.autosync !== undefined) AI.setS(t, 'ecourts_autosync', b.autosync ? '1' : '0');
    if (b.daily_cap !== undefined) { const n = L.int(b.daily_cap); if (!(n >= 1 && n <= 200)) return res.status(400).json({ error: 'Daily limit must be between 1 and 200 cases.' }); AI.setS(t, 'ecourts_daily_cap', String(n)); }
    if (b.rate !== undefined) { const n = Number(b.rate); if (!(n >= 0 && n <= 100)) return res.status(400).json({ error: 'Enter the cost of one lookup in rupees.' }); AI.setS(t, 'ecourts_rate', String(n)); }
    if (typeof b.key === 'string' && b.key.trim()) { if (b.key.trim() === '__clear__') AI.setSecret(t, 'ecourts_key', ''); else { if (!/^[A-Za-z0-9_\-]{12,120}$/.test(b.key.trim())) return res.status(400).json({ error: 'That does not look like a court-data key.' }); AI.setSecret(t, 'ecourts_key', b.key.trim()); } }
    audit(t, req.user.id, 'ecourts_config', 'tenant', t, Object.keys(b).filter((k) => k !== 'key').join(','), L.ip(req));
    res.json({ ok: true });
  });
  app.post('/api/ecourts/test', L.need('admin'), wrap(async (req, res) => { const r = await call(T(req), 'GET', '/api/partner/causelist/court-structure/states'); meter(T(req), 'status', 'test', 0); res.json({ ok: true, states: Array.isArray(r) ? r.length : (r.states || []).length }); }));

  // ---- search ----
  app.get('/api/ecourts/search', gate, wrap(async (req, res) => {
    const q = req.query, t = T(req), cnr = String(q.cnr || q.q || '').trim().toUpperCase();
    if (CNR_RE.test(cnr)) { const d = await call(t, 'GET', '/api/partner/case/' + cnr); meter(t, 'case', cnr); return res.json({ results: [{ ...brief(d), cnr }], totalHits: 1, page: 1, totalPages: 1, direct: true }); }
    const page = Math.max(1, L.int(q.page, 1)), query = {
      query: L.str(q.q, 200), 'petitioners': L.str(q.petitioner, 120) ? [L.str(q.petitioner, 120)] : [], 'respondents': L.str(q.respondent, 120) ? [L.str(q.respondent, 120)] : [], 'advocates': L.str(q.advocate, 120) ? [L.str(q.advocate, 120)] : [],
      'judges': L.str(q.judge, 120) ? [L.str(q.judge, 120)] : [], 'litigants': L.str(q.litigant, 120) ? [L.str(q.litigant, 120)] : [], actsAndSections: L.str(q.act, 120), nameMatchMode: ['all', 'any', 'phrase', 'fuzzy'].includes(q.mode) ? q.mode : '',
      'stateCodes': L.str(q.state, 10) ? [L.str(q.state, 10)] : [], 'courtLevels': ['SC', 'HC', 'DC', 'TRIBUNAL'].includes(q.level) ? [q.level] : [], page, pageSize: 25 };
    if (!query.query && !query['petitioners'].length && !query['respondents'].length && !query['advocates'].length && !query['judges'].length && !query['litigants'].length && !query.actsAndSections) return res.status(400).json({ error: 'Enter a CNR number, a party name, an advocate name or some words to search for.' });
    const d = await call(t, 'GET', '/api/partner/v2/search', { query }); meter(t, 'search', query.query || 'name');
    const linked = new Map(db.prepare('SELECT cnr, matter_id FROM matter_ecourt WHERE tenant_id=?').all(t).map((r) => [r.cnr, r.matter_id]));
    res.json({ results: (d.results || []).map((r) => ({ cnr: r.cnr, case_type: r.caseType, status: r.caseStatus, filing_date: dateOnly(r.filingDate), next_date: dateOnly(r.nextHearingDate), judges: names(r.judges), petitioners: names(r.petitioners), respondents: names(r.respondents), petitioner_advocates: names(r.petitionerAdvocates), acts: r.actsAndSections || '', court_code: r.courtCode || '', linked: linked.get(r.cnr) || null })),
      totalHits: d.totalHits || 0, page: d.page || page, totalPages: d.totalPages || 1, hasNext: !!d.hasNextPage });
  }));

  // ---- one case, live ----
  app.get('/api/ecourts/case/:cnr', gate, wrap(async (req, res) => {
    const cnr = String(req.params.cnr).toUpperCase(); if (!CNR_RE.test(cnr)) return res.status(400).json({ error: 'A CNR is 16-character code (4 letters then 12 letters or digits).' });
    const t = T(req), d = await call(t, 'GET', '/api/partner/case/' + cnr); meter(t, 'case', cnr);
    const c = d.courtCaseData || {}, link = db.prepare('SELECT matter_id FROM matter_ecourt WHERE tenant_id=? AND cnr=?').get(t, cnr);
    res.json({ brief: brief(d), orders: orderList(d), detail: { hearings: c.historyOfCaseHearings || [], business: c.businessOnDateEntries || [], acts: c.actsAndSections || '', provisions: c.provisions || [], iAs: c.interlocutoryApplications || [], linked: c.linkCases || [], tagged: c.taggedMatters || [], earlier: c.earlierCourtDetails || [], notices: c.notices || [], processes: c.processes || [], documents: c.filedDocuments || [], fir: c.firDetails || null,
      filing_number: c.filingNumber || '', registration_number: c.registrationNumber || '', registration_date: dateOnly(c.registrationDate), first_hearing: dateOnly(c.firstHearingDate), disposal: c.disposalType || '', contested: c.contestedStatus || '', court_no: c.courtNo || '', duration_days: c.caseDurationDays || null, ai: d.caseAiAnalysis || null }, matter_id: link ? link.matter_id : null });
  }));
  app.post('/api/ecourts/case/:cnr/refresh', gate, wrap(async (req, res) => {
    const cnr = String(req.params.cnr).toUpperCase(); if (!CNR_RE.test(cnr)) return res.status(400).json({ error: 'A CNR is 16-character code (4 letters then 12 letters or digits).' });
    const r = await call(T(req), 'POST', `/api/partner/case/${cnr}/refresh`); meter(T(req), 'refresh', cnr);
    res.json({ status: r.status || 'PENDING', message: r.message || 'The court record is being refreshed. Open it again in about a minute.', estimated: r.estimatedTime || null });
  }));

  // ---- orders ----
  app.get('/api/ecourts/case/:cnr/order', gate, wrap(async (req, res) => {
    const cnr = String(req.params.cnr).toUpperCase(), f = String(req.query.file || ''); if (!CNR_RE.test(cnr) || !okFile(f)) return res.status(400).json({ error: 'Invalid order.' });
    const b = await orderBytes(T(req), cnr, f); res.set({ 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.replace(/\.pdf$/i, '') + '.pdf')}` }); res.end(b);
  }));
  app.get('/api/ecourts/case/:cnr/order-ai', gate, wrap(async (req, res) => {
    const cnr = String(req.params.cnr).toUpperCase(), f = String(req.query.file || ''); if (!CNR_RE.test(cnr) || !okFile(f)) return res.status(400).json({ error: 'Invalid order.' });
    const d = await call(T(req), 'GET', `/api/partner/case/${cnr}/order-ai/${encodeURIComponent(f)}`, { timeout: 90000 }); meter(T(req), 'order-ai', cnr);
    res.json({ text: d.extractedText || '', analysis: d.aiAnalysis || null });
  }));
  app.post('/api/ecourts/case/:cnr/save-order', gate, wrap(async (req, res) => {
    const t = T(req), cnr = String(req.params.cnr).toUpperCase(), f = String((req.body || {}).file || ''), m = matterOf(req, (req.body || {}).matter_id), h = app.locals.fsHelpers;
    if (!CNR_RE.test(cnr) || !okFile(f) || !m || !h) return res.status(400).json({ error: 'Choose the case to save the order in.' });
    const buf = await orderBytes(t, cnr, f); h.seed(t, m.client_id, req.user.id);
    const parent = h.ensurePath(t, m.client_id, ['Judgements', m.file_no.replace(/\//g, '-')], req.user.id, false);
    const r = await h.putFile(t, { clientId: m.client_id, parent, name: f.replace(/\.pdf$/i, '') + '.pdf', buffer: buf, mime: 'application/pdf', uid: req.user.id, matterId: m.id });
    audit(t, req.user.id, 'ecourts_order_saved', 'matter', m.id, f, L.ip(req)); res.json({ ok: true, name: r.name });
  }));

  // ---- cause list ----
  app.get('/api/ecourts/causelist', gate, wrap(async (req, res) => {
    const q = req.query, t = T(req), query = { q: L.str(q.q, 120), date: L.isDate(q.date) ? q.date : '', startDate: L.isDate(q.from) ? q.from : '', endDate: L.isDate(q.to) ? q.to : '', advocate: L.str(q.advocate, 120), judge: L.str(q.judge, 120), litigant: L.str(q.litigant, 120),
      state: L.str(q.state, 10), districtCode: L.str(q.district, 20), courtComplexCode: L.str(q.complex, 30), court: L.str(q.court, 60), limit: 100, offset: Math.max(0, L.int(q.offset, 0)) };
    if (!['q', 'advocate', 'judge', 'litigant', 'court', 'courtComplexCode'].some((k) => query[k])) return res.status(400).json({ error: 'Enter an advocate, a party name, a judge or choose a court to see its cause list.' });
    const d = await call(t, 'GET', '/api/partner/causelist/search', { query }); meter(t, 'causelist', query.advocate || query.q);
    const mine = new Set(db.prepare('SELECT cnr FROM matter_ecourt WHERE tenant_id=?').all(t).map((r) => r.cnr));
    res.json({ results: (d.results || []).map((r) => ({ id: r.id, date: dateOnly(r.date), court: r.court || r.courtName || '', court_no: r.courtNo || '', bench: r.bench || '', list_type: r.listType || '', listing_no: r.listingNo || '', cases: Array.isArray(r.caseNumber) ? r.caseNumber : [r.caseNumber].filter(Boolean), party: r.party || '', petitioners: names(r.petitioners), respondents: names(r.respondents), advocates: names(r.advocates), judges: names(r.judge), district: r.district || '', state: r.state || '', cnr: r.cnr || '', mine: !!(r.cnr && mine.has(r.cnr)) })), returned: d.returnedCount || 0, limit: d.limit || 100, offset: d.offset || 0 });
  }));
  app.get('/api/ecourts/causelist/dates', gate, wrap(async (req, res) => { const q = req.query; const d = await call(T(req), 'GET', '/api/partner/causelist/available-dates', { query: { state: L.str(q.state, 10), districtCode: L.str(q.district, 20), courtComplexCode: L.str(q.complex, 30), court: L.str(q.court, 60) } }); meter(T(req), 'dates'); res.json({ dates: Array.isArray(d) ? d : d.dates || [] }); }));
  app.get('/api/ecourts/structure', gate, wrap(async (req, res) => {
    const q = req.query, parts = ['states']; let p = '/api/partner/causelist/court-structure/states';
    if (q.state && q.district && q.complex) p = `/api/partner/causelist/court-structure/states/${encodeURIComponent(q.state)}/districts/${encodeURIComponent(q.district)}/complexes/${encodeURIComponent(q.complex)}/courts`;
    else if (q.state && q.district) p = `/api/partner/causelist/court-structure/states/${encodeURIComponent(q.state)}/districts/${encodeURIComponent(q.district)}/complexes`;
    else if (q.state) p = `/api/partner/causelist/court-structure/states/${encodeURIComponent(q.state)}/districts`;
    const d = await call(T(req), 'GET', p); meter(T(req), 'states', parts[0], 0); res.json({ items: Array.isArray(d) ? d : d.items || d.states || d.districts || d.complexes || d.courts || [] });
  }));
  // which of my linked cases are listed on a date
  app.post('/api/ecourts/causelist/mine', gate, wrap(async (req, res) => {
    const t = T(req), cn = db.prepare("SELECT e.cnr, m.title, m.file_no, m.id mid FROM matter_ecourt e JOIN matters m ON m.id=e.matter_id WHERE e.tenant_id=? AND m.status='open' LIMIT 100").all(t);
    if (!cn.length) return res.json({ listed: [], checked: 0 });
    const d = await call(t, 'POST', '/api/partner/causelist/cnr/batch', { body: { cnrs: cn.map((x) => x.cnr) } }); meter(t, 'causelist', 'batch', Math.round(rate(t) / 2 * cn.length));
    const by = new Map(cn.map((x) => [x.cnr, x])), arr = Array.isArray(d) ? d : d.data || [];
    res.json({ checked: cn.length, listed: arr.filter((x) => x.hasCauselist).map((x) => ({ cnr: x.cnr, next: x.nextListing || null, title: (by.get(x.cnr) || {}).title, file_no: (by.get(x.cnr) || {}).file_no, matter_id: (by.get(x.cnr) || {}).mid })) });
  }));

  // ---- linking to our cases ----
  app.get('/api/matters/:id/ecourt', OFF, (req, res) => {
    const m = matterOf(req, req.params.id); if (!m) return res.status(404).json({ error: 'Not found.' });
    const e = db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id); if (!e) return res.json({ linked: false, ready: on(T(req)) });
    let snap = {}; try { snap = JSON.parse(e.snapshot || '{}'); } catch (x) {}
    res.json({ linked: true, ready: on(T(req)), cnr: e.cnr, fetched_at: e.fetched_at, fails: e.fails, last_error: e.last_error, brief: snap.courtCaseData ? brief(snap) : null, orders: orderList(snap), archive: archiveInfo(m.id) });
  });
  app.get('/api/matters/:id/ecourt/record/:fmt', OFF, wrap(async (req, res) => {
    const m = matterOf(req, req.params.id), f = req.params.fmt; if (!m || !['docx', 'pdf'].includes(f)) return res.status(404).json({ error: 'Not found.' });
    const e = db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id); if (!e || !e.snapshot) return res.status(404).json({ error: 'Link the case to its court record first.' });
    const d = JSON.parse(e.snapshot), ol = orderList(d), saved = {}, key = (o) => String(o.file || o.url || '').trim(); for (const r of db.prepare("SELECT key,name FROM ecourt_files WHERE matter_id=? AND key NOT IN ('summary','summary-docx')").all(m.id)) saved[r.key] = r.name;
    const X = require('../exportdoc'), c = d.courtCaseData || {}, cl = db.prepare('SELECT name FROM clients WHERE id=?').get(m.client_id) || {};
    const buf = f === 'docx' ? await X.build(recordSpec(T(req), m, d, ol, saved, e.fetched_at), 'docx') : await summaryPdf({ firm: (db.prepare('SELECT name FROM tenants WHERE id=?').get(T(req)) || {}).name || '', matter: m, client: cl.name || '', brief: brief(d), orders: ol.map((o) => ({ ...o, key: key(o) })), saved, fetchedAt: e.fetched_at, detail: { acts: c.actsAndSections || '', hearings: c.historyOfCaseHearings || [], iAs: (c.interlocutoryApplications || []).slice(0, 60) } });
    X.send(res, buf, f, 'Court record - ' + String(m.file_no).replace(/\//g, '-'));
  }));
  app.post('/api/matters/:id/ecourt/archive', gate, wrap(async (req, res) => { const m = matterOf(req, req.params.id); if (!m) return res.status(404).json({ error: 'Not found.' }); const r = await archiveMatter(T(req), m); if (r.skipped) return res.status(400).json({ error: 'Link the case to its court record first (and keep "Keep a copy in Files" on).' }); audit(T(req), req.user.id, 'ecourts_archive', 'matter', m.id, `${r.orders} orders`, L.ip(req)); res.json({ ok: true, ...r, archive: archiveInfo(m.id) }); }));
  app.post('/api/matters/:id/ecourt', gate, wrap(async (req, res) => {
    const t = T(req), m = matterOf(req, req.params.id); if (!m) return res.status(404).json({ error: 'Not found.' });
    const cnr = String((req.body || {}).cnr || '').trim().toUpperCase(); if (!CNR_RE.test(cnr)) return res.status(400).json({ error: 'A CNR is 16-character code (4 letters then 12 letters or digits), for example WBCHCA0100012025.' });
    const other = db.prepare('SELECT matter_id FROM matter_ecourt WHERE tenant_id=? AND cnr=? AND matter_id<>?').get(t, cnr, m.id); if (other) return res.status(409).json({ error: 'That CNR is already linked to another case.' });
    const d = await call(t, 'GET', '/api/partner/case/' + cnr); meter(t, 'case', cnr); const r = store(t, m, cnr, d); try { await archiveMatter(t, m); } catch (e) { console.error('ecourts archive', e.message); }
    audit(t, req.user.id, 'ecourts_linked', 'matter', m.id, cnr, L.ip(req)); res.json({ ok: true, brief: r.b });
  }));
  app.delete('/api/matters/:id/ecourt', OFF, (req, res) => { const m = matterOf(req, req.params.id); if (!m) return res.status(404).json({ error: 'Not found.' }); db.prepare('DELETE FROM matter_ecourt WHERE matter_id=?').run(m.id); audit(T(req), req.user.id, 'ecourts_unlinked', 'matter', m.id, null, L.ip(req)); res.json({ ok: true }); });
  app.post('/api/matters/:id/ecourt/sync', gate, wrap(async (req, res) => { const m = matterOf(req, req.params.id); if (!m) return res.status(404).json({ error: 'Not found.' }); const r = await syncMatter(T(req), m); res.json({ ok: true, changes: r ? r.changes : [] }); }));
  // put the court position into the client-visible note (what the client sees on their case)
  app.post('/api/matters/:id/ecourt/share-update', OFF, (req, res) => {
    const m = matterOf(req, req.params.id), e = m && db.prepare('SELECT * FROM matter_ecourt WHERE matter_id=?').get(m.id); if (!e) return res.status(404).json({ error: 'This case is not linked to the court record.' });
    let snap = {}; try { snap = JSON.parse(e.snapshot || '{}'); } catch (x) {} const b = brief(snap);
    const note = L.str(`Court update (${new Date().toISOString().slice(0, 10)}): status ${b.status || 'pending'}.${b.next_date ? ' Next hearing on ' + b.next_date + '.' : ''}${b.purpose ? ' Purpose: ' + b.purpose + '.' : ''}`, 1500);
    db.prepare('UPDATE matters SET client_visible_note=? WHERE id=?').run(note, m.id); audit(T(req), req.user.id, 'ecourts_shared', 'matter', m.id, null, L.ip(req)); res.json({ ok: true, note });
  });
  // create a new case in the portal from a court record
  app.post('/api/ecourts/import', gate, wrap(async (req, res) => {
    const t = T(req), b = req.body || {}, cnr = String(b.cnr || '').trim().toUpperCase(), client = db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(L.int(b.client_id), t);
    if (!CNR_RE.test(cnr) || !client) return res.status(400).json({ error: 'Choose the client for this case.' });
    if (db.prepare('SELECT 1 FROM matter_ecourt WHERE tenant_id=? AND cnr=?').get(t, cnr)) return res.status(409).json({ error: 'This case is already in your Cases.' });
    const d = await call(t, 'GET', '/api/partner/case/' + cnr); meter(t, 'case', cnr); const bf = brief(d);
    const { n, year } = L.nextNumber ? L.nextNumber(t, 'matter') : require('../db').nextNumber(t, 'matter');
    const pfx = (db.prepare('SELECT prefix FROM tenants WHERE id=?').get(t) || {}).prefix || 'KC', file_no = `${pfx}/M/${String(n).padStart(4, '0')}/${year}`;
    const title = L.str(b.title, 250) || L.str(`${bf.petitioners[0] || client.name} v. ${bf.respondents[0] || 'Respondent'}${bf.case_number ? ' — ' + bf.case_number : ''}`, 250);
    const r = db.prepare('INSERT INTO matters(tenant_id,client_id,file_no,title,forum,case_no,opposite_party,stage,assigned_to) VALUES (?,?,?,?,?,?,?,?,?)').run(t, client.id, file_no, title, L.str(bf.court, 200), L.str(bf.case_number, 100), L.str((bf.respondents[0] ? bf.respondents : bf.petitioners).join('; '), 250), L.str(bf.status, 100), L.int(b.assigned_to));
    const m = db.prepare('SELECT * FROM matters WHERE id=?').get(r.lastInsertRowid); store(t, m, cnr, d); try { await archiveMatter(t, m); } catch (e) { console.error('ecourts archive', e.message); }
    audit(t, req.user.id, 'ecourts_case_imported', 'matter', m.id, cnr, L.ip(req)); res.json({ id: m.id, file_no });
  }));

  // ---- litigation check (background report on a person or company) ----
  app.post('/api/ecourts/legal-check', gate, wrap(async (req, res) => {
    const t = T(req), b = req.body || {}, name = L.str(b.name, 150); if (!name) return res.status(400).json({ error: 'Enter the name to check.' });
    const body = { subject_type: b.kind === 'company' ? 'company' : 'individual', subject: { name, ...(L.str(b.father, 120) ? { father_name: L.str(b.father, 120) } : {}), ...(L.str(b.state, 40) ? { state: L.str(b.state, 40) } : {}) }, config: { purpose: L.str(b.purpose, 120) || 'Due diligence', client_ref_no: L.str(b.ref, 60) || undefined } };
    const d = await call(t, 'POST', '/api/partner/legal-check', { body, headers: { 'Idempotency-Key': 'kc-' + t + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) } }); meter(t, 'legal-check', name, 9900);
    res.json({ code: d.code, status: d.status });
  }));
  app.get('/api/ecourts/legal-check/:code', gate, wrap(async (req, res) => {
    const c = String(req.params.code).replace(/[^\w\-]/g, ''); const s = await call(T(req), 'GET', '/api/partner/legal-check/' + c);
    if (String(s.status).toLowerCase() === 'completed') { const r = await call(T(req), 'GET', `/api/partner/legal-check/${c}/report`, { query: { verbosity: 'standard' } }); return res.json({ status: 'completed', report: r }); }
    res.json({ status: s.status, stage: s.current_stage || '', progress: s.progress || null, error: s.error || null });
  }));
};
Object.assign(module.exports, { setTransport, archiveMatter, syncMatter, call, brief, orderList, syncAll, startWorker, on, allowed, store });
