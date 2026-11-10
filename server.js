'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const L = require('./lib');
const { db } = L;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"] } },
}));
app.use(express.json({ limit: '3mb', verify: (req, _res, buf) => { if (req.url.startsWith('/api/whatsapp/webhook/')) req.rawBody = buf; } }));
app.use(cookieParser());
app.use(L.loadUser);
app.use(L.csrfGuard);
app.use(require('./routes/portalctl').mw);
// after a client / lead / matter is saved: push to Google Contacts, and greet a client whose WhatsApp number was just added
// any change to documents or to a client (new reference, rename, upload, move, delete) goes to Google Drive within a moment
app.use((req, res, next) => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && /^\/api\/(fs|clients|matters|documents|letters|register|upload|drafts)(\/|$)/.test(req.path)) res.on('finish', () => { if (res.statusCode < 300 && req.user) { try { require('./routes/drive').kick(req.user.tenant_id); } catch (e) {} } }); next(); });
app.use((req, res, next) => { if (['POST', 'PUT', 'PATCH'].includes(req.method) && /^\/api\/(clients|leads|matters)(\/|$)/.test(req.path)) res.on('finish', () => { if (res.statusCode < 300 && req.user) { const t = req.user.tenant_id; try { require('./routes/contacts').touch(t); require('./routes/whatsapp').welcomePending(t).catch((e) => console.error('welcome', e.message)); } catch (e) { console.error(e.message); } } }); next(); });

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes.' } });

// First run / upgrade: platform tenant + Super Admin, the KC LEGAL firm and its Admin.
const SUPER_EMAIL = (process.env.SUPERADMIN_EMAIL || 'consultbanerjee@gmail.com').toLowerCase();
const KC_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'kclegal.in@gmail.com').toLowerCase();
const siteUrl = () => process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000);
function invite(userId, label, email) {
  const token = L.rand(24);
  db.prepare('UPDATE users SET invite_token=?, invite_expires=? WHERE id=?').run(token, L.addDays(7), userId);
  console.log(`\n=== FIRST-TIME SETUP: ${label} (${email}) ===\nOpen this link to set the password (valid 7 days):\n${siteUrl()}/#/invite/${token}\n`);
}
function bootstrap() {
  const tpl = require('./routes/template');
  // 1. the KC LEGAL firm (existing installs already have it as the first tenant)
  let firm = db.prepare("SELECT * FROM tenants WHERE kind='firm' ORDER BY id LIMIT 1").get();
  if (!firm) {
    const id = db.prepare('INSERT INTO tenants(name,slug,prefix) VALUES (?,?,?)').run(process.env.FIRM_NAME || 'KC LEGAL', 'kclegal', process.env.FIRM_PREFIX || 'KC').lastInsertRowid;
    firm = db.prepare('SELECT * FROM tenants WHERE id=?').get(id);
    const ct = db.prepare('INSERT INTO consult_types(tenant_id,name,minutes,fee_paise) VALUES (?,?,?,?)');
    ct.run(id, 'Quick consultation', 20, 50000); ct.run(id, 'Detailed consultation', 45, 150000);
  }
  // 2. the platform tenant that only holds the Super Admin (never any client data)
  let plat = db.prepare("SELECT * FROM tenants WHERE kind='platform'").get();
  if (!plat) { const id = db.prepare("INSERT INTO tenants(name,slug,prefix,kind) VALUES ('Platform','platform','PF','platform')").run().lastInsertRowid; plat = { id }; }
  // 3. Super Admin: convert the old administrator account if it is the owner's, else create it
  let sup = db.prepare("SELECT * FROM users WHERE role='superadmin' LIMIT 1").get();
  if (!sup) {
    const old = db.prepare("SELECT * FROM users WHERE email=? AND role='admin' ORDER BY id LIMIT 1").get(SUPER_EMAIL);
    if (old) {
      db.prepare("UPDATE users SET role='superadmin', tenant_id=? WHERE id=?").run(plat.id, old.id);
      db.prepare('DELETE FROM availability WHERE user_id=?').run(old.id);
    } else {
      const r = db.prepare("INSERT INTO users(tenant_id,email,name,role) VALUES (?,?,?,'superadmin')").run(plat.id, SUPER_EMAIL, process.env.SUPERADMIN_NAME || 'Raja Satyajit Banerjee');
      invite(r.lastInsertRowid, 'Super Admin', SUPER_EMAIL);
    }
  }
  // 4. KC LEGAL's own Admin
  if (!db.prepare("SELECT 1 FROM users WHERE tenant_id=? AND role='admin'").get(firm.id)) {
    const r = db.prepare("INSERT INTO users(tenant_id,email,name,role) VALUES (?,?,?,'admin')").run(firm.id, KC_ADMIN_EMAIL, process.env.ADMIN_NAME || 'KC LEGAL Admin');
    invite(r.lastInsertRowid, 'KC LEGAL Admin', KC_ADMIN_EMAIL);
  }
  // 5. every firm gets a document template (KC LEGAL starts with its own letter pad)
  const AIc = require('./aicore');
  if (firm.slug === 'kclegal' && AIc.getS(firm.id, 'ai_drafting_rules_seeded') !== '1') {
    AIc.setS(firm.id, 'ai_drafting_rules_seeded', '1');
    if (!AIc.getS(firm.id, 'ai_drafting_rules')) AIc.setS(firm.id, 'ai_drafting_rules', [
      'The Advocate / Advocate-on-Record named in signature blocks and cover pages is Krishnika Chatterjee, KC LEGAL.',
      'Calcutta High Court writ petitions: service letter to GP/respondents, cover page, index of annexures, list of dates, synopsis, points of law, cause title, SHEWETH paras ("your petitioner states that"), grounds each beginning "FOR THAT", standard jurisdiction / no earlier petition / no alternative remedy / bona fide paras, prayers with Rule NISI and ad-interim relief, affidavit.',
      'Annexures are numbered P-1, P-2 in order of first mention, arranged chronologically. Write: "A copy of the said ___ dated ___ is enclosed herewith and marked as ANNEXURE P-__" (capital letters, not bold). If the document is not available, omit that sentence.',
      'Do not cite other cases by writ petition number or annex them; state the proposition and note that judgments will be handed up at the hearing.',
      'Tribunal / court pleadings (DRT etc.): Bookman Old Style, 12 pt throughout, justified body, centred headings, signature block right-aligned.',
      'Lease deeds for Falta SEZ units: interest on arrear rent at a flat 12% per annum compounded quarterly; rent and charges payable quarterly in advance within the first month of each quarter.',
    ].join('\n'));
  }
  for (const f of db.prepare("SELECT * FROM tenants WHERE kind='firm'").all()) tpl.ensureTemplate(f, f.id === firm.id && f.slug === 'kclegal');
}
bootstrap();

require('./routes/auth')(app, limiter);
require('./routes/core')(app);
require('./routes/business')(app, limiter);
require('./routes/template')(app);
require('./routes/platform')(app);
require('./routes/aiadmin')(app);
require('./routes/aidraft')(app);
require('./routes/aichat')(app);
require('./routes/aimail')(app);
require('./routes/clientbooks')(app);
require('./routes/portalctl')(app);
require('./routes/meet')(app);
require('./routes/whatsapp')(app);
require('./routes/upi')(app);
require('./routes/payees')(app);
require('./routes/bankstmt')(app);
require('./routes/reminders')(app);
require('./routes/invsend')(app);
require('./routes/calendar')(app);
require('./routes/contacts')(app);
require('./routes/drive')(app);
require('./routes/files')(app);
require('./routes/register')(app);
require('./routes/news')(app);

app.get('/chat.js', (req, res, next) => { res.set('Cross-Origin-Resource-Policy', 'cross-origin'); res.set('Cache-Control', 'public, max-age=300'); next(); });
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is larger than 25 MB.' });
  console.error(err); res.status(500).json({ error: 'Something went wrong.' });
});

// housekeeping: clear expired sessions hourly
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expires_at<?').run(L.nowIso()); } catch (e) {} }, 3600000).unref();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('KC LEGAL portal listening on', port));
  require('./routes/aimail').startWorker();
  require('./routes/drive').startWorker();
  require('./routes/meet').startWorker();
  require('./routes/payees').startWorker();
  require('./routes/reminders').startWorker();
  require('./routes/invsend').startWorker();
  require('./routes/calendar').startWorker();
  require('./routes/contacts').startWorker();
  require('./routes/news').startWorker();
}
module.exports = app;
