'use strict';
// v4.0 extras: Repository (curated official links, editable per firm), client consent records (DPDP), follow-up worklist, home dashboard extras.
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;
const OFF = L.need('admin', 'advocate', 'staff', 'telecaller', 'accounts');

// Standard official and free resources. Each firm can hide any of them and add its own.
const CATALOG = [
  ['Courts', [
    ['Supreme Court of India', 'https://www.sci.gov.in/', 'Cause lists, orders, judgments, e-filing links'],
    ['Supreme Court — judgments', 'https://www.sci.gov.in/judgements-judgement-date/', 'Search judgments by date'],
    ['Calcutta High Court', 'https://calcuttahighcourt.gov.in/', 'Cause lists, notices, orders, calendar'],
    ['eCourts Services — case status', 'https://services.ecourts.gov.in/ecourtindia_v6/', 'District and Taluka courts: case status, cause list, orders by CNR'],
    ['High Court Services (eCourts)', 'https://hcservices.ecourts.gov.in/hcservices/', 'Case status and orders of High Courts'],
    ['District Courts (eCourts portal)', 'https://districts.ecourts.gov.in/', 'Pick a state and district'],
    ['National Judicial Data Grid', 'https://njdg.ecourts.gov.in/njdgnew/index.php', 'Pendency and disposal statistics'],
    ['eCourts — online fee payment', 'https://pay.ecourts.gov.in/', 'Court fee and fine payment'],
    ['Supreme Court e-filing', 'https://efiling.sci.gov.in/', 'Register and file in the Supreme Court'],
  ]],
  ['Tribunals', [
    ['NCLT', 'https://nclt.gov.in/', 'National Company Law Tribunal'],
    ['NCLAT', 'https://nclat.nic.in/', 'National Company Law Appellate Tribunal'],
    ['DRT / DRAT', 'https://drt.gov.in/', 'Debts Recovery Tribunals and Appellate Tribunal'],
    ['Income Tax Appellate Tribunal', 'https://itat.gov.in/', 'ITAT benches, orders, cause lists'],
    ['CESTAT', 'https://cestat.gov.in/', 'Customs, Excise and Service Tax Appellate Tribunal'],
    ['National Green Tribunal', 'https://greentribunal.gov.in/', 'Environment matters'],
    ['Securities Appellate Tribunal', 'https://sat.gov.in/', 'SEBI appeals'],
    ['TDSAT', 'https://tdsat.gov.in/', 'Telecom disputes'],
    ['Central Administrative Tribunal', 'https://cgat.gov.in/', 'Service matters of Central Government employees'],
    ['NCDRC', 'https://ncdrc.nic.in/', 'National Consumer Disputes Redressal Commission'],
    ['APTEL', 'https://aptel.gov.in/', 'Appellate Tribunal for Electricity'],
  ]],
  ['Free eLibrary and research', [
    ['Indian Kanoon', 'https://indiankanoon.org/', 'Free search of judgments and statutes'],
    ['India Code', 'https://www.indiacode.nic.in/', 'Central and State Acts, official text'],
    ['Legislative Department', 'https://legislative.gov.in/', 'Acts, Constitution, rules, bills'],
    ['eGazette of India', 'https://egazette.gov.in/', 'Official gazette notifications'],
    ['Law Commission of India', 'https://lawcommissionofindia.nic.in/', 'Reports of the Law Commission'],
    ['PRS Legislative Research', 'https://prsindia.org/', 'Bills, Acts, committee reports in plain language'],
    ['Sansad (Parliament of India)', 'https://sansad.in/', 'Debates, bills, questions'],
    ['Digital Sansad / Constitution', 'https://legislative.gov.in/constitution-of-india/', 'Constitution of India'],
  ]],
  ['News and legal updates', [
    ['LiveLaw', 'https://www.livelaw.in/', 'Court and legal news'],
    ['Bar & Bench', 'https://www.barandbench.com/', 'Court and legal news'],
    ['Verdictum', 'https://www.verdictum.in/', 'Judgment reports'],
    ['SCC Online Blog', 'https://www.scconline.com/blog/', 'Case notes and updates'],
    ['PIB', 'https://pib.gov.in/', 'Press Information Bureau releases'],
    ['All India Radio News', 'https://newsonair.gov.in/', 'National news'],
    ['DD News', 'https://ddnews.gov.in/', 'National news'],
  ]],
  ['Government services', [
    ['MCA21', 'https://www.mca.gov.in/', 'Company filings and master data'],
    ['Income Tax portal', 'https://www.incometax.gov.in/', 'Returns, e-proceedings, notices'],
    ['GST portal', 'https://www.gst.gov.in/', 'Registration, returns, notices'],
    ['TRACES (TDS)', 'https://www.tdscpc.gov.in/', 'TDS statements and certificates'],
    ['DigiLocker', 'https://www.digilocker.gov.in/', 'Verified government documents'],
    ['SHCIL e-Stamping', 'https://www.shcilestamp.com/', 'Online stamp duty'],
    ['Banglar Bhumi', 'https://banglarbhumi.gov.in/', 'West Bengal land records'],
    ['West Bengal Government', 'https://wb.gov.in/', 'State portal and notifications'],
    ['Kolkata Municipal Corporation', 'https://www.kmcgov.in/', 'Building plans, assessment, trade licence'],
    ['Parivahan', 'https://parivahan.gov.in/', 'Vehicle and licence records'],
  ]],
  ['Professional bodies', [
    ['Bar Council of India', 'https://www.barcouncilofindia.org/', 'Rules, notices, enrolment'],
  ]],
];
const keyOf = (cat, url) => cat + '|' + url;

const CONSENT_PURPOSES = ['Handling my case papers and personal data', 'Contacting me by WhatsApp / SMS', 'Contacting me by email', 'Birthday and festival greetings', 'Sharing documents through the client portal'];
const todayStr = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const okUrl = (u) => /^https?:\/\/[^\s<>"']+$/i.test(u) && u.length < 400;

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;

  // ---- Repository ----
  app.get('/api/repository', L.requireLogin, (req, res) => {
    if (req.user.role === 'client' || req.user.role === 'superadmin') return res.status(403).json({ error: 'Not available.' });
    const t = T(req), hide = new Set(db.prepare('SELECT key FROM repo_hide WHERE tenant_id=?').all(t).map((r) => r.key));
    const cats = CATALOG.map(([cat, list]) => ({ cat, links: list.map(([title, url, note]) => ({ title, url, note, std: true, hidden: hide.has(keyOf(cat, url)), key: keyOf(cat, url) })) }));
    for (const r of db.prepare('SELECT * FROM repo_links WHERE tenant_id=? ORDER BY id').all(t)) {
      let c = cats.find((x) => x.cat === r.cat); if (!c) { c = { cat: r.cat, links: [] }; cats.push(c); }
      c.links.push({ id: r.id, title: r.title, url: r.url, note: r.note, std: false, hidden: false });
    }
    res.json(cats);
  });
  app.post('/api/repository', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const cat = L.str(req.body.cat, 60), title = L.str(req.body.title, 120), url = L.str(req.body.url, 400), note = L.str(req.body.note, 200);
    if (!L.must(res, cat && title && okUrl(url), 'Enter a category, a title and a full web address starting with https://')) return;
    res.json({ id: db.prepare('INSERT INTO repo_links(tenant_id,cat,title,url,note) VALUES (?,?,?,?,?)').run(T(req), cat, title, url, note).lastInsertRowid });
  });
  app.delete('/api/repository/:id', L.need('admin', 'advocate', 'staff'), (req, res) => { db.prepare('DELETE FROM repo_links WHERE id=? AND tenant_id=?').run(req.params.id, T(req)); res.json({ ok: true }); });
  app.post('/api/repository/hide', L.need('admin'), (req, res) => {
    const key = L.str(req.body.key, 500); if (!L.must(res, CATALOG.some(([c, l]) => l.some((x) => keyOf(c, x[1]) === key)), 'Unknown link.')) return;
    if (req.body.hidden) db.prepare('INSERT OR IGNORE INTO repo_hide(tenant_id,key) VALUES (?,?)').run(T(req), key); else db.prepare('DELETE FROM repo_hide WHERE tenant_id=? AND key=?').run(T(req), key);
    res.json({ ok: true });
  });

  // ---- client consent records ----
  app.get('/api/consents', OFF, (req, res) => {
    const t = T(req);
    const rows = db.prepare('SELECT k.*, c.name client FROM client_consents k JOIN clients c ON c.id=k.client_id WHERE k.tenant_id=? ORDER BY k.id DESC LIMIT 500').all(t);
    const without = db.prepare("SELECT COUNT(*) n FROM clients WHERE tenant_id=? AND id NOT IN (SELECT client_id FROM client_consents WHERE tenant_id=? AND withdrawn_on IS NULL)").get(t, t).n;
    res.json({ rows, without, purposes: CONSENT_PURPOSES, notice: AI.getS(t, 'consent_notice', '') });
  });
  app.post('/api/consents', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const c = db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.body.client_id), T(req));
    const purposes = (Array.isArray(req.body.purposes) ? req.body.purposes : [req.body.purpose]).map((x) => L.str(x, 120)).filter(Boolean);
    const mode = ['written', 'verbal', 'portal', 'email'].includes(req.body.mode) ? req.body.mode : 'written';
    if (!L.must(res, c && purposes.length, 'Choose a client and at least one purpose.')) return;
    const on = L.isDate(req.body.given_on) ? req.body.given_on : todayStr(), ins = db.prepare('INSERT INTO client_consents(tenant_id,client_id,purpose,mode,given_on,note,created_by) VALUES (?,?,?,?,?,?,?)');
    db.transaction(() => purposes.forEach((p) => ins.run(T(req), c.id, p, mode, on, L.str(req.body.note, 300), req.user.id)))();
    audit(T(req), req.user.id, 'consent_recorded', 'client', c.id, c.name, L.ip(req)); res.json({ ok: true });
  });
  app.post('/api/consents/:id/withdraw', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const r = db.prepare('UPDATE client_consents SET withdrawn_on=? WHERE id=? AND tenant_id=? AND withdrawn_on IS NULL').run(L.isDate((req.body || {}).on) ? req.body.on : todayStr(), req.params.id, T(req));
    if (!r.changes) return res.status(404).json({ error: 'Not found.' });
    // a withdrawn consent for messages stops automatic reminders and greetings for that client
    const k = db.prepare('SELECT * FROM client_consents WHERE id=?').get(req.params.id);
    if (/WhatsApp|SMS/i.test(k.purpose)) db.prepare('UPDATE clients SET wa_optout=1 WHERE id=? AND tenant_id=?').run(k.client_id, T(req));
    if (/greeting/i.test(k.purpose)) db.prepare('UPDATE cal_birthdays SET active=0 WHERE client_id=? AND tenant_id=?').run(k.client_id, T(req));
    audit(T(req), req.user.id, 'consent_withdrawn', 'client', k.client_id, k.purpose, L.ip(req)); res.json({ ok: true });
  });
  app.put('/api/consents/notice', L.need('admin'), (req, res) => { AI.setS(T(req), 'consent_notice', L.str(req.body.notice, 3000)); res.json({ ok: true }); });

  // ---- follow-up worklist: everything that is waiting for someone ----
  app.get('/api/followups', OFF, (req, res) => {
    const t = T(req), today = todayStr(), mine = req.user.role === 'advocate' || req.user.role === 'staff' || req.user.role === 'telecaller';
    const A = mine ? ' AND (assigned_to=? OR assigned_to IS NULL)' : '', a = mine ? [req.user.id] : [];
    const leads = db.prepare(`SELECT id,name,phone,stage,callback_at,issue,created_at FROM leads WHERE tenant_id=? AND stage NOT IN ('converted','lost') ${A}
      AND (callback_at IS NOT NULL AND substr(callback_at,1,10)<=date(?,'+3 day') OR (callback_at IS NULL AND stage='new' AND created_at<datetime('now','-1 day'))) ORDER BY COALESCE(callback_at,created_at) LIMIT 60`).all(t, ...a, today)
      .map((x) => ({ ...x, due: x.callback_at ? x.callback_at.slice(0, 10) : x.created_at.slice(0, 10), why: x.callback_at ? 'Call back' : 'New lead, not yet contacted', overdue: (x.callback_at ? x.callback_at.slice(0, 10) : '9999') < today }));
    const tickets = db.prepare(`SELECT id,subject,name,phone,priority,created_at FROM tickets WHERE tenant_id=? AND status='open' AND created_at<datetime('now','-2 day') ORDER BY created_at LIMIT 40`).all(t);
    const nodate = db.prepare(`SELECT m.id,m.file_no,m.title,m.forum FROM matters m WHERE m.tenant_id=? AND m.status='open' AND NOT EXISTS (SELECT 1 FROM hearings h WHERE h.matter_id=m.id AND h.next_date>=?) ORDER BY m.id DESC LIMIT 40`).all(t, today);
    const dues = db.prepare(`SELECT c.id,c.name,c.phone, SUM(i.total_paise) - COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.client_id=c.id),0) due FROM invoices i JOIN clients c ON c.id=i.client_id
      WHERE i.tenant_id=? AND i.status NOT IN ('draft','cancelled') AND i.inv_date<date(?,'-30 day') GROUP BY c.id HAVING due>0 ORDER BY due DESC LIMIT 40`).all(t, today);
    const tasks = db.prepare(`SELECT id,title,due_date FROM tasks WHERE tenant_id=? AND status<>'done' AND due_date IS NOT NULL AND due_date<=date(?,'+2 day') ${A} ORDER BY due_date LIMIT 40`).all(t, today, ...a);
    const stages = db.prepare('SELECT stage, COUNT(*) n FROM leads WHERE tenant_id=? GROUP BY stage').all(t);
    res.json({ today, leads, tickets, nodate, dues, tasks, stages });
  });

  // ---- extras for the Home page ----
  app.get('/api/home-extra', L.need('admin', 'advocate', 'staff', 'accounts', 'telecaller'), (req, res) => {
    const t = T(req), out = {}, off = AI.getS(t, 'sa_off', '').split(',');
    if (!off.includes('accounts') && ['admin', 'advocate', 'accounts'].includes(req.user.role)) {
      const B = require('./books'), d = todayStr(), from = d.slice(0, 7) + '-01', r = B.build(t, from, d);
      out.books = { month: d.slice(0, 7), income_paise: r.total_income_paise, expense_paise: r.total_expense_paise, receivable_paise: r.receivable_paise, checks: r.checks.filter((c) => c.level === 'warn').length };
    }
    res.json(out);
  });
};
Object.assign(module.exports, { CATALOG });
