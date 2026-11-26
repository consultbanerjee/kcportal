'use strict';
// Repository > Guide lines: rules, practice directions and e-filing rules of the Supreme Court, High Courts, tribunals and forums.
// One line per instrument (title, reference, date of publication); the line opens the official PDF in a new window.
// Verified entries are seeded below. A refresh (1st and 15th of every month at 7:00 IST, or "Update now") reads each court's
// official rules page and adds new instruments it finds. Generic: nothing here is specific to one firm.
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore'); const X = require('../exportdoc');

db.exec(`CREATE TABLE IF NOT EXISTS guideline_items (id INTEGER PRIMARY KEY, court TEXT NOT NULL, kind TEXT, title TEXT NOT NULL, ref TEXT, pub_date TEXT, url TEXT NOT NULL UNIQUE, summary TEXT, source TEXT, added_at TEXT DEFAULT (datetime('now')))`);

// [court, group, home page, rules page(s) read by the refresh, strict (home page: keep only links that say rules)]
const COURTS = [
  ['Supreme Court of India', 'Supreme Court', 'https://www.sci.gov.in/', ['https://www.sci.gov.in/supreme-court-rules/']],
  ['Allahabad High Court', 'High Courts', 'https://www.allahabadhighcourt.in/'], ['Andhra Pradesh High Court', 'High Courts', 'https://hc.ap.nic.in/'],
  ['Bombay High Court', 'High Courts', 'https://bombayhighcourt.nic.in/'], ['Calcutta High Court', 'High Courts', 'https://calcuttahighcourt.gov.in/', ['https://calcuttahighcourt.gov.in/Notices/gazette-notification']],
  ['Chhattisgarh High Court', 'High Courts', 'https://highcourt.cg.gov.in/'], ['Delhi High Court', 'High Courts', 'https://delhihighcourt.nic.in/', ['https://delhihighcourt.nic.in/web/court-rules', 'https://delhihighcourt.nic.in/web/notifications-practice-directions']],
  ['Gauhati High Court', 'High Courts', 'https://ghconline.gov.in/'], ['Gujarat High Court', 'High Courts', 'https://gujarathighcourt.nic.in/'],
  ['Himachal Pradesh High Court', 'High Courts', 'https://hphighcourt.nic.in/'], ['High Court of Jammu & Kashmir and Ladakh', 'High Courts', 'https://jkhighcourt.nic.in/'],
  ['Jharkhand High Court', 'High Courts', 'https://jharkhandhighcourt.nic.in/'], ['Karnataka High Court', 'High Courts', 'https://karnatakajudiciary.kar.nic.in/'],
  ['Kerala High Court', 'High Courts', 'https://highcourtofkerala.nic.in/'], ['Madhya Pradesh High Court', 'High Courts', 'https://mphc.gov.in/'],
  ['Madras High Court', 'High Courts', 'https://www.mhc.tn.gov.in/'], ['Manipur High Court', 'High Courts', 'https://hcmimphal.nic.in/'],
  ['Meghalaya High Court', 'High Courts', 'https://meghalayahighcourt.nic.in/'], ['Orissa High Court', 'High Courts', 'https://orissahighcourt.nic.in/'],
  ['Patna High Court', 'High Courts', 'https://patnahighcourt.gov.in/'], ['Punjab and Haryana High Court', 'High Courts', 'https://highcourtchd.gov.in/'],
  ['Rajasthan High Court', 'High Courts', 'https://hcraj.nic.in/'], ['Sikkim High Court', 'High Courts', 'https://hcs.gov.in/'],
  ['Telangana High Court', 'High Courts', 'https://tshc.gov.in/'], ['Tripura High Court', 'High Courts', 'https://thc.nic.in/'],
  ['Uttarakhand High Court', 'High Courts', 'https://highcourtofuttarakhand.gov.in/', ['https://highcourtofuttarakhand.gov.in/rules-framed-by-high-court/']],
  ['NCLT', 'Tribunals', 'https://nclt.gov.in/'], ['NCLAT', 'Tribunals', 'https://nclat.nic.in/'], ['DRT / DRAT', 'Tribunals', 'https://drt.gov.in/'],
  ['Income Tax Appellate Tribunal', 'Tribunals', 'https://itat.gov.in/'], ['CESTAT', 'Tribunals', 'https://cestat.gov.in/'], ['National Green Tribunal', 'Tribunals', 'https://greentribunal.gov.in/'],
  ['Securities Appellate Tribunal', 'Tribunals', 'https://sat.gov.in/'], ['TDSAT', 'Tribunals', 'https://tdsat.gov.in/'], ['Central Administrative Tribunal', 'Tribunals', 'https://cgat.gov.in/'],
  ['APTEL', 'Tribunals', 'https://aptel.gov.in/'], ['Armed Forces Tribunal', 'Tribunals', 'https://aftdelhi.nic.in/'],
  ['NCDRC and Consumer Commissions', 'Forums', 'https://ncdrc.nic.in/'], ['e-Jagriti (consumer commissions)', 'Forums', 'https://e-jagriti.gov.in/'],
  ['District Courts (eCourts)', 'District Courts', 'https://districts.ecourts.gov.in/'],
];

// Verified instruments: [court, kind, title, ref, published (ISO), url, summary]
const SEED = [
  ['Supreme Court of India', 'Rules', 'Supreme Court Rules, 2013', 'G.S.R. 368(E); in force 19 Aug 2014', '2014-05-27', 'https://cdnbbsr.s3waas.gov.in/s3ec0490f1f4972d133619a60c30f3559e/uploads/2024/01/2024011691-1.pdf',
    'Master code of practice in the Supreme Court, made under Article 145 with the President\'s approval. Covers who may appear (Advocates-on-Record), the form of petitions and appeals, special leave petitions, civil and criminal appeals, review and curative petitions, writ petitions, caveats, vacation benches, costs and the Registry\'s procedure.'],
  ['Supreme Court of India', 'Amendment', 'Supreme Court (Amendment) Rules, 2025', 'Gazette notification dated 14.06.2025', '2025-06-14', 'https://cdnbbsr.s3waas.gov.in/s3ec0490f1f4972d133619a60c30f3559e/uploads/2025/06/2025061698.pdf', 'Latest amendment to the Supreme Court Rules, 2013 listed on the Court\'s rules page.'],
  ['Supreme Court of India', 'Amendment', 'Supreme Court Amendment Rules, 2025', 'Gazette notification dated 21.04.2025', '2025-04-21', 'https://cdnbbsr.s3waas.gov.in/s3ec0490f1f4972d133619a60c30f3559e/uploads/2025/04/2025042231.pdf', 'Amendment to the Supreme Court Rules, 2013.'],
  ['Supreme Court of India', 'Amendment', 'Supreme Court (Second Amendment) Rules, 2024', 'Gazette notification dated 05.11.2024', '2024-11-05', 'https://cdnbbsr.s3waas.gov.in/s3ec0490f1f4972d133619a60c30f3559e/uploads/2024/11/2024110732.pdf', 'Second amendment of 2024 to the Supreme Court Rules, 2013.'],
  ['Supreme Court of India', 'Amendment', 'Amendment in Order II, Supreme Court Rules, 2013', 'Gazette notification dated 16.07.2024; in force 1 Aug 2024', '2024-07-16', 'https://cdnbbsr.s3waas.gov.in/s3ec0490f1f4972d133619a60c30f3559e/uploads/2024/07/2024073073.pdf', 'Substitutes rules 1 to 3 of Order II (sittings and hearing days of the Court) from 1 August 2024.'],
  ['Supreme Court of India', 'Handbook', 'Handbook on Practice and Procedure and Office Procedure (Judicial side)', 'Published on the Court\'s rules page (Dec 2025 upload)', '2025-12-12', 'https://cdn.s3waas.gov.in/s3ec0490f1f4972d133619a60c30f3559e/uploads/2025/12/2025121262.pdf', 'Ready reckoner on the practice and procedure of the Court and the Registry\'s office procedure, with the orders issued from time to time, read with the Supreme Court Rules, 2013.'],
  ['Calcutta High Court', 'Rules', 'Rules on papers and format of pleadings, affidavits etc. (Appellate and Original Side)', 'Gazette Notification No. 584-G, 18 Feb 2020', '2020-02-18', 'https://calcuttahighcourt.gov.in/Notice-Files/gazette-notification/2615',
    'Fixes the form of papers filed in the High Court. For printed papers: A4, Bookman Old Style or Courier New 12, 1.5 spacing; margins on the Appellate Side 3.5 cm top, 3 cm bottom, 3.5 cm left, 2.5 cm right. Part of both the Appellate Side Rules and the Original Side Rules.'],
  ['Calcutta High Court', 'Rules', 'E-filing Rules of the High Court at Calcutta', 'Notification 3096-G, 16 Dec 2021', '2021-12-16', 'https://calcuttahighcourt.gov.in/Notice-Files/general-notice/5351',
    'Rules for electronic filing. Clause 6.1 sets the format of e-filed documents: A4, margins top 1.5", bottom 1.5", left 1.75", right 1.0", justified text, 1.5 spacing, Times New Roman, Bookman Old Style or Courier New, size 14 or 12. Clause 6.2 requires OCR-searchable PDF, with PDF/A preferred.'],
  ['Calcutta High Court', 'Rules', 'Calcutta High Court (Circuit Bench at Jalpaiguri) Rules, 2019', 'Notification No. 869-G, 6 Mar 2019', '2019-03-06', 'https://calcuttahighcourt.gov.in/Notice-Files/gazette-notification/3904', 'Procedure for the Circuit Bench at Jalpaiguri; the Appellate Side and Original Side Rules apply with necessary changes.'],
  ['Calcutta High Court', 'Rules', 'Intellectual Property Rights Division Rules of the High Court at Calcutta', 'Notification No. 2281-G, 2 Jul 2024', '2024-07-02', 'https://www.calcuttahighcourt.gov.in/Notice-Files/gazette-notification/12428', 'Rules for the IPR Division, framed after the Tribunals Reforms Act, 2021.'],
  ['Calcutta High Court', 'Directions', 'Directions on e-authentication and secured transmission of judgments, decrees and orders', 'Notifications 1111-G, 1112-G, 1113-G, 19 Mar 2024', '2024-03-19', 'https://www.calcuttahighcourt.gov.in/Notice-Files/gazette-notification/10133', 'Directions that apply with the Original Side Rules, the Appellate Side Rules and the West Bengal Civil Rules and Orders; in a conflict the Rules prevail as the directions state.'],
  ['Delhi High Court', 'Rules', 'Delhi High Court (Original Side) Rules, 2018', 'Notification No. 100/Rules/DHC, 27 Feb 2018; in force 1 Mar 2018', '2018-02-27', 'https://delhihighcourt.nic.in/files/2024-04/downloadfile_act21xz4ip9.pdf', 'Procedure for suits and other proceedings on the ordinary original civil jurisdiction. Replaced the 1967 Rules. Chapters cover pleadings, presentation of plaints, vakalatnama, summons, interlocutory applications, evidence and costs.'],
  ['Delhi High Court', 'Amendment', 'Amendments to the Delhi High Court (Original Side) Rules, 2018', 'Notification No. 722/Rules/DHC, 16 Oct 2018; in force 1 Nov 2018', '2018-10-16', 'https://delhihighcourt.nic.in/files/Notifications%20and%20Practice%20Directions/notificationfile_8bp1bkknt2g.pdf', 'First set of amendments to the 2018 Rules.'],
  ['Delhi High Court', 'Amendment', 'Amendment of Annexure E, clause 10 (summons for settlement of issues, commercial dispute)', 'Notification No. 15/Rules/DHC, 4 Apr 2025', '2025-04-04', 'https://delhihighcourt.nic.in/files/Notifications%20and%20Practice%20Directions/17787324676805e787b3b2f.pdf', 'Substitutes the form of summons for settlement of issues in a commercial dispute.'],
  ['Delhi High Court', 'Amendment', 'Substituted Rule 10, Chapter IV (interlocutory applications file)', 'Notification of Oct 2025', '2025-10-17', 'https://delhihighcourt.nic.in/files/2025-10/notifications-and-practice-directions/skm_550i25101714260.pdf', 'Replaces the rule on the interlocutory applications file (Part II of the suit record) in the 2018 Rules.'],
  ['Uttarakhand High Court', 'Rules', 'Uttarakhand Electronic Filing (e-filing) Rules, 2021', 'Framed under Articles 225 and 227', '2021-01-01', 'https://highcourtofuttarakhand.gov.in/files/Uttarakhand_Electronic_Filing_(e-filing)_Rules,_2021.pdf', 'Governs e-filing in the High Court and the subordinate courts to which the General Rules (Civil), 1957 and General Rules (Criminal), 1977 apply. The exact notification date is on the PDF.'],
  ['Punjab and Haryana High Court', 'Rules', 'The Electronic Filing (E-Filing) Rules (Vol. V, Chapter 1-J)', 'Framed under Articles 225 and 227', null, 'https://highcourtchd.gov.in/sub_pages/left_menu/Rules_orders/high_court_rules/Vol-V--PDF/chap1partjV5.pdf', 'Applies to on-line e-filing and filing through designated counters and e-Service Centres, for such cases as the Court notifies. Date: see the notification on the PDF.'],
];
for (const s of SEED) db.prepare('INSERT OR IGNORE INTO guideline_items (court,kind,title,ref,pub_date,url,summary,source) VALUES (?,?,?,?,?,?,?,?)').run(...s, 'verified');

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function dateIn(t) {
  let m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d\d|19\d\d)/.exec(t); if (m && +m[2] <= 12 && +m[1] <= 31) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*[,.]?\s+(20\d\d|19\d\d)/.exec(t); if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}
const KEEP = /rule|practice direction|e-?filing|regulation|guideline|notification|circular|procedure|handbook/i, STRICT = /rules|practice direction|e-?filing|regulations/i;
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
async function page(url) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000);
  try { const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KCPortalGuidelines/1.0)', Accept: 'text/html,*/*' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } finally { clearTimeout(t); }
}
function links(html, base, strict) {
  const out = [], re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch (e) { continue; } if (!/^https?:/.test(u)) continue;
    const text = clean(m[2]), isPdf = /\.pdf(\?|$)/i.test(u); if (text.length < 8 || text.length > 300) continue;
    if (!(strict ? STRICT.test(text) : KEEP.test(text) || isPdf)) continue; if (strict && !isPdf && !/rules|practice/i.test(text)) continue;
    if (!isPdf && !/rule|practice|filing|notif/i.test(u + ' ' + text)) continue;
    out.push({ url: u, title: text, pdf: isPdf });
  }
  return out;
}
async function refresh(why) {
  const added = {}, errors = []; let n = 0;
  const jobs = []; for (const [court, , home, pages] of COURTS) { for (const p of (pages || [home])) jobs.push([court, p, !pages]); }
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const [court, url, strict] = jobs[i++];
      try {
        const html = await page(url), ls = links(html, url, strict).slice(0, 80);
        for (const l of ls) {
          const r = db.prepare('INSERT OR IGNORE INTO guideline_items (court,kind,title,ref,pub_date,url,source) VALUES (?,?,?,?,?,?,?)').run(court, /amend/i.test(l.title) ? 'Amendment' : /practice/i.test(l.title) ? 'Practice direction' : 'Rules', l.title.slice(0, 260), null, dateIn(l.title), l.url, 'auto');
          if (r.changes) { n++; added[court] = (added[court] || 0) + 1; }
        }
      } catch (e) { errors.push(court + ': ' + String(e.message).slice(0, 80)); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const out = { at: new Date().toISOString(), why, added: n, by_court: added, errors: errors.slice(0, 40), checked: jobs.length };
  AI.setS(0, 'gl_last', JSON.stringify(out)); return out;
}
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
function startWorker() {
  // 1st and 15th of every month, from 7:00 IST; runs once per such day
  const tick = async () => {
    const n = istNow(), d = n.getUTCDate(), key = 'gl_run_' + n.toISOString().slice(0, 10);
    if ((d !== 1 && d !== 15) || n.getUTCHours() < 7 || AI.getS(0, key, '') === '1') return;
    AI.setS(0, key, '1'); try { await refresh('scheduled'); } catch (e) { console.error('guidelines', e.message); }
  };
  const t = setInterval(tick, 60 * 1000), f = setTimeout(tick, 120 * 1000); t.unref && t.unref(); f.unref && f.unref();
}
const nextRun = () => { const n = istNow(), y = n.getUTCFullYear(), mo = n.getUTCMonth(), d = n.getUTCDate(), pass = n.getUTCHours() >= 7; const c = [[y, mo, 1], [y, mo, 15], [y, mo + 1, 1]].find(([a, b, e]) => new Date(Date.UTC(a, b, e, 7)).getTime() > n.getTime() - (pass ? 0 : 0) && (e !== d || !pass || b !== mo)); return new Date(Date.UTC(c[0], c[1], c[2])).toISOString().slice(0, 10); };

const fmtD = (iso) => { if (!iso) return 'date not stated'; const [y, m, d] = iso.split('-'); return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };
const items = () => db.prepare('SELECT id,court,kind,title,ref,pub_date,url,summary,source FROM guideline_items ORDER BY court, COALESCE(pub_date,\'0000\') DESC, id').all();

function bookSpec(firm, scope) {
  const all = items(), by = {}; all.forEach((x) => (by[x.court] = by[x.court] || []).push(x));
  const sections = [{ heading: 'About this guidebook', text: 'This guidebook collects the rules, practice directions and e-filing rules of the Supreme Court of India and the High Courts, with tribunals, consumer forums and district courts listed after them. Each entry gives the title, the reference, the date of publication and a short summary; the official PDF is linked on the portal under Repository, Guide lines.\nThe list is refreshed from the courts\' own rules pages on the 1st and 15th of every month. Entries marked "found on the court\'s page" were collected automatically and carry no summary yet. Always read the current official text before filing: rules are amended often and a court\'s own notice prevails over any summary.' }];
  sections.push({ heading: 'Filing format at a glance (verified entries only)', cols: [{ h: 'Court', w: 2 }, { h: 'What the rules say', w: 6 }], rows: all.filter((x) => x.source === 'verified' && /format|e-filing|papers/i.test(x.title)).map((x) => [x.court, x.summary]) });
  for (const [court, group] of COURTS.map((c) => [c[0], c[1]])) {
    if (scope === 'hc' && group !== 'Supreme Court' && group !== 'High Courts') continue; const L2 = by[court] || [];
    sections.push({ heading: `${group}: ${court}`, cols: [{ h: 'Instrument', w: 4 }, { h: 'Reference and date of publication', w: 3 }, { h: 'Summary', w: 5 }], rows: L2.length ? L2.map((x) => [x.title, `${x.ref ? x.ref + '. ' : ''}Published ${fmtD(x.pub_date)}\n${x.url}`, x.summary || 'Found on the court\'s page; read the PDF.']) : [['No rules collected yet from this court\'s website.', 'Run Update now, or open the court\'s website from Repository, Courts.', '']] });
  }
  return { firm, title: scope === 'hc' ? 'Guidebook: Supreme Court and High Courts' : 'Guidebook: Courts, Tribunals and Forums', subtitle: 'Rules, practice directions and e-filing rules. Updated on the 1st and 15th of every month.', sections };
}

module.exports = (app) => {
  const SA = L.need('superadmin');
  app.get('/api/guidelines', L.office, (req, res) => {
    let last = {}; try { last = JSON.parse(AI.getS(0, 'gl_last', '{}')); } catch (e) {}
    res.json({ groups: [...new Set(COURTS.map((c) => c[1]))], courts: COURTS.map((c) => ({ name: c[0], group: c[1], site: c[2] })), items: items().map((x) => ({ ...x, shown: fmtD(x.pub_date) })), last, next: nextRun(), when: '1st and 15th of every month, 7:00 AM IST' });
  });
  app.post('/api/guidelines/run', SA, async (req, res) => { res.json(await refresh('manual').catch((e) => ({ errors: [e.message] }))); });
  app.get('/api/guidelines/book', L.office, async (req, res) => {
    const f = req.query.fmt === 'pdf' ? 'pdf' : 'docx', scope = req.query.scope === 'all' ? 'all' : 'hc';
    const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(req.user.tenant_id) || {}).name || '';
    try { X.send(res, await X.build(bookSpec(firm, scope), f), f, scope === 'hc' ? 'Guidebook - Supreme Court and High Courts' : 'Guidebook - Courts, Tribunals and Forums'); } catch (e) { res.status(500).json({ error: 'Could not build the guidebook' }); }
  });
};
Object.assign(module.exports, { startWorker, refresh, dateIn, links, bookSpec, nextRun });
