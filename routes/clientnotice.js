'use strict';
// CLIENT ACCESS NOTICE: when a client has no live case left (every case deleted or closed), the firm's portal gives a 7-day notice
// (WhatsApp + e-mail + a pop-up at every sign-in) and then switches the client's login off. A new or restored case during the notice
// cancels it; a login switched off by this rule comes back by itself when the client gets a live case again. Same rules for every firm.
// (Deleted cases and files already disappear from the client's side, because the client's lists never include them.)
const L = require('../lib'); const D = require('../db'); const db = D.db; const AI = require('../aicore'); const WA = require('./whatsapp');
for (const c of ['access_notice_at TEXT', 'access_revoke_at TEXT', 'access_auto_off INTEGER NOT NULL DEFAULT 0']) { try { db.exec('ALTER TABLE users ADD COLUMN ' + c); } catch (e) { /* already there */ } }
const DAYS = (t) => Math.max(1, Math.min(60, L.int(AI.getS(t, 'client_notice_days', '7'), 7)));
const firmName = (t) => (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'the firm';
const ist = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600000).toISOString().slice(0, 10).split('-').reverse().join('-');
const live = (clientId) => db.prepare("SELECT COUNT(*) n FROM matters WHERE client_id=? AND status IN ('open','on_hold')").get(clientId).n;
const ever = (clientId) => db.prepare('SELECT COUNT(*) n FROM matters WHERE client_id=?').get(clientId).n;

async function tell(u, subject, text) {
  const t = u.tenant_id;
  try { const M = require('./aimail'); if (u.email && M.mailReady(t)) await M.sendMail(t, { to: u.email, subject, text }); } catch (e) { console.error('clientnotice mail', e.message); }
  try { if (u.phone && WA.configured(t) && WA.normPhone(u.phone)) await WA.sendToStaff(t, u.phone, [u.name, text.split('\n').filter(Boolean)[1] || subject, firmName(t)]); } catch (e) { console.error('clientnotice wa', e.message); }
}

async function tick() {
  const now = new Date(), iso = now.toISOString();
  const us = db.prepare("SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.role='client' AND u.client_id IS NOT NULL AND t.active=1").all();
  for (const u of us) {
    const t = u.tenant_id, has = live(u.client_id);
    if (has) {                                           // a live case again: cancel the notice, bring back a login this rule had switched off
      if (u.access_notice_at || u.access_auto_off) {
        db.prepare('UPDATE users SET access_notice_at=NULL, access_revoke_at=NULL, access_auto_off=0, active=CASE WHEN access_auto_off=1 THEN 1 ELSE active END WHERE id=?').run(u.id);
        if (u.access_auto_off) D.audit(t, u.id, 'client_access_restored', 'user', u.id, 'new live case', null);
      }
      continue;
    }
    if (!u.active || !ever(u.client_id) || u.access_auto_off) continue;       // nothing to do for a new client with no case yet, or an already-off login
    if (!u.access_notice_at) {
      const due = new Date(now.getTime() + DAYS(t) * 86400000).toISOString();
      db.prepare('UPDATE users SET access_notice_at=?, access_revoke_at=? WHERE id=?').run(iso, due, u.id);
      D.audit(t, u.id, 'client_access_notice', 'user', u.id, 'access ends ' + ist(due), null);
      await tell(u, 'Notice: your portal access will end on ' + ist(due), `Dear ${u.name},\nNone of your cases with ${firmName(t)} is open now. Your access to the client portal will end on ${ist(due)}. Please download whatever you need before then.\nIf you have a new matter, kindly contact the office.\n${firmName(t)}`);
    } else if (u.access_revoke_at <= iso) {
      db.prepare('UPDATE users SET active=0, access_auto_off=1 WHERE id=?').run(u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      D.audit(t, u.id, 'client_access_revoked', 'user', u.id, 'no live case after notice', null);
    }
  }
}
let timer; function startWorker() { timer = setInterval(() => tick().catch((e) => console.error('clientnotice', e.message)), 10 * 60 * 1000); if (timer.unref) timer.unref(); setTimeout(() => tick().catch(() => {}), 40000).unref(); }
const notice = (u) => (u && u.role === 'client' && u.access_revoke_at ? { until: u.access_revoke_at, date: ist(u.access_revoke_at) } : null);
module.exports = () => {};
Object.assign(module.exports, { tick, startWorker, notice });
