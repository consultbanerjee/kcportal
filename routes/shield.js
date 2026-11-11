'use strict';
// SHIELD: protection of the product itself.
//  - security headers on every answer; API answers are never cached
//  - machines (scrapers, scripting tools, headless browsers) are refused in production
//  - request limits per signed-in session and per address
//  - application scripts are served only to a signed-in user (Super Admin scripts only to the Super Admin)
//  - optional two-step sign-in (authenticator app) for any user
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const QR = require('qrcode');
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

for (const [col, def] of [['totp_secret', 'TEXT'], ['totp_pending', 'TEXT'], ['totp_on', 'INTEGER NOT NULL DEFAULT 0']]) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) without any library ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = (buf) => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const b32dec = (s) => { let bits = ''; for (const c of String(s).toUpperCase().replace(/=+$/, '')) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
function hotp(secret, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest(), o = h[h.length - 1] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}
const totpOk = (secret, code) => { const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c) || !secret) return false; const n = Math.floor(Date.now() / 30000); for (const d of [-1, 0, 1]) if (hotp(secret, n + d) === c) return true; return false; };
const newSecret = () => b32enc(crypto.randomBytes(20));

// ---- where the web files live (a protected production build if present) ----
const ROOT = path.join(__dirname, '..');
const webRoot = () => (fs.existsSync(path.join(ROOT, 'dist', 'public', 'index.html')) ? path.join(ROOT, 'dist') : ROOT);

const BOT = /(curl|wget|python|requests|scrapy|httpclient|http-client|libwww|go-http|java\/|okhttp|aiohttp|httpx|node-fetch|undici|axios|headless|phantom|selenium|puppeteer|playwright|crawler|spider|scraper|harvest|httrack|nikto|sqlmap|masscan|nmap|zgrab|postman|insomnia|bot\b)/i;
const BOT_OK = /^\/(api\/whatsapp\/webhook\/|api\/storage\/callback|chat\.js|api\/chat\/)/;

module.exports = (app) => {
  const prod = process.env.NODE_ENV === 'production';
  app.use((req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()', 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet' });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (prod && !BOT_OK.test(req.path)) {
      const ua = String(req.headers['user-agent'] || '');
      if (!ua || BOT.test(ua)) return res.status(403).type('text').send('Forbidden');
    }
    next();
  });
  // request limits: per signed-in session, otherwise per address
  const lim = rateLimit({ windowMs: 15 * 60 * 1000, limit: (req) => (req.cookies && req.cookies.kc_session ? 3000 : 300), standardHeaders: false, legacyHeaders: false,
    keyGenerator: (req) => (req.cookies && req.cookies.kc_session ? 's:' + req.cookies.kc_session.slice(0, 24) : 'i:' + rateLimit.ipKeyGenerator(req.ip || '')), skip: (req) => !req.path.startsWith('/api/') || BOT_OK.test(req.path),
    message: { error: 'Too many requests. Please slow down.' } });
  app.use(lim);

  // robots: this is a private working portal
  app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));

  // application scripts: only after sign-in
  app.get(/^\/x\/([a-z0-9-]+)\.js$/, (req, res) => {
    const name = req.params[0], u = req.user;
    if (!u) return res.status(404).type('text').send('Not found');
    const sa = name.startsWith('sa-');
    if (sa !== (u.role === 'superadmin')) return res.status(404).type('text').send('Not found');
    const f = path.join(webRoot(), 'private', name + '.js');
    if (!fs.existsSync(f)) return res.status(404).type('text').send('Not found');
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(f);
  });
  // which scripts this user needs (names only)
  app.get('/api/bundle', L.requireLogin, (req, res) => {
    const f = path.join(webRoot(), 'private', 'manifest.json'); let m = {};
    try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    res.json({ files: req.user.role === 'superadmin' ? (m.sa || []) : (m.core || []) });
  });

  // ---- two-step sign-in ----
  const me = (req) => db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  app.get('/api/2fa', L.requireLogin, (req, res) => res.json({ on: !!me(req).totp_on }));
  app.post('/api/2fa/start', L.requireLogin, async (req, res) => {
    const u = me(req); if (u.totp_on) return res.status(400).json({ error: 'Two-step sign-in is already on.' });
    const s = newSecret(); db.prepare('UPDATE users SET totp_pending=? WHERE id=?').run(AI.enc(s), u.id);
    const issuer = (db.prepare('SELECT name FROM tenants WHERE id=?').get(u.tenant_id) || {}).name || 'Portal';
    const uri = `otpauth://totp/${encodeURIComponent(issuer + ':' + u.email)}?secret=${s}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret: s.match(/.{1,4}/g).join(' '), qr: await QR.toDataURL(uri, { margin: 1, width: 220 }) });
  });
  app.post('/api/2fa/enable', L.requireLogin, (req, res) => {
    const u = me(req), s = AI.dec(u.totp_pending || '');
    if (!s || !totpOk(s, req.body.code)) return res.status(400).json({ error: 'That code is not correct. Check the time on your phone and try the next code.' });
    db.prepare('UPDATE users SET totp_secret=?, totp_pending=NULL, totp_on=1 WHERE id=?').run(AI.enc(s), u.id);
    audit(u.tenant_id, u.id, 'two_step_on', 'user', u.id, null, L.ip(req)); res.json({ ok: true });
  });
  app.post('/api/2fa/disable', L.requireLogin, (req, res) => {
    const u = me(req); if (!L.checkPassword(String(req.body.password || ''), u.pass_hash)) return res.status(400).json({ error: 'Password is not correct.' });
    if (!totpOk(AI.dec(u.totp_secret || ''), req.body.code)) return res.status(400).json({ error: 'That code is not correct.' });
    db.prepare('UPDATE users SET totp_secret=NULL, totp_on=0 WHERE id=?').run(u.id);
    audit(u.tenant_id, u.id, 'two_step_off', 'user', u.id, null, L.ip(req)); res.json({ ok: true });
  });
};
// used by the sign-in route
Object.assign(module.exports, { totpOk, hotp, newSecret, webRoot, secretOf: (u) => AI.dec(u.totp_secret || '') });
