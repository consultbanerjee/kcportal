'use strict';
// Invoices: send by e-mail / WhatsApp (with a private "view invoice" link), and recurring invoices that are created
// on a schedule and, if the firm wants, sent automatically.
const crypto = require('crypto');
const L = require('../lib');
const AI = require('../aicore');
const WA = require('./whatsapp');
const TPL = require('./template');
const { db, audit } = L;
const BILL = L.need('admin', 'advocate', 'accounts');
const base = () => (process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');
const inrStr = (p) => 'Rs. ' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const T = (req) => req.user.tenant_id;

function addPeriod(date, n, unit) {
  const [y, m, d] = date.split('-').map(Number);
  if (unit === 'day' || unit === 'week') { const dt = new Date(Date.UTC(y, m - 1, d + n * (unit === 'week' ? 7 : 1))); return dt.toISOString().slice(0, 10); }
  const months = unit === 'year' ? 12 * n : unit === 'quarter' ? 3 * n : n;
  const tm = (y * 12 + (m - 1)) + months, ty = Math.floor(tm / 12), tmo = tm % 12;
  const last = new Date(Date.UTC(ty, tmo + 1, 0)).getUTCDate();
  return `${ty}-${String(tmo + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const UNITS = ['day', 'week', 'month', 'quarter', 'year'];

function shareToken(invId) {
  const r = db.prepare('SELECT share_token FROM invoices WHERE id=?').get(invId);
  if (r && r.share_token) return r.share_token;
  const tok = crypto.randomBytes(18).toString('hex');
  db.prepare('UPDATE invoices SET share_token=? WHERE id=?').run(tok, invId);
  return tok;
}
const viewLink = (invId) => `${base()}/#/inv/${shareToken(invId)}`;
function payLink(t, inv, out) {
  try { const U = require('./upi'), firm = db.prepare('SELECT slug FROM tenants WHERE id=?').get(t);
    if (U.cfg(t).vpa) return `${base()}/#/pay-us?firm=${encodeURIComponent(firm.slug)}&amt=${(out / 100).toFixed(2)}&note=${encodeURIComponent(inv.inv_no)}`; } catch (e) {}
  return '';
}
const log = (t, id, channel, status, error, auto) => db.prepare('INSERT INTO invoice_send_log(tenant_id,invoice_id,channel,status,error,auto) VALUES (?,?,?,?,?,?)').run(t, id, channel, status, error ? String(error).slice(0, 250) : null, auto ? 1 : 0);

// Send an invoice. opts: { email, whatsapp, to, message }. Returns { sent:[], failed:[], wa_link? }
async function sendInvoice(t, invId, opts, userId, auto) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND tenant_id=?').get(invId, t);
  if (!inv) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
  if (inv.status === 'cancelled') throw Object.assign(new Error('A cancelled invoice cannot be sent.'), { status: 409 });
  const cl = db.prepare('SELECT id,name,email,phone FROM clients WHERE id=?').get(inv.client_id);
  const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'KC LEGAL';
  const paid = db.prepare('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE invoice_id=?').get(inv.id).v, out = inv.total_paise - paid;
  const link = viewLink(inv.id), pay = payLink(t, inv, out), res = { sent: [], failed: [] };
  if (inv.status === 'draft') db.prepare("UPDATE invoices SET status='sent' WHERE id=?").run(inv.id);   // sending issues it
  if (opts.email) {
    const M = require('./aimail'), to = String(opts.to || cl.email || '').trim();
    try {
      if (!to) throw new Error('This client has no e-mail address.');
      if (!M.mailReady(t)) throw new Error('E-mail sending is not set up for your firm.');
      const note = L.str(opts.message, 1000);
      await M.sendMail(t, { to, subject: `Invoice ${inv.inv_no} from ${firm} — ${inrStr(inv.total_paise)}`,
        text: `Dear ${cl.name},\n\n${note ? note + '\n\n' : ''}Please find your invoice ${inv.inv_no} dated ${inv.inv_date}${inv.subject ? ' (' + inv.subject + ')' : ''}.\n\nAmount: ${inrStr(inv.total_paise)}${out !== inv.total_paise ? '\nBalance due: ' + inrStr(out) : ''}${inv.due_date ? '\nDue date: ' + inv.due_date : ''}\n\nView / download / print your invoice:\n${link}\n${pay ? '\nPay by Google Pay or any UPI app:\n' + pay + '\n' : ''}\nRegards,\n${firm}` });
      log(t, inv.id, 'email', 'sent', null, auto); res.sent.push('email');
    } catch (e) { log(t, inv.id, 'email', 'failed', e.message, auto); res.failed.push('email: ' + e.message); }
  }
  if (opts.whatsapp) {
    try {
      const r = await WA.sendToClient(t, cl.id, { template: 'kc_payment_link', vars: [cl.name, inv.inv_no, inrStr(out), link, firm] }, userId || null);
      if (r.link) { // WhatsApp API not set up: give the person a ready-made WhatsApp chat link to press Send in
        const to = WA.normPhone(cl.phone);
        const text = `Dear ${cl.name}, your invoice ${inv.inv_no} for ${inrStr(inv.total_paise)} is ready. View / download it here: ${link}${pay ? '\nPay by UPI: ' + pay : ''}\n- ${firm}`;
        res.wa_link = `https://wa.me/${to}?text=${encodeURIComponent(text)}`; log(t, inv.id, 'whatsapp', 'opened', null, auto);
      } else { log(t, inv.id, 'whatsapp', 'sent', null, auto); res.sent.push('whatsapp'); }
    } catch (e) { log(t, inv.id, 'whatsapp', 'failed', e.message, auto); res.failed.push('whatsapp: ' + e.message); }
  }
  if (res.sent.length || res.wa_link) db.prepare("UPDATE invoices SET sent_at=datetime('now') WHERE id=?").run(inv.id);
  audit(t, userId || null, 'invoice_sent', 'invoice', inv.id, (res.sent.concat(res.wa_link ? ['whatsapp-link'] : [])).join(','), '');
  return res;
}

// ---- recurring invoices ----
const itemsOf = (b) => (Array.isArray(b.items) ? b.items : []).map((x) => ({ description: L.str(x.description, 250), qty: Number(x.qty) || 1, rate_paise: x.rate_paise != null ? Math.round(Number(x.rate_paise)) : L.paise(x.rate) })).filter((x) => x.description && x.rate_paise > 0 && x.qty > 0);
function runProfile(p, userId) {
  const { createInvoice } = require('./business');
  const date = todayStr(), items = JSON.parse(p.items || '[]');
  const due = p.due_days > 0 ? addPeriod(date, p.due_days, 'day') : null;
  const out = createInvoice(p.tenant_id, userId || null, '', { client_id: p.client_id, matter_id: p.matter_id, inv_date: date, due_date: due, subject: p.subject, notes: p.notes, items, recurring_id: p.id });
  if (!out) { db.prepare('UPDATE recurring_invoices SET last_error=? WHERE id=?').run('Could not create the invoice (client missing or no valid items).', p.id); return null; }
  let next = addPeriod(p.next_date > date ? p.next_date : date, p.every_n, p.unit); if (next <= date) next = addPeriod(date, p.every_n, p.unit);
  const ended = p.end_date && next > p.end_date;
  db.prepare("UPDATE recurring_invoices SET next_date=?, last_run=?, runs=runs+1, last_error=NULL, status=? WHERE id=?").run(next, date, ended ? 'ended' : p.status, p.id);
  return out;
}
async function runDue(t, now = todayStr()) {
  let made = 0, sent = 0;
  for (const p of db.prepare("SELECT * FROM recurring_invoices WHERE tenant_id=? AND status='active' AND next_date<=?").all(t, now)) {
    if (p.end_date && p.next_date > p.end_date) { db.prepare("UPDATE recurring_invoices SET status='ended' WHERE id=?").run(p.id); continue; }
    const out = runProfile(p, p.created_by); if (!out) continue; made++;
    if (p.auto_send) { try { const r = await sendInvoice(t, out.id, { email: !!p.send_email, whatsapp: !!p.send_whatsapp }, p.created_by, true); sent += r.sent.length; if (r.failed.length) db.prepare('UPDATE recurring_invoices SET last_error=? WHERE id=?').run(r.failed.join('; ').slice(0, 250), p.id); } catch (e) { db.prepare('UPDATE recurring_invoices SET last_error=? WHERE id=?').run(String(e.message).slice(0, 250), p.id); } }
  }
  return { made, sent };
}
let timer;
function startWorker() {
  const tick = async () => {
    const h = new Date(Date.now() + 5.5 * 3600000).getUTCHours(); if (h < 8 || h >= 20) return;   // India daytime only
    for (const r of db.prepare("SELECT DISTINCT tenant_id t FROM recurring_invoices WHERE status='active'").all()) { try { await runDue(r.t); } catch (e) { console.error('recurring', e.message); } }
  };
  timer = setInterval(tick, 30 * 60 * 1000); if (timer.unref) timer.unref(); setTimeout(tick, 25000).unref();
}

module.exports = (app) => {
  app.post('/api/invoices/:id/send', BILL, async (req, res) => {
    const b = req.body || {};
    if (!L.must(res, b.email || b.whatsapp, 'Choose e-mail or WhatsApp.')) return;
    try { res.json(await sendInvoice(T(req), L.int(req.params.id), b, req.user.id, false)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/invoices/:id/send-info', BILL, (req, res) => {
    const t = T(req), inv = db.prepare('SELECT client_id,sent_at FROM invoices WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!inv) return res.status(404).json({ error: 'Not found.' });
    const cl = db.prepare('SELECT name,email,phone FROM clients WHERE id=?').get(inv.client_id);
    res.json({ email: cl.email || '', phone: cl.phone || '', email_ready: require('./aimail').mailReady(t), wa_api: WA.configured(t), sent_at: inv.sent_at,
      log: db.prepare('SELECT channel,status,error,auto,created_at FROM invoice_send_log WHERE invoice_id=? ORDER BY id DESC LIMIT 10').all(req.params.id) });
  });
  // public view of a sent invoice (private link, no sign-in)
  const pub = (tok) => { const i = db.prepare("SELECT * FROM invoices WHERE share_token=? AND status IN ('sent','part_paid','paid')").get(String(tok || '')); return i || null; };
  app.get('/api/public/invoice/:tok', (req, res) => {
    const inv = pub(req.params.tok); if (!inv) return res.status(404).json({ error: 'This invoice link is not valid.' });
    const c = db.prepare('SELECT name,address FROM clients WHERE id=?').get(inv.client_id);
    inv.client_name = c.name; inv.client_address = c.address;
    inv.items = db.prepare('SELECT description,qty,rate_paise FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
    inv.payments = db.prepare('SELECT rec_no,pay_date,amount_paise FROM payments WHERE invoice_id=? ORDER BY id').all(inv.id);
    inv.paid_paise = inv.payments.reduce((s, p) => s + p.amount_paise, 0);
    const tpl = TPL.tplInfo(inv.tenant_id); const { share_token, tenant_id, client_id, matter_id, ...safe } = inv;
    res.set('Cache-Control', 'no-store'); res.json({ invoice: safe, tpl, firm: (db.prepare('SELECT name FROM tenants WHERE id=?').get(inv.tenant_id) || {}).name });
  });
  app.get('/api/public/invoice/:tok/asset/:kind', (req, res) => {
    const inv = pub(req.params.tok), f = inv && TPL.publicAsset(inv.tenant_id, req.params.kind);
    if (!f) return res.status(404).end(); res.set('Cache-Control', 'private, max-age=300'); res.sendFile(f);
  });

  // recurring profiles
  const view = (p) => ({ ...p, items: JSON.parse(p.items || '[]'), client_name: (db.prepare('SELECT name FROM clients WHERE id=?').get(p.client_id) || {}).name });
  app.get('/api/recurring', BILL, (req, res) => res.json(db.prepare("SELECT * FROM recurring_invoices WHERE tenant_id=? ORDER BY (status='active') DESC, next_date").all(T(req)).map(view)));
  const clean = (req) => {
    const b = req.body || {}, t = T(req), cl = db.prepare('SELECT id FROM clients WHERE id=? AND tenant_id=?').get(L.int(b.client_id), t), items = itemsOf(b);
    if (!cl) return { err: 'Choose a client.' }; if (!items.length) return { err: 'Add at least one item with an amount.' };
    if (!L.isDate(b.next_date)) return { err: 'Choose the first invoice date.' };
    const unit = UNITS.includes(b.unit) ? b.unit : 'month';
    return { v: [cl.id, L.int(b.matter_id) || null, L.str(b.name, 100) || null, L.str(b.subject, 200), L.str(b.notes, 800), JSON.stringify(items), Math.max(1, Math.min(60, L.int(b.every_n) || 1)), unit, b.next_date, L.isDate(b.end_date) ? b.end_date : null, Math.max(0, Math.min(90, L.int(b.due_days) || 0)), b.auto_send ? 1 : 0, b.send_email === false || b.send_email === 0 ? 0 : 1, b.send_whatsapp ? 1 : 0] };
  };
  app.post('/api/recurring', BILL, (req, res) => {
    const c = clean(req); if (c.err) return res.status(400).json({ error: c.err });
    const r = db.prepare('INSERT INTO recurring_invoices(tenant_id,client_id,matter_id,name,subject,notes,items,every_n,unit,next_date,end_date,due_days,auto_send,send_email,send_whatsapp,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(T(req), ...c.v, req.user.id);
    audit(T(req), req.user.id, 'recurring_created', 'recurring', r.lastInsertRowid, null, L.ip(req)); res.json({ id: r.lastInsertRowid });
  });
  app.put('/api/recurring/:id', BILL, (req, res) => {
    const p = db.prepare('SELECT * FROM recurring_invoices WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!p) return res.status(404).json({ error: 'Not found.' });
    const c = clean(req); if (c.err) return res.status(400).json({ error: c.err });
    db.prepare("UPDATE recurring_invoices SET client_id=?,matter_id=?,name=?,subject=?,notes=?,items=?,every_n=?,unit=?,next_date=?,end_date=?,due_days=?,auto_send=?,send_email=?,send_whatsapp=?,status=CASE WHEN status='ended' THEN 'active' ELSE status END WHERE id=?").run(...c.v, p.id);
    res.json({ ok: true });
  });
  app.post('/api/recurring/:id/toggle', BILL, (req, res) => {
    const p = db.prepare('SELECT * FROM recurring_invoices WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!p) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE recurring_invoices SET status=? WHERE id=?').run(p.status === 'active' ? 'paused' : 'active', p.id); res.json({ ok: true });
  });
  app.delete('/api/recurring/:id', BILL, (req, res) => { db.prepare('DELETE FROM recurring_invoices WHERE id=? AND tenant_id=?').run(req.params.id, T(req)); res.json({ ok: true }); });
  app.post('/api/recurring/:id/run', BILL, async (req, res) => {
    const p = db.prepare('SELECT * FROM recurring_invoices WHERE id=? AND tenant_id=?').get(req.params.id, T(req)); if (!p) return res.status(404).json({ error: 'Not found.' });
    const out = runProfile({ ...p, next_date: p.next_date }, req.user.id); if (!out) return res.status(400).json({ error: 'Could not create the invoice.' });
    res.json(out);
  });
};
Object.assign(module.exports, { startWorker, runDue, sendInvoice, addPeriod });
