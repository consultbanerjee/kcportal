'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { db, audit, nextNumber, DATA_DIR } = require('./db');

const SESSION_DAYS = 7;
const OFFICE_ROLES = ['admin', 'advocate', 'staff', 'telecaller', 'accounts'];

const rand = (n = 32) => crypto.randomBytes(n).toString('hex');
const nowIso = () => new Date().toISOString();
const addDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const ip = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

function hashPassword(p) { return bcrypt.hashSync(p, 11); }
function checkPassword(p, h) { return !!h && bcrypt.compareSync(p, h); }
function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must contain letters and numbers.';
  return null;
}

function createSession(userId) {
  const token = rand(32);
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, addDays(SESSION_DAYS));
  return token;
}

function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies.kc_session;
  req.user = null;
  if (token) {
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=? AND u.active=1`).get(token);
    if (row && row.expires_at > nowIso()) req.user = row;
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}
const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this.' });
  next();
};
const office = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!OFFICE_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Office access only.' });
  next();
};

// Block cross-site form posts: every state-changing API call must carry this header (browsers will not add it cross-site without CORS).
function csrfGuard(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path.startsWith('/api/') && req.path !== '/api/payments/webhook') {
    if (req.headers['x-requested-with'] !== 'kcportal') return res.status(403).json({ error: 'Blocked request.' });
  }
  next();
}

const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const int = (v, d = null) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const paise = (rupees) => Math.round(Number(rupees) * 100);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));

function must(res, cond, msg) { if (!cond) { res.status(400).json({ error: msg }); return false; } return true; }

// ---------- File storage adapter. 'local' now; 'gdrive' plugs in later behind the same two functions. ----------
const storage = {
  async save(tenantId, buffer, originalName) {
    const dir = path.join(DATA_DIR, 'files', String(tenantId));
    fs.mkdirSync(dir, { recursive: true });
    const ref = rand(16) + path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
    fs.writeFileSync(path.join(dir, ref), buffer, { mode: 0o600 });
    return { storage: 'local', ref };
  },
  path(tenantId, ref) {
    const p = path.join(DATA_DIR, 'files', String(tenantId), path.basename(ref));
    return fs.existsSync(p) ? p : null;
  },
};

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.jpg', '.jpeg', '.png', '.zip']);

module.exports = {
  db, audit, nextNumber, rand, nowIso, addDays, ip, hashPassword, checkPassword, passwordProblem, createSession,
  loadUser, requireLogin, need, office, csrfGuard, str, int, paise, isDate, must, storage, ALLOWED_EXT, OFFICE_ROLES,
};
