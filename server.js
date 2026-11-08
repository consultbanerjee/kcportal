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
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());
app.use(L.loadUser);
app.use(L.csrfGuard);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes.' } });

// First run: create the firm and an administrator with a one-time invitation link.
function bootstrap() {
  let t = db.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
  if (!t) {
    const id = db.prepare('INSERT INTO tenants(name,slug,prefix) VALUES (?,?,?)').run(process.env.FIRM_NAME || 'KC LEGAL', 'kclegal', process.env.FIRM_PREFIX || 'KC').lastInsertRowid;
    t = db.prepare('SELECT * FROM tenants WHERE id=?').get(id);
    const ct = db.prepare('INSERT INTO consult_types(tenant_id,name,minutes,fee_paise) VALUES (?,?,?,?)');
    ct.run(id, 'Quick consultation', 20, 50000); ct.run(id, 'Detailed consultation', 45, 150000);
  }
  if (!db.prepare("SELECT 1 FROM users WHERE tenant_id=? AND role='admin'").get(t.id)) {
    const email = (process.env.ADMIN_EMAIL || 'consultbanerjee@gmail.com').toLowerCase();
    const token = L.rand(24);
    db.prepare("INSERT INTO users(tenant_id,email,name,role,invite_token,invite_expires) VALUES (?,?,?,'admin',?,?)")
      .run(t.id, email, process.env.ADMIN_NAME || 'Raja Satyajit Banerjee', token, L.addDays(7));
    console.log('\n=== FIRST-TIME SETUP ===\nOpen this link to set the administrator password (valid 7 days):\n' +
      (process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000)) + '/#/invite/' + token + '\n');
  }
}
bootstrap();

require('./routes/auth')(app, limiter);
require('./routes/core')(app);
require('./routes/business')(app, limiter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
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
}
module.exports = app;
