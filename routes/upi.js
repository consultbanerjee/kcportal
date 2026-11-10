'use strict';
// Google Pay (and any UPI app) collection: a standing "Pay the firm" link, plus exact-amount pay links / QR for bookings and invoices.
const QR = require('qrcode');
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;
const T = (req) => req.user.tenant_id;
const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

const cfg = (tid) => ({ vpa: AI.getS(tid, 'upi_id', ''), name: AI.getS(tid, 'upi_name', ''), note: AI.getS(tid, 'upi_note', '') });
function link(tid, amountPaise, note) {
  const c = cfg(tid); if (!c.vpa) return null;
  const p = new URLSearchParams({ pa: c.vpa, pn: c.name || (require('../db').db.prepare('SELECT name FROM tenants WHERE id=?').get(tid) || {}).name || 'Firm', cu: 'INR' });
  if (amountPaise > 0) p.set('am', (amountPaise / 100).toFixed(2));
  if (note) p.set('tn', String(note).slice(0, 60));
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20');
}

function linkTo(vpa, name, amountPaise, note) {
  const p = new URLSearchParams({ pa: vpa, pn: name || 'Payee', cu: 'INR' }); if (amountPaise > 0) p.set('am', (amountPaise / 100).toFixed(2)); if (note) p.set('tn', String(note).slice(0, 60));
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20');
}

module.exports = (app) => {
  const firm = (req) => L.firmBySlug(req.query.firm);
  // Office settings
  app.get('/api/upi', L.need('admin', 'advocate', 'staff', 'accounts'), (req, res) => {
    const base = process.env.PUBLIC_URL || `https://${req.headers.host}`, t = db.prepare('SELECT slug FROM tenants WHERE id=?').get(T(req));
    res.json({ ...cfg(T(req)), pay_url: `${base}/#/pay-us?firm=${t ? t.slug : ''}` });
  });
  app.put('/api/upi', L.need('admin'), (req, res) => {
    const vpa = L.str(req.body.upi_id, 80).trim();
    if (!L.must(res, !vpa || VPA.test(vpa), 'Enter a valid UPI ID, like name@okhdfcbank.')) return;
    AI.setS(T(req), 'upi_id', vpa); AI.setS(T(req), 'upi_name', L.str(req.body.upi_name, 60));
    AI.setS(T(req), 'upi_note', L.str(req.body.upi_note, 300));
    audit(T(req), req.user.id, 'upi_settings', 'settings', 0, vpa, L.ip(req)); res.json({ ok: true });
  });
  // Public: details + QR for the standing pay page
  app.get('/api/public/upi', (req, res) => {
    const t = firm(req); if (!t) return res.status(404).json({ error: 'Firm not found.' });
    const c = cfg(t.id), amt = Math.round(Number(req.query.amt) * 100) || 0, note = L.str(req.query.note, 60);
    res.json({ firm: t.name, enabled: !!c.vpa, vpa: c.vpa, name: c.name || t.name, note: c.note, link: link(t.id, amt, note) });
  });
  app.get('/api/public/upi-qr', async (req, res) => {
    const t = firm(req); const amt = Math.round(Number(req.query.amt) * 100) || 0;
    const l = t && link(t.id, amt, L.str(req.query.note, 60)); if (!l) return res.status(404).end();
    res.type('image/svg+xml').send(await QR.toString(l, { type: 'svg', margin: 1, width: 240 }));
  });
  // Public: client says "I have paid" on a booking; office still confirms against the bank/GPay credit.
  app.post('/api/public/booking/:ref/paid', (req, res) => {
    const t = firm({ query: req.body || {} }) || firm(req); if (!t) return res.status(404).json({ error: 'Firm not found.' });
    const a = db.prepare("SELECT * FROM appointments WHERE pay_ref=? AND tenant_id=?").get(L.str(req.params.ref, 30), t.id);
    if (!a) return res.status(404).json({ error: 'Booking not found.' });
    if (!L.must(res, a.status === 'awaiting_payment', 'This booking is not waiting for payment.')) return;
    const utr = L.str(req.body.utr, 40).replace(/[^A-Za-z0-9]/g, '');
    if (!L.must(res, utr.length >= 8, 'Enter the 12-digit UPI reference (UTR) shown in Google Pay.')) return;
    db.prepare("UPDATE appointments SET pay_claim=?, hold_until=? WHERE id=?").run(utr, new Date(Date.now() + 120 * 60000).toISOString(), a.id);
    audit(t.id, null, 'payment_claimed', 'appointment', a.id, utr, L.ip(req)); res.json({ ok: true });
  });
};
Object.assign(module.exports, { link, linkTo, cfg });
