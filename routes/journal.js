'use strict';
// BUILD JOURNAL (Super Admin only): the living record of how this portal is built, what it uses, what it costs to run,
// how to operate it, how it is protected and what each release changed. The built-in text below is updated with every release;
// the Super Admin adds dated notes and keeps the running-cost register. Download as Word or PDF.
const L = require('../lib');
const AI = require('../aicore');
const X = require('../exportdoc');
const { db, audit } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS journal_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), author TEXT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS cost_register (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fixed', amount_paise INTEGER NOT NULL DEFAULT 0, cycle TEXT NOT NULL DEFAULT 'monthly', notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
if (!db.prepare('SELECT 1 FROM cost_register LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO cost_register(name,kind,amount_paise,cycle,notes) VALUES (?,?,?,?,?)');
  for (const r of [
    ['Hostinger VPS (server)', 'fixed', 0, 'monthly', 'Holds the portal, its database and files. Enter the amount from your Hostinger invoice.'],
    ['Domain name(s) (kclegal.us and others)', 'fixed', 0, 'yearly', 'Renewal fee.'],
    ['Titan Mail mailbox(es)', 'fixed', 0, 'monthly', 'One per firm mailbox that the e-mail assistant and the portal use.'],
    ['Anthropic (Claude) usage', 'variable', 0, 'monthly', 'Pay-as-you-go by tokens. The portal meters it per firm (Platform → AI usage and cost); no amount to type here.'],
    ['eCourtsIndia (court data)', 'variable', 0, 'monthly', 'Pay-as-you-go: search ₹0.60, case ₹1.50, order PDF ₹3.75, order with AI ₹7.50, refresh ₹0.15, cause list ₹3.00, legal check ₹99. The portal estimates it per firm.'],
    ['Meta WhatsApp Business (conversation charges)', 'variable', 0, 'monthly', 'Charged by Meta per conversation as per its current rate card; template messages only.'],
    ['Google Workspace / Google Cloud', 'fixed', 0, 'monthly', 'Drive storage of the firm that connects it; the OAuth app itself is free.'],
    ['GitHub (private repository)', 'fixed', 0, 'monthly', 'Free tier is enough; keep the repository PRIVATE.'],
  ]) ins.run(...r);
}

const VERSION = '5.1.1';
const BUILD_DATE = '12 November 2026';

// ------------------------------------------------------------------ built-in text (updated with every release)
const PURPOSE = [
  'A white-label "eOffice" for Indian law firms: one portal on which a firm runs clients, cases, court dates, files, drafting, accounts, e-mail and WhatsApp communication, with a separate login for its clients.',
  'It is built to be sold to many firms. The owner (Super Admin) is the only person who can set up, switch on, switch off, bill and monitor any firm. A firm only ever sees the working screens, never the machinery behind them.',
  'First firm on the platform: KC LEGAL, Kolkata (the owner\'s own firm). Portal address: portal.kclegal.us.',
].join('\n');

const STACK = [
  ['Language and runtime', 'JavaScript everywhere. Server: Node.js 22 with Express 5. Browser: plain JavaScript single-page app (hash router) with no framework and no external CDN.'],
  ['Database', 'SQLite (better-sqlite3) in one file under /data, one database for all firms, every row carries its firm (tenant) id. Additive migrations only; nothing is ever dropped.'],
  ['Secrets', 'All keys and passwords are stored AES-256-GCM encrypted in the database; the master key is a file in /data (or the SECRET_KEY setting). Keys are never shown again after saving.'],
  ['Documents', 'pdf-lib + fontkit (PDF), docx (Word), qrcode (UPI QR), mammoth (read Word files), imapflow + nodemailer + mailparser (mail), a small built-in .xlsx writer.'],
  ['Hosting', 'Hostinger VPS (Ubuntu 24.04), Docker Compose with two containers: the portal and Caddy (automatic HTTPS certificates, reverse proxy). Data and backups live in /opt/kcportal/data and /opt/kcportal/backups.'],
  ['Code home', 'Private GitHub repository consultbanerjee/kcportal. Releases are uploaded to GitHub by the owner; the server pulls them and rebuilds the container.'],
  ['Front-end delivery', 'The sign-in shell is public. Every other script is served only to a signed-in user; Super Admin scripts only to the Super Admin. The production build minifies and obfuscates all scripts.'],
  ['Build and image','A two-stage Docker build: stage 1 minifies and obfuscates every browser script (build.js: terser + javascript-obfuscator) into dist/; stage 2 is the running image, which contains only the server code, dist/ and production libraries. The readable browser source, tests and notes never enter the running image.'],
  ['Time and language', 'All dates in India time (IST, UTC+5:30). Indian number format and ₹ throughout.'],
];

// module -> files -> outside service -> where it is set up (Super Admin) -> what drives the cost
const MODULES = [
  ['Sign-in, users, roles', 'routes/auth.js, lib.js', '—', 'Super Admin → Firms', 'none', 'Roles: superadmin, admin, advocate, staff, telecaller, accounts, client. Passwords hashed (bcrypt), sessions in database cookies, invitation links valid 7 days, password reset link valid 30 minutes.'],
  ['Clients, cases, tasks, letters, In-Out Register', 'routes/core.js, business.js, register.js', '—', '—', 'none', 'The core office work. All firm data is separated by tenant id.'],
  ['Files (explorer) and Google Drive mirror', 'routes/files.js, drive.js', 'Google Drive API (OAuth)', 'Super Admin → firm → Google', 'Google storage of the firm', 'Files are written on the server first, then mirrored to the firm\'s Google Drive folder tree. Client folders are named by reference.'],
  ['Google Calendar, Meet, Contacts', 'routes/meet.js, calendar.js, contacts.js', 'Google Calendar, Meet REST, People APIs', 'Super Admin → firm → Google', 'none', 'Meet links for paid consultations; court holiday calendars; two-way contacts sync (first name "Cl-<client>").'],
  ['Accounts, invoices, receipts, books', 'routes/business.js, books.js, clientbooks.js, payees.js, bankstmt.js, invsend.js, xlsxw.js', 'Claude (bank PDF reading only)', 'Super Admin → firm → Claude', 'tokens (small)', 'Invoices with payment QR, receipts, cash book, ledger, trial balance, ageing, payables, bank-statement import and reconciliation, Excel and audit pack. GST/TDS not yet in the books.'],
  ['UPI collection', 'routes/upi.js', '— (UPI deep links and QR)', 'Firm → Settings (UPI id)', 'none', 'The firm\'s own UPI id is the only payment detail a firm enters itself.'],
  ['AI Drafting Desk', 'routes/aidraft.js, drafthouse.js, draftdoc.js, aicore.js', 'Anthropic Claude API', 'Super Admin → firm → Claude and AI', 'tokens', 'Drafts notices, petitions, writs, suits, replies from the client\'s own documents using the firm\'s drafting rules and the forum\'s page format; Word and PDF; annexure PDFs in order.'],
  ['Case arguments, drawbacks, research', 'routes/caseargs.js', 'Claude + web search (Indian legal sites only)', 'Super Admin → firm → Claude and AI', 'tokens + search', 'Reads every document in the case folder, finds the prayer, searches Indian judgments only (tribunal first for tribunal cases), reads the precedents relied on, checks whether each was overruled, saves judgments as "x vs y _ date". Nightly at 3 am IST.'],
  ['Case history', 'routes/casehistory.js', '—', '—', 'none', 'Precise dated chronology as Word and PDF; refreshed nightly at 4 am IST when saved.'],
  ['Court data (eCourts)', 'routes/ecourts.js, ecourtpdf.js', 'eCourtsIndia partner API (webapi.ecourtsindia.com)', 'Super Admin → firm → Court data', 'per lookup', 'Search, full record, orders, cause list, linked-case tracking. Court record PDF/Word and Order1_date files kept in Files; daily at 2 am IST.'],
  ['AI e-mail assistant', 'routes/aimail.js', 'Claude + the firm\'s mailbox (Titan: imap.titan.email / smtp.titan.email)', 'Super Admin → firm → Mailbox', 'tokens + mailbox', 'Reads the mailbox, triages, drafts replies; staff approve or replies go out after a delay for routine enquiries; court/urgent/legal matters always wait for a person.'],
  ['Website chat assistant', 'routes/aichat.js, public/chat.js', 'Claude', 'Super Admin → firm → Claude and AI', 'tokens', 'Chat widget for the firm\'s public website; saves leads and tickets; daily message cap.'],
  ['WhatsApp', 'routes/whatsapp.js', 'Meta WhatsApp Business Cloud API', 'Super Admin → firm → WhatsApp', 'Meta conversation charges', 'Approved templates for business-started messages; webhook brings delivery ticks and replies; STOP opt-out honoured.'],
  ['Payment reminders', 'routes/reminders.js', 'WhatsApp / e-mail', 'Super Admin → firm → Automation', 'WhatsApp / mail', 'Daytime reminders with a UPI link for the exact pending amount.'],
  ['Alerts (weekly self-test)', 'routes/alerts.js', '—', '—', 'none', 'Lists every fault found with severity and a "Go there" link; messages to a firm never reveal how the portal is built.'],
  ['Repository, judgments, news feed', 'routes/extras.js, news.js', 'Public legal sites (links only)', '—', 'none', 'Curated official links, link self-check weekly, headline feed for the public website.'],
  ['Platform: firms, plans, billing, usage', 'routes/platform.js, superadmin.js, control.js', '—', 'Super Admin', 'none', 'Plans and module switches, service switches, AI and court-data usage meter, monthly subscription invoices, dues and auto-suspend.'],
  ['Start page: clock and weather', 'routes/control.js (weather), public views', 'Open-Meteo (free, no key)', 'Super Admin → firm → Home page (city)', 'none', 'Live India time and local weather on the start page; weather is fetched by the server and cached 20 minutes.'],
  ['Build Journal', 'routes/journal.js', '—', 'Super Admin → Build Journal', 'none', 'This document.'],
];

const OPERATE = [
  ['Add a new law firm', '1. Super Admin → Firms → Add firm: firm name, number prefix (for example KC), administrator name and e-mail.\n2. Copy the one-time invitation link and send it to the firm\'s administrator (valid 7 days).\n3. Open the firm\'s Configure page. Everything is OFF by default. Choose the plan, then switch on only the services the firm has paid for.\n4. Claude and AI tab: set the drafting rules and models; the platform Anthropic key is used unless you give the firm its own key.\n5. Mailbox, WhatsApp, Court data and Google tabs: enter the firm\'s details once; test each.\n6. Home page tab: set the city for the weather.\n7. Tell the firm\'s administrator to open Settings → Who can use what and decide which of its staff may use each service.'],
  ['Switch a running-cost service on or off', 'Super Admin → Firms → Services. One row per service. The first column is the platform master (off stops it for every firm). The other columns are per firm. A firm cannot switch anything on by itself; it can only share what you gave it with its own staff.'],
  ['What a firm\'s administrator can do', 'Open or close the client portal, set consultation types and fees, enter its UPI id, design its letterhead and invoices, manage its team, and give each role (advocate, staff, telecaller, accountant) access to the services you have activated. Nothing else about AI, mail, WhatsApp, court data, Drive or automation is visible or changeable by a firm.'],
  ['Money: how a firm is billed', 'Platform → Billing generates one invoice per firm per month: plan fee + AI usage (tokens x your rates x the firm\'s markup) when "include AI in invoice" is on. Platform → AI usage and cost shows your own cost. Set the rates from Anthropic\'s current price list. Court-data cost is estimated from the published per-lookup prices.'],
  ['Daily rhythm (all India time)', '2 am: court data refresh and archive of every linked open case.\n3 am: case arguments and drawbacks refreshed for cases that changed (daily cap per firm).\n4 am: saved case histories refreshed.\nEvery 5 minutes (when on): mailbox check for the e-mail assistant.\nWeekly: portal self-test (Alerts) and repository link check.\nMonthly (1st, if switched on): subscription invoices.'],
  ['Releasing a new version', '1. I (Claude) build the release and give you zips of under 100 files each (GitHub\'s upload limit).\n2. You upload them to the GitHub repository (Add file → Upload files), commit, and say "uploaded".\n3. Deploy on the server (hPanel → VPS → Web console): cd /opt/kcportal; git checkout -- .; git pull; docker compose up -d --build.\n4. Check the sign-in page and Super Admin → Build Journal shows the new version.\nBackups run through backup.sh; keep an off-server copy.'],
  ['If something looks wrong', 'Check Alerts on the firm\'s side and Platform → AI usage for runaway cost. A service can be switched off instantly per firm without touching anything else. Server logs: docker logs kcportal-portal-1.'],
];

const SECURITY = [
  ['Secrets never leave the server', 'Keys, tokens and passwords are encrypted in the database and are never sent to any browser, firm or log.'],
  ['Nothing about the machinery is visible to a firm', 'AI keys, models, drafting rules, prompts, mailbox details, WhatsApp tokens, court-data keys, Drive credentials and every automation setting are reachable only through the Super Admin screens. The server answers "not found" if a firm user even asks for them.'],
  ['Super Admin reaches set-up screens only', 'The Super Admin acts on a firm only through a short list of set-up paths. It cannot open a firm\'s clients, cases or files. Every such change is written to the audit log.'],
  ['Code is not handed out', 'All business logic (drafting prompts, research method, billing, automations) runs on the server and is never downloadable. Browser scripts are served only after sign-in, Super Admin scripts only to the Super Admin, and are minified and obfuscated in production. No source maps, no test files and no notes are shipped in the container.'],
  ['Transport and headers', 'HTTPS only (Caddy, HSTS), strict Content-Security-Policy (own scripts only, no framing), no x-powered-by, no-store on API answers, noindex for search engines, Permissions-Policy and Referrer-Policy.'],
  ['Brute force and scraping', 'Login attempts are limited and locked out; every API call is rate-limited per address; known scraping and automation user-agents are refused; unsigned-in visitors cannot reach any application script or API.'],
  ['Two-step sign-in (optional, recommended)', 'Super Admin and firm administrators can protect their login with an authenticator app (6-digit code). Turn it on from Account.'],
  ['Per-firm separation', 'Every record carries the firm id and every query filters by it; the plan, module and service switches are checked on the server for every request, not just hidden in the menu.'],
  ['Recommended outside the code (do these)', '1. Keep the GitHub repository PRIVATE; turn on two-factor sign-in for GitHub, Hostinger, Google and your e-mail.\n2. Sell the portal as a hosted service only. Never give a firm the source code, the Docker image or server access.\n3. Put every firm under a written agreement: no copying, no reverse engineering, no sharing of logins, confidentiality of the product, IP ownership, termination. Register the copyright of the software and the trademark of the product name.\n4. Put Cloudflare (free plan) in front of the domain for DDoS and bot protection; keep the Hostinger firewall on and allow only ports 80, 443 and SSH; use SSH keys, not passwords; install fail2ban.\n5. Take an encrypted copy of /opt/kcportal/data off the server every day (Google Drive or another cloud) and test a restore once a month.\n6. Give each firm only the services it pays for; review Platform → AI usage and cost weekly.\n7. Do not post screenshots or screen recordings of the Super Admin screens publicly.'],
];

const RELEASES = [
  ['v2.5 – v3.0', 'First production releases: clients, cases, tasks, letters, invoices, receipts, appointments with UPI payment and Google Meet, WhatsApp through Meta, e-mail assistant and website chat assistant, Google Drive storage, calendar and contacts sync, In-Out Register.'],
  ['v4.0', 'White-label foundation: Super Admin with plans, module switches, Claude switch, token and cost meter, subscription invoices, dues and auto-suspend; full accounts (trial balance, ageing, bank reconciliation, audit pack); Repository; consent records; follow-ups; limitation calculator.'],
  ['v4.2 – v4.3', 'One login page for all roles with per-firm login links; forgot-password by e-mail; Repository sections for courts, tribunals, forums and authorities with a weekly link self-check.'],
  ['v4.4', 'Payment QR on invoices; document design page regrouped.'],
  ['v4.5', 'AI Drafting: Word and PDF buttons; KC LEGAL standing drafting rules kept in step with the instructions used on claude.ai; weekly Alerts self-test.'],
  ['v4.6', 'Court data (eCourts): search, case record, orders, cause list, daily 2 am update, a physical copy of every record and order kept in Files.'],
  ['v4.7', 'Arguments and drawbacks for every case with Indian-only judgment research, tribunal-first search, precedent reading and overruled check; case history; Word and PDF for every download except Accounts. Deployed 11 November 2026 after fixing a missing server file and the Dockerfile file list; eCourts search filters corrected after the first live test.'],
  ['v5.0', 'Control plane and protection release:\n- Super Admin service switches: a master switch and a per-firm switch for every running-cost service (Claude drafting, case arguments, e-mail assistant, website chat, court data, WhatsApp, outgoing e-mail, reminders, Google). New firms start with everything OFF.\n- Firm administrators give their own roles access only to what Super Admin activated (Settings → Who can use what).\n- All set-up of AI, mailbox, WhatsApp, court data, Google Drive/Calendar/Contacts, reminders, birthday greetings and nightly jobs moved under Super Admin → firm → Configure; removed from every firm screen and locked on the server.\n- Code protection: scripts served only after sign-in, Super Admin scripts only to the Super Admin, production obfuscation, anti-scraping, extra security headers, optional two-step sign-in.\n- Start page: live India time and local weather, refreshed design.\n- Build Journal with running-cost register and Word/PDF download.'],
  ['v5.0.1 – v5.0.2', 'Platform settings layout fix; Build Journal Overview fix.'],
  ['v5.0.3', 'Case page in the familiar court-portal format, for every firm: Case No. in red as the court writes it (for example "Complaint Case No. 44 of 2019" with its date), Registration No. with its date, filing number, stage, CNR, act; next hearing with court and item number; advocates and judges; tabs for Listings, Orders (date, next hearing, summary, PDF), IA and History; Notings at the end, then Files in explorer view. The court-record Word/PDF now carries the same case and registration numbers.'],
  ['v5.0.4', 'Case team and app-friendly case page, for every firm: assign a case to one or more advocates with View, Work or Full rights; the firm administrator can restrict advocates and staff to their assigned cases (off by default); fee bills, client files and client list follow the same rights; case-health chips (next date, unpaid bills, no documents, open tasks, my access); phone action bar (call, WhatsApp, hearing, noting) for the installed app. File movement: hand a case to any staff member, advocate or telecaller, returnable by a date (24 hours if none); on expiry WhatsApp and e-mail ask them to attend at once, a reminder follows after 2 days, and after one more day the file goes back to the firm administrator for fresh allocation (days adjustable by the firm).'],
  ['v5.0.5 (11 November 2026)', 'Case Diary, for every firm: a dated step-by-step record on each case (first meeting, advice, notice drafted and sent, delivery, reply or no reply, advice to file, case drafted, filed, copy service) together with the court\'s own hearings, next dates and orders read in from eCourts; add any entry by hand with its own date and narration, drag or use the arrows to place entries anywhere, sort by date, edit (old version kept) or remove; stage bar; notice reply clock (default 15 days, restarts from the delivery date) with a "no reply" entry and an alert to the holder of the file when it ends; entries can be shown to the client. New client from the case form: choose "+ Add new client…" in the client drop-down when adding a case (also when adding a case from Court search). Activity log: every sign-in, sign-out, entry, change and deletion by everyone, with date and time (Indian time), shown to the firm administrator for their firm and to the Super Admin for every firm, downloadable as Word or PDF. Delete a case: moves it to Deleted cases (restorable by the firm administrator, permanent removal only by the administrator; cases with issued bills cannot be deleted).'],
  ['v5.0.6 (12 November 2026)', 'For every firm: (1) an Advocate sees only the cases allotted to him or created by him, and none of the other modules, unless the firm administrator switches each one on under Team > What advocates and staff can see (staff work the same way; assigned cases and tasks are always visible to them). Accountants see only Accounts, and telecallers only calling and CRM. (2) When a case or file is deleted it disappears from the client\'s side too. (3) Deleting a case or a file only moves it to the Recycle Bin: the firm administrator can restore it at any time and its papers stay in Google Drive; only the Super Admin can delete for good (Configure > Recycle Bin). (4) A client left with no open case gets 7 days\' notice by WhatsApp, e-mail and a pop-up at sign-in, after which the login is switched off; a new case brings it back.'],
  ['v5.1.1 (this release, ' + BUILD_DATE + ')', 'For every firm: the portal can now be installed on a phone from the website (Add to Home Screen) and an Android app can be built for any firm from the android folder (see android/README.md); times in Recent activity now show India time; the start page greets the administrator by full name.'],
  ['v5.1.0', 'For every firm: compact redesign with only three text sizes (10, 12 and 14) and bold where needed; a clean start page; a famous Quote of the Day for everyone (changes at midnight India time, so it stays 24 hours); the Research Desk (ask a legal question answered under Indian law with precedents checked for being overruled; keyword, citation, party, Act and judge search over the firm\'s judgments with links to official sources; overruled check; save an answer to a case) with two switches, one for the Super Admin in Plan and modules and one for the firm in Firm settings; white-label clean-up (page title, privacy page and defaults now take the firm\'s own name and details); advocates\' and staff\' start-page figures limited to their own work.'],
];

const RULES = [
  'Every download offers Word and PDF, except in Accounts.',
  'Portal AI research uses judgments from India and Indian courts only; for a tribunal case the same tribunal is searched first; precedents relied on are read, mentioned on the argument page and checked for being overruled.',
  'The Advocate / Advocate-on-Record in drafts is Krishnika Chatterjee.',
  'Each release is cumulative (everything in one package) and handed over as zips of under 100 files each.',
  'The public WordPress website kclegal.us is not touched until design-v4 is approved by the owner.',
  'No password, API key, token or card/bank number is ever typed by Claude; the owner enters them himself.',
];

// ------------------------------------------------------------------ helpers
const rupee = (p) => '₹' + ((p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perMonth = (r) => (r.cycle === 'yearly' ? Math.round(r.amount_paise / 12) : r.cycle === 'quarterly' ? Math.round(r.amount_paise / 3) : r.amount_paise);

function live() {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const month = new Date(Date.now() + 19800000).toISOString().slice(0, 7);
  const R = { rin: parseFloat(AI.getS(0, 'sa_rate_in', '3')) || 0, rout: parseFloat(AI.getS(0, 'sa_rate_out', '15')) || 0, fx: parseFloat(AI.getS(0, 'sa_usd_inr', '88')) || 0 };
  const u = db.prepare("SELECT COALESCE(SUM(in_tok),0) i, COALESCE(SUM(out_tok),0) o, COUNT(*) c FROM ai_usage WHERE created_at>=?").get(month + '-01');
  const aiCost = Math.round(((u.i * R.rin + u.o * R.rout) / 1e6) * R.fx * 100);
  let ec = 0; try { ec = db.prepare("SELECT COALESCE(SUM(cost_paise),0) c FROM ecourt_usage WHERE created_at>=?").get(month + '-01').c; } catch (e) {}
  const fixed = db.prepare("SELECT * FROM cost_register WHERE kind='fixed'").all().reduce((a, r) => a + perMonth(r), 0);
  return { month, version: VERSION, firms: n("SELECT COUNT(*) n FROM tenants WHERE kind='firm'"), users: n("SELECT COUNT(*) n FROM users WHERE role<>'client' AND role<>'superadmin' AND active=1"), clients: n('SELECT COUNT(*) n FROM clients'), matters: n('SELECT COUNT(*) n FROM matters'),
    ai_calls: u.c, ai_cost_paise: aiCost, ecourts_cost_paise: ec, fixed_month_paise: fixed, total_month_paise: fixed + aiCost + ec };
}

function spec() {
  const lv = live(), notes = db.prepare('SELECT * FROM journal_notes ORDER BY id DESC').all(), cost = db.prepare('SELECT * FROM cost_register ORDER BY kind, id').all();
  return {
    firm: 'KC LEGAL — White-label Law Firm Portal', title: 'Build Journal', subtitle: `Version ${VERSION} · generated ${new Date(Date.now() + 19800000).toISOString().slice(0, 16).replace('T', ' ')} IST · CONFIDENTIAL — owner only`,
    sections: [
      { heading: '1. What this portal is', text: PURPOSE },
      { heading: '2. Position today', kv: [['Version', VERSION], ['Firms', String(lv.firms)], ['Office users', String(lv.users)], ['Clients', String(lv.clients)], ['Cases', String(lv.matters)], ['AI calls this month', String(lv.ai_calls)], ['Estimated running cost this month', rupee(lv.total_month_paise)]] },
      { heading: '3. How it is built', kv: STACK },
      { heading: '4. What is used where', cols: [{ h: 'Module', w: 2 }, { h: 'Files', w: 2 }, { h: 'Outside service', w: 2 }, { h: 'Set up at', w: 2 }, { h: 'Cost driver', w: 1.2 }, { h: 'Notes', w: 4 }], rows: MODULES },
      { heading: '5. Running costs', cols: [{ h: 'Item', w: 3 }, { h: 'Type', w: 1 }, { h: 'Amount', w: 1.3 }, { h: 'Cycle', w: 1 }, { h: 'Per month', w: 1.3 }, { h: 'Notes', w: 5 }], rows: cost.map((r) => [r.name, r.kind === 'fixed' ? 'fixed' : 'usage', r.kind === 'fixed' ? rupee(r.amount_paise) : '—', r.kind === 'fixed' ? r.cycle : 'by use', r.kind === 'fixed' ? rupee(perMonth(r)) : '—', r.notes]) },
      { text: `Fixed per month ${rupee(lv.fixed_month_paise)} · Claude this month ${rupee(lv.ai_cost_paise)} (estimate) · Court data this month ${rupee(lv.ecourts_cost_paise)} (estimate) · Total ${rupee(lv.total_month_paise)}.` },
      { heading: '6. How to run it (Super Admin)', text: OPERATE.map(([h, b]) => h.toUpperCase() + '\n' + b).join('\n\n') },
      { heading: '7. Security and protecting our idea', text: SECURITY.map(([h, b]) => h.toUpperCase() + '\n' + b).join('\n\n') },
      { heading: '8. House rules that govern every build', text: RULES.map((r, i) => (i + 1) + '. ' + r).join('\n') },
      { heading: '9. Release history', cols: [{ h: 'Version', w: 1.2 }, { h: 'What changed', w: 8 }], rows: RELEASES },
      { heading: '10. Owner\'s notes (dated)', cols: [{ h: 'Date', w: 1.3 }, { h: 'Title', w: 2 }, { h: 'Note', w: 6 }], rows: notes.map((n) => [n.created_at.slice(0, 10), n.title, n.body]) },
    ],
  };
}

module.exports = (app) => {
  const SA = L.need('superadmin');
  app.get('/api/platform/journal', SA, (req, res) => {
    res.json({ version: VERSION, built: BUILD_DATE, purpose: PURPOSE, stack: STACK, modules: MODULES, operate: OPERATE, security: SECURITY, releases: RELEASES, rules: RULES, live: live(),
      notes: db.prepare('SELECT * FROM journal_notes ORDER BY id DESC').all(), cost: db.prepare('SELECT * FROM cost_register ORDER BY kind, id').all().map((r) => ({ ...r, per_month_paise: perMonth(r) })) });
  });
  app.post('/api/platform/journal/notes', SA, (req, res) => {
    const t = L.str(req.body.title, 160), b = L.str(req.body.body, 6000); if (!t) return res.status(400).json({ error: 'Give the note a title.' });
    const id = db.prepare('INSERT INTO journal_notes(author,title,body) VALUES (?,?,?)').run(req.user.name, t, b).lastInsertRowid;
    audit(null, req.user.id, 'journal_note', 'journal', id, t, L.ip(req)); res.json({ id });
  });
  app.delete('/api/platform/journal/notes/:id', SA, (req, res) => { db.prepare('DELETE FROM journal_notes WHERE id=?').run(L.int(req.params.id)); res.json({ ok: true }); });
  app.post('/api/platform/journal/cost', SA, (req, res) => {
    const b = req.body || {}, name = L.str(b.name, 120); if (!name) return res.status(400).json({ error: 'Give the item a name.' });
    const amt = Math.round(Number(b.amount || 0) * 100); if (!(amt >= 0 && amt < 1e11)) return res.status(400).json({ error: 'Enter a valid amount.' });
    const kind = b.kind === 'variable' ? 'variable' : 'fixed', cycle = ['monthly', 'quarterly', 'yearly'].includes(b.cycle) ? b.cycle : 'monthly';
    if (b.id) db.prepare("UPDATE cost_register SET name=?, kind=?, amount_paise=?, cycle=?, notes=?, updated_at=datetime('now') WHERE id=?").run(name, kind, amt, cycle, L.str(b.notes, 600), L.int(b.id));
    else db.prepare('INSERT INTO cost_register(name,kind,amount_paise,cycle,notes) VALUES (?,?,?,?,?)').run(name, kind, amt, cycle, L.str(b.notes, 600));
    audit(null, req.user.id, 'cost_register', 'journal', null, name, L.ip(req)); res.json({ ok: true });
  });
  app.delete('/api/platform/journal/cost/:id', SA, (req, res) => { db.prepare('DELETE FROM cost_register WHERE id=?').run(L.int(req.params.id)); res.json({ ok: true }); });
  app.get('/api/platform/journal/download/:fmt', SA, async (req, res) => {
    const f = req.params.fmt; if (!['docx', 'pdf'].includes(f)) return res.status(404).json({ error: 'Not found.' });
    try { audit(null, req.user.id, 'journal_download', 'journal', null, f, L.ip(req)); X.send(res, await X.build(spec(), f), f, `Build Journal v${VERSION}.${f}`); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Could not make the file.' }); }
  });
};
Object.assign(module.exports, { spec, live, VERSION });
