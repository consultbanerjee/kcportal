'use strict';
// Alerts: a weekly self-test of the whole portal. Every fault found is recorded here for the firm Admin, who ticks
// "Action taken" once it is dealt with. A fault that goes away by itself is cleared automatically; one that is still
// there after being ticked reopens at the next test.
const fs = require('fs');
const tls = require('tls');
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;
const { DATA_DIR } = require('../db');

db.exec(`CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, akey TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', area TEXT, title TEXT NOT NULL, detail TEXT, href TEXT,
  status TEXT NOT NULL DEFAULT 'open', first_seen TEXT, last_seen TEXT, resolved_at TEXT, resolved_by TEXT, reopened INTEGER NOT NULL DEFAULT 0, times INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, akey))`);
db.exec('CREATE TABLE IF NOT EXISTS alert_runs (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, ran_at TEXT DEFAULT CURRENT_TIMESTAMP, found INTEGER, added INTEGER, cleared INTEGER, reopened INTEGER)');

const WEEK = 7 * 24 * 3600 * 1000;
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const inr = (p) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const plural = (n, a, b) => `${n} ${n === 1 ? a : b || a + 's'}`;

// ---- the checks: each returns findings [{key, severity, area, title, detail, href}] ----
function checksFor(t) {
  const out = [], add = (key, severity, area, title, detail, href) => out.push({ key, severity, area, title, detail: detail || '', href: href || '' });
  const safe = (name, fn) => { try { fn(); } catch (e) { add('selftest:' + name, 'high', 'Portal', `The ${name} check could not run`, 'Error: ' + String(e.message).slice(0, 160)); } };
  const q = (sql, ...a) => db.prepare(sql).all(...a), one = (sql, ...a) => db.prepare(sql).get(...a);

  safe('clients', () => {
    const cl = q('SELECT id,name,phone,email FROM clients WHERE tenant_id=?', t), by = new Map();
    for (const c of cl) { const k = norm(c.name); if (k) by.set(k, [...(by.get(k) || []), c.name]); }
    const dup = [...by.values()].filter((v) => v.length > 1);
    if (dup.length) add('clients:dup', 'medium', 'Clients', `${plural(dup.length, 'client name appears', 'client names appear')} more than once`, dup.map((v) => `${v[0]} (${v.length} entries)`).join('; ') + '. Merge or delete the extra entry so fees and files are not split.', '#/clients');
    const odd = cl.filter((c) => { const o = (c.name.match(/\(/g) || []).length, k = (c.name.match(/\)/g) || []).length; return o !== k; });
    if (odd.length) add('clients:brackets', 'low', 'Clients', `${plural(odd.length, 'client name has', 'client names have')} a missing bracket`, odd.map((c) => c.name).join('; ') + '. Correct the spelling; it prints on invoices.', '#/clients');
    const nocontact = cl.filter((c) => !String(c.phone || '').trim() && !String(c.email || '').trim());
    if (nocontact.length) add('clients:nocontact', 'low', 'Clients', `${plural(nocontact.length, 'client has', 'clients have')} no phone number and no email`, 'Reminders, invoices and greetings cannot reach them: ' + nocontact.slice(0, 12).map((c) => c.name).join('; ') + (nocontact.length > 12 ? '; …' : ''), '#/clients');
    const cases = one('SELECT COUNT(*) n FROM matters WHERE tenant_id=?', t).n;
    if (cl.length && !cases) add('cases:none', 'low', 'Cases', 'No cases have been entered', `There are ${cl.length} clients but no case is recorded, so the court-date reminders, Limitation and the Calendar have nothing to work on.`, '#/matters');
  });

  safe('invoices', () => {
    const inv = q("SELECT id,inv_no,inv_date,status,total_paise FROM invoices WHERE tenant_id=? AND status!='cancelled'", t);
    const paid = new Map(q('SELECT invoice_id i, COALESCE(SUM(amount_paise),0) s FROM payments WHERE tenant_id=? GROUP BY invoice_id', t).map((r) => [r.i, r.s]));
    const nums = inv.map((i) => ({ n: parseInt(String(i.inv_no).replace(/\D/g, ''), 10), i })).filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n);
    if (nums.length > 5) {
      const sorted = nums.map((x) => x.n), med = sorted[Math.floor(sorted.length * 0.9)];
      const jump = nums.filter((x) => x.n > med + 20);
      if (jump.length) add('inv:jump', 'medium', 'Accounts', `${plural(jump.length, 'invoice number is', 'invoice numbers are')} far ahead of the rest of the series`, jump.map((x) => x.i.inv_no).join(', ') + '. Next numbers may carry on from the wrong place; check the series.', '#/accounts');
    }
    const olddraft = inv.filter((i) => i.status === 'draft' && Date.now() - Date.parse(i.inv_date) > 30 * 864e5);
    if (olddraft.length) add('inv:olddraft', 'low', 'Accounts', `${plural(olddraft.length, 'invoice is', 'invoices are')} still a draft after 30 days`, olddraft.map((i) => i.inv_no).join(', ') + '. Issue or delete them so receivables are right.', '#/accounts');
    const short = inv.filter((i) => i.status === 'paid' && (paid.get(i.id) || 0) < i.total_paise);
    if (short.length) add('inv:paidshort', 'medium', 'Accounts', `${plural(short.length, 'invoice is', 'invoices are')} marked paid but less money is recorded than the total`, short.map((i) => `${i.inv_no} (${inr(paid.get(i.id) || 0)} of ${inr(i.total_paise)})`).join('; ') + '. If tax was deducted at source, record it so the books balance.', '#/accounts');
    const over = inv.filter((i) => ['sent', 'part_paid'].includes(i.status) && Date.now() - Date.parse(i.inv_date) > 90 * 864e5 && (paid.get(i.id) || 0) < i.total_paise);
    if (over.length) { const amt = over.reduce((s, i) => s + i.total_paise - (paid.get(i.id) || 0), 0); add('inv:overdue90', 'info', 'Accounts', `${plural(over.length, 'invoice is', 'invoices are')} unpaid for more than 90 days`, `Together ${inr(amt)} is outstanding. Consider reminders or follow-up.`, '#/accounts'); }
    const items = q('SELECT i.inv_no, i.total_paise, (SELECT COALESCE(SUM(ROUND(qty*rate_paise)),0) FROM invoice_items x WHERE x.invoice_id=i.id) s FROM invoices i WHERE i.tenant_id=?', t).filter((r) => Math.abs(r.s - r.total_paise) > 1);
    if (items.length) add('inv:totals', 'high', 'Accounts', `${plural(items.length, 'invoice total does', 'invoice totals do')} not equal its items`, items.map((r) => r.inv_no).join(', '), '#/accounts');
  });

  safe('bank', () => {
    const un = one("SELECT COUNT(*) n FROM bank_txns WHERE tenant_id=? AND status='unmatched'", t).n;
    if (un) add('bank:unmatched', 'medium', 'Accounts', `${plural(un, 'bank entry needs', 'bank entries need')} to be matched or sorted`, 'Open Accounts → Bank reconciliation and assign them to a client, payee or head.', '#/accounts/bank');
    let er = 0; try { er = one('SELECT COUNT(*) n FROM bank_import_errors WHERE tenant_id=?', t).n; } catch (e) {}
    if (er) add('bank:errors', 'medium', 'Accounts', `${plural(er, 'bank statement line', 'bank statement lines')} could not be read`, 'Correct them in Bank reconciliation so the books are complete.', '#/accounts/bank');
  });

  safe('settings', () => {
    const tpl = one('SELECT settings, letterhead FROM tenant_templates WHERE tenant_id=?', t); let s = {}; try { s = JSON.parse((tpl && tpl.settings) || '{}'); } catch (e) {}
    if (!tpl || !tpl.letterhead) add('cfg:letterhead', 'low', 'Settings', 'No letterhead uploaded', 'Invoices and letters print without the firm letter pad.', '#/template');
    const pay = [1, 2, 3, 4].some((n) => s['pay' + n + '_text']) || s.payment_details;
    if (!pay) add('cfg:bank', 'medium', 'Settings', 'Bank details are not filled in', 'Invoices carry no bank details.', '#/template');
    const dir = require('path').resolve(DATA_DIR, 'templates', String(t)); let hasQr = false, hasSig = false;
    try { const fl = fs.readdirSync(dir); hasQr = fl.some((f) => f.startsWith('qr.')); hasSig = fl.some((f) => f.startsWith('signature.')); } catch (e) {}
    if (!hasSig) add('cfg:sign', 'low', 'Settings', 'No signature image uploaded', 'Invoices and letters print without a signature above "Authorised Signatory".', '#/template');
    if (pay && !hasQr) add('cfg:qr', 'info', 'Settings', 'No payment QR code uploaded', 'Clients cannot scan to pay from the invoice.', '#/template');
    if (!AI.getS(t, 'drive_refresh')) add('cfg:drive', 'high', 'Settings', 'Google Drive is not connected', 'Files are not backed up to the firm\'s Google Drive.', '#/settings');
  });

  safe('ai', () => {
    const on = (f) => AI.getS(t, 'ai_' + f, '0') === '1';
    if ((on('drafting') || on('email') || on('chat')) && !AI.apiKey(t)) add('ai:key', 'high', 'AI', 'AI features are on but no Claude key is saved', 'Drafting, email and chat will fail until a key is added.', '#/ai');
    if (on('drafting') && !AI.getS(t, 'ai_draft_model')) add('ai:model', 'info', 'AI', 'Drafting uses the standard model', 'For petitions choose the strongest model under AI Control → "Model for drafting only".', '#/ai');
    const e = AI.getS(t, 'mail_last_error');
    if (on('email') && e) add('ai:mail', 'high', 'AI', 'The email assistant cannot log in to the mailbox', 'Last error: ' + e + '. Re-enter the mailbox login in AI Control.', '#/ai');
    const f = one("SELECT COUNT(*) n FROM ai_drafts WHERE tenant_id=? AND status='failed' AND created_at>=date('now','-7 day')", t).n;
    if (f) add('ai:failed', 'medium', 'AI', `${plural(f, 'AI draft')} failed this week`, 'Open Drafting Desk and press Prepare draft again.', '#/draft');
  });

  safe('users', () => {
    const inv = q("SELECT name,email FROM users WHERE tenant_id=? AND active=1 AND pass_hash IS NULL AND invite_token IS NOT NULL AND created_at<date('now','-7 day') AND role!='client'", t);
    if (inv.length) add('users:invite', 'low', 'Team', `${plural(inv.length, 'team member has', 'team members have')} not accepted the invitation`, inv.map((u) => u.name).join(', ') + '. Send a fresh invite link.', '#/team');
    const lk = q("SELECT name FROM users WHERE tenant_id=? AND locked_until IS NOT NULL AND locked_until>datetime('now')", t);
    if (lk.length) add('users:locked', 'info', 'Team', `${plural(lk.length, 'login is', 'logins are')} locked after wrong passwords`, lk.map((u) => u.name).join(', '), '#/team');
  });

  safe('repository', () => {
    let down = 0, moved = 0; try { down = one("SELECT COUNT(*) n FROM repo_status WHERE status='down' AND fails>=2").n; moved = one('SELECT COUNT(*) n FROM repo_status WHERE new_url IS NOT NULL').n; } catch (e) {}
    if (down) add('repo:down', 'low', 'Repository', `${plural(down, 'Repository link')} may be down`, 'The weekly check could not reach them twice in a row. They are marked on the Repository page.', '#/repository/all');
    if (moved) add('repo:moved', 'info', 'Repository', `${plural(moved, 'Repository link')} moved to a new address`, 'The portal now uses the new address automatically.', '#/repository/all');
  });
  return out;
}

// ---- checks about the server itself (shown to every firm Admin) ----
async function platformChecks() {
  const out = [], add = (key, severity, title, detail) => out.push({ key, severity, area: 'Portal', title, detail, href: '' });
  try { const r = db.prepare('PRAGMA quick_check').get(); if (String(Object.values(r)[0]).toLowerCase() !== 'ok') add('sys:db', 'high', 'The database file reports a problem', String(Object.values(r)[0]).slice(0, 200) + '. Restore from the latest backup.'); } catch (e) { add('sys:db', 'high', 'The database check could not run', String(e.message).slice(0, 160)); }
  try { const s = fs.statfsSync(DATA_DIR), free = s.bavail / s.blocks; if (free < 0.15) add('sys:disk', free < 0.07 ? 'high' : 'medium', 'The server disk is filling up', `${Math.round(free * 100)}% free. Remove old backups or enlarge the disk.`); } catch (e) {}
  const host = (() => { try { return new URL(process.env.PUBLIC_URL || '').hostname; } catch (e) { return ''; } })();
  if (host && !/^(localhost|127\.|\[)/.test(host)) {
    await new Promise((ok) => {
      const so = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const c = so.getPeerCertificate(); so.end();
        if (c && c.valid_to) { const d = Math.floor((Date.parse(c.valid_to) - Date.now()) / 864e5); if (d < 14) add('sys:cert', d < 5 ? 'high' : 'medium', 'The website security certificate expires soon', `${host} certificate expires in ${d} days. Caddy normally renews it itself; check that it is running.`); }
        ok();
      });
      so.on('error', () => { add('sys:reach', 'high', 'The portal address could not be reached from the server itself', `${host} did not answer on port 443.`); ok(); });
      so.on('timeout', () => { so.destroy(); ok(); });
    });
  }
  return out;
}

function record(t, found) {
  const keys = new Set(found.map((f) => f.key)); let added = 0, cleared = 0, reopened = 0;
  const ex = new Map(db.prepare('SELECT * FROM alerts WHERE tenant_id=?').all(t).map((r) => [r.akey, r]));
  const ts = now();
  for (const f of found) {
    const r = ex.get(f.key);
    if (!r) { db.prepare('INSERT INTO alerts(tenant_id,akey,severity,area,title,detail,href,status,first_seen,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)').run(t, f.key, f.severity, f.area, f.title, f.detail, f.href, 'open', ts, ts); added++; continue; }
    if (r.status === 'open') db.prepare('UPDATE alerts SET severity=?,area=?,title=?,detail=?,href=?,last_seen=?,times=times+1 WHERE id=?').run(f.severity, f.area, f.title, f.detail, f.href, ts, r.id);
    else { db.prepare("UPDATE alerts SET status='open',severity=?,area=?,title=?,detail=?,href=?,last_seen=?,times=times+1,reopened=?,resolved_at=NULL,resolved_by=NULL WHERE id=?").run(f.severity, f.area, f.title, f.detail, f.href, ts, r.status === 'done' ? 1 : r.reopened, r.id); reopened++; }
  }
  for (const r of ex.values()) if (!keys.has(r.akey) && r.status === 'open') { db.prepare("UPDATE alerts SET status='cleared', resolved_at=?, resolved_by='Cleared automatically (no longer found)' WHERE id=?").run(ts, r.id); cleared++; }
  db.prepare('INSERT INTO alert_runs(tenant_id,found,added,cleared,reopened) VALUES (?,?,?,?,?)').run(t, found.length, added, cleared, reopened);
  return { found: found.length, added, cleared, reopened };
}

async function runAll() {
  const plat = await platformChecks(), res = {};
  for (const t of db.prepare("SELECT id FROM tenants WHERE kind='firm' AND active=1").all()) { try { res[t.id] = record(t.id, [...checksFor(t.id), ...plat]); } catch (e) { console.error('alerts', t.id, e.message); } }
  AI.setS(0, 'alerts_last_run', new Date().toISOString());
  return res;
}
const startWorker = () => {
  const tick = () => { const last = AI.getS(0, 'alerts_last_run', ''); if (!last || Date.now() - Date.parse(last) >= WEEK) runAll().catch((e) => console.error('alerts run', e.message)); };
  const first = setTimeout(tick, 5 * 60 * 1000), t = setInterval(tick, 60 * 60 * 1000); first.unref && first.unref(); t.unref && t.unref();
};

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const SEV = "CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END";
  app.get('/api/alerts', L.need('admin'), (req, res) => {
    const t = T(req), rows = db.prepare(`SELECT * FROM alerts WHERE tenant_id=? ORDER BY (status='open') DESC, ${SEV}, last_seen DESC`).all(t);
    const run = db.prepare('SELECT * FROM alert_runs WHERE tenant_id=? ORDER BY id DESC LIMIT 1').get(t), last = AI.getS(0, 'alerts_last_run', '');
    res.json({ alerts: rows, last_run: run ? run.ran_at : '', last_run_utc: last, next_due: last ? new Date(Date.parse(last) + WEEK).toISOString() : '', open: rows.filter((r) => r.status === 'open').length });
  });
  app.get('/api/alerts/count', L.need('admin'), (req, res) => res.json({ open: db.prepare("SELECT COUNT(*) n FROM alerts WHERE tenant_id=? AND status='open'").get(T(req)).n, high: db.prepare("SELECT COUNT(*) n FROM alerts WHERE tenant_id=? AND status='open' AND severity='high'").get(T(req)).n }));
  app.post('/api/alerts/:id/action', L.need('admin'), (req, res) => {
    const a = db.prepare('SELECT * FROM alerts WHERE id=? AND tenant_id=?').get(L.int(req.params.id), T(req)); if (!a) return res.status(404).json({ error: 'Not found.' });
    if (req.body && req.body.done === false) db.prepare("UPDATE alerts SET status='open', resolved_at=NULL, resolved_by=NULL WHERE id=?").run(a.id);
    else db.prepare("UPDATE alerts SET status='done', resolved_at=?, resolved_by=? WHERE id=?").run(now(), req.user.name, a.id);
    audit(T(req), req.user.id, 'alert_' + (req.body && req.body.done === false ? 'reopened' : 'action_taken'), 'alert', a.id, a.akey, L.ip(req));
    res.json({ ok: true });
  });
  let busy = false;
  app.post('/api/alerts/run', L.need('admin'), async (req, res) => {
    if (busy) return res.status(429).json({ error: 'A test is already running.' });
    busy = true;
    try { const plat = await platformChecks(); const r = record(T(req), [...checksFor(T(req)), ...plat]); audit(T(req), req.user.id, 'alerts_run', 'alert', 0, JSON.stringify(r), L.ip(req)); res.json(r); }
    catch (e) { console.error(e); res.status(500).json({ error: 'The test could not finish.' }); } finally { busy = false; }
  });
};
Object.assign(module.exports, { runAll, startWorker, checksFor });
