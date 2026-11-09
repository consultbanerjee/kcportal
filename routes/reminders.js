'use strict';
// Automatic payment reminders: for each unpaid invoice, send the client a reminder (WhatsApp and/or e-mail) with a payment link,
// first after N days from the due date, then every M days, up to a maximum. Set up by the Admin in Settings.
const L = require('../lib');
const AI = require('../aicore');
const WA = require('./whatsapp');
const { db, audit } = L;
const S = (t, k, d = '') => AI.getS(t, k, d);
const today = () => new Date().toISOString().slice(0, 10);
const inrStr = (p) => 'Rs. ' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const base = () => process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000);
const cfg = (t) => ({ on: S(t, 'rem_on') === '1', first: Math.max(0, L.int(S(t, 'rem_first', '0'), 0)), every: Math.max(1, L.int(S(t, 'rem_every', '7'), 7)), max: Math.max(1, Math.min(30, L.int(S(t, 'rem_max', '4'), 4))), since: S(t, 'rem_since', ''), wa: S(t, 'rem_wa', '1') === '1', email: S(t, 'rem_email', '1') === '1' });
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

function payLink(t, inv, outPaise) {
  const U = require('./upi'), firm = db.prepare('SELECT slug FROM tenants WHERE id=?').get(t);
  if (U.cfg(t).vpa) return `${base()}/#/pay-us?firm=${encodeURIComponent(firm.slug)}&amt=${(outPaise / 100).toFixed(2)}&note=${encodeURIComponent(inv.inv_no)}`;
  return base() + '/';
}
const outstanding = (inv) => inv.total_paise - db.prepare('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE invoice_id=?').get(inv.id).v;

async function remindOne(t, inv, manual) {
  const cl = db.prepare('SELECT id,name,email,phone,wa_optout FROM clients WHERE id=?').get(inv.client_id), out = outstanding(inv), c = cfg(t);
  const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'KC LEGAL', link = payLink(t, inv, out), res = [];
  const log = (channel, status, error) => db.prepare('INSERT INTO reminder_log(tenant_id,invoice_id,client_id,channel,status,error,manual) VALUES (?,?,?,?,?,?,?)').run(t, inv.id, cl.id, channel, status, error ? String(error).slice(0, 250) : null, manual ? 1 : 0);
  if ((c.wa || manual) && WA.configured(t) && !cl.wa_optout && WA.normPhone(cl.phone)) {
    try { await WA.sendToClient(t, cl.id, { template: 'kc_payment_link', vars: [cl.name, inv.inv_no, inrStr(out), link, firm] }, null); log('whatsapp', 'sent'); res.push('whatsapp'); } catch (e) { log('whatsapp', 'failed', e.message); }
  }
  if ((c.email || manual) && cl.email) {
    const M = require('./aimail');
    if (M.mailReady(t)) {
      try { await M.sendMail(t, { to: cl.email, subject: `Reminder: invoice ${inv.inv_no} — ${inrStr(out)} pending`,
        text: `Dear ${cl.name},\n\nThis is a gentle reminder that invoice ${inv.inv_no} dated ${inv.inv_date} has ${inrStr(out)} pending.\n\nYou can pay by Google Pay or any UPI app here:\n${link}\n\nIf you have already paid, please ignore this message or send us the payment reference.\n\nRegards,\n${firm}` }); log('email', 'sent'); res.push('email'); } catch (e) { log('email', 'failed', e.message); }
    }
  }
  return res;
}

function due(t, now = today()) {
  const c = cfg(t), rows = db.prepare("SELECT i.* FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.tenant_id=? AND i.status IN ('sent','part_paid') AND COALESCE(c.no_reminders,0)=0 AND COALESCE(c.portal_blocked,0)=0").all(t), out = [];
  for (const inv of rows) {
    if (outstanding(inv) <= 0) continue;
    if (c.since && String(inv.inv_date || '') < c.since) continue; // older invoices (e.g. imported) are never chased
    if (daysBetween(inv.due_date || inv.inv_date, now) < c.first) continue;
    const sent = db.prepare("SELECT COUNT(DISTINCT date(created_at)) n, MAX(date(created_at)) last FROM reminder_log WHERE tenant_id=? AND invoice_id=? AND status='sent' AND manual=0").get(t, inv.id);
    if (sent.n >= c.max || (sent.last && daysBetween(sent.last, now) < c.every)) continue;
    out.push(inv);
  }
  return out;
}
async function runFor(t) { let invoices = 0, messages = 0; for (const inv of due(t)) { const r = await remindOne(t, inv, false); if (r.length) { invoices++; messages += r.length; } } return { invoices, messages }; }

let timer;
function startWorker() {
  const tick = async () => {
    const h = new Date(Date.now() + 5.5 * 3600000).getUTCHours(); if (h < 10 || h >= 18) return;      // India daytime only
    for (const r of db.prepare("SELECT tenant_id t FROM firm_settings WHERE key='rem_on' AND value='1'").all()) { try { await runFor(r.t); } catch (e) { console.error('reminders', e.message); } }
  };
  timer = setInterval(tick, 60 * 60 * 1000); if (timer.unref) timer.unref(); setTimeout(tick, 20000).unref();
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id, adm = L.need('admin');
  app.get('/api/reminders', adm, (req, res) => {
    const t = T(req), c = cfg(t);
    res.json({ ...c, wa_ready: WA.configured(t), email_ready: require('./aimail').mailReady(t), link_ready: !!require('./upi').cfg(t).vpa,
      pending: due(t).length, log: db.prepare('SELECT l.*, i.inv_no, cl.name AS client FROM reminder_log l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN clients cl ON cl.id=l.client_id WHERE l.tenant_id=? ORDER BY l.id DESC LIMIT 25').all(t) });
  });
  app.put('/api/reminders', adm, (req, res) => {
    const t = T(req), b = req.body;
    const was = S(t, 'rem_since', ''), ds = /^\d{4}-\d{2}-\d{2}$/.test(String(b.since || '')) ? b.since : ((b.on && S(t, 'rem_on') !== '1') || !was ? today() : was);
    AI.setS(t, 'rem_since', ds); AI.setS(t, 'rem_on', b.on ? '1' : '0'); AI.setS(t, 'rem_first', String(Math.max(0, Math.min(365, L.int(b.first, 0))))); AI.setS(t, 'rem_every', String(Math.max(1, Math.min(180, L.int(b.every, 7)))));
    AI.setS(t, 'rem_max', String(Math.max(1, Math.min(30, L.int(b.max, 4))))); AI.setS(t, 'rem_wa', b.wa ? '1' : '0'); AI.setS(t, 'rem_email', b.email ? '1' : '0');
    audit(t, req.user.id, 'reminders_settings', 'settings', 0, b.on ? 'on' : 'off', L.ip(req)); res.json({ ok: true });
  });
  app.post('/api/reminders/run', adm, async (req, res) => { try { res.json(await runFor(T(req))); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/invoices/:id/remind', L.need('admin', 'advocate', 'accounts'), async (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id=? AND tenant_id=? AND status IN ('sent','part_paid')").get(req.params.id, T(req));
    if (!inv) return res.status(404).json({ error: 'Only an issued, unpaid invoice can be reminded.' });
    const sent = await remindOne(T(req), inv, true);
    if (!sent.length) return res.status(409).json({ error: 'Nothing could be sent: the client needs a WhatsApp number (with WhatsApp set up) or an e-mail address (with the mailbox set up).' });
    res.json({ sent });
  });
};
Object.assign(module.exports, { startWorker, runFor, due, remindOne, cfg });
