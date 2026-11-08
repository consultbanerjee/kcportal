'use strict';
const L = require('../lib');
const { db, audit, nextNumber } = L;

const pad = (n, w = 4) => String(n).padStart(w, '0');
const isClient = (u) => u.role === 'client';
const BILL = L.need('admin', 'advocate', 'accounts');
const todayStr = () => new Date().toISOString().slice(0, 10);
const pubFirm = (req) => L.firmBySlug((req.query && req.query.firm) || (req.body && req.body.firm));

// ---------- CSV + date helpers (bank statements) ----------
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  s = (s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2], 2)}-${pad(m[1], 2)}`; }
  if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]*(\d{2,4})/))) { const mo = MON[m[2].toLowerCase()]; if (!mo) return null; const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(mo, 2)}-${pad(m[1], 2)}`; }
  return null;
}
const money = (s) => { const v = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(v) ? Math.round(v * 100) : 0; };

module.exports = (app, limiter) => {
  const T = (req) => req.user.tenant_id;
  const prefix = (t) => db.prepare('SELECT prefix FROM tenants WHERE id=?').get(t).prefix;

  // =============== CRM: leads ===============
  app.get('/api/leads', L.office, (req, res) => {
    const stage = L.str(req.query.stage, 20);
    res.json(db.prepare(`SELECT l.*, u.name AS assignee FROM leads l LEFT JOIN users u ON u.id=l.assigned_to
      WHERE l.tenant_id=? ${stage ? 'AND l.stage=?' : ''} ORDER BY l.id DESC LIMIT 300`).all(...(stage ? [T(req), stage] : [T(req)])));
  });
  app.post('/api/leads', L.office, (req, res) => {
    const name = L.str(req.body.name, 150);
    if (!L.must(res, name && (req.body.phone || req.body.email), 'Name and a phone or email are required.')) return;
    const r = db.prepare('INSERT INTO leads(tenant_id,name,phone,email,source,issue,assigned_to,callback_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(T(req), name, L.str(req.body.phone, 30), L.str(req.body.email, 200).toLowerCase(), L.str(req.body.source, 60) || 'manual',
        L.str(req.body.issue, 1500), L.int(req.body.assigned_to), req.body.callback_at || null);
    res.json({ id: r.lastInsertRowid });
  });
  app.get('/api/leads/:id', L.office, (req, res) => {
    const l = db.prepare('SELECT * FROM leads WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    l.notes = db.prepare('SELECT n.*, u.name AS user_name FROM lead_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.lead_id=? ORDER BY n.id DESC').all(l.id);
    res.json(l);
  });
  app.patch('/api/leads/:id', L.office, (req, res) => {
    const l = db.prepare('SELECT * FROM leads WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    const stages = ['new', 'contacted', 'callback', 'booked', 'won', 'lost'];
    db.prepare('UPDATE leads SET stage=?, assigned_to=?, callback_at=?, lost_reason=? WHERE id=?').run(
      stages.includes(req.body.stage) ? req.body.stage : l.stage, L.int(req.body.assigned_to, l.assigned_to),
      req.body.callback_at === undefined ? l.callback_at : (req.body.callback_at || null), L.str(req.body.lost_reason ?? l.lost_reason, 300), l.id);
    res.json({ ok: true });
  });
  app.post('/api/leads/:id/notes', L.office, (req, res) => {
    const l = db.prepare('SELECT * FROM leads WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    const outcome = L.str(req.body.outcome, 40), note = L.str(req.body.note, 1500);
    if (!L.must(res, outcome || note, 'Record the call outcome or a note.')) return;
    db.prepare('INSERT INTO lead_notes(tenant_id,lead_id,user_id,outcome,note) VALUES (?,?,?,?,?)').run(T(req), l.id, req.user.id, outcome, note);
    if (l.stage === 'new') db.prepare("UPDATE leads SET stage='contacted' WHERE id=?").run(l.id);
    if (req.body.callback_at) db.prepare("UPDATE leads SET callback_at=?, stage='callback' WHERE id=?").run(req.body.callback_at, l.id);
    res.json({ ok: true });
  });
  app.post('/api/leads/:id/convert', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const l = db.prepare('SELECT * FROM leads WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!l) return res.status(404).json({ error: 'Not found.' });
    if (l.client_id) return res.json({ client_id: l.client_id });
    const r = db.prepare('INSERT INTO clients(tenant_id,name,email,phone,notes,lead_id) VALUES (?,?,?,?,?,?)').run(T(req), l.name, l.email, l.phone, l.issue, l.id);
    db.prepare("UPDATE leads SET client_id=?, stage='won' WHERE id=?").run(r.lastInsertRowid, l.id);
    audit(T(req), req.user.id, 'lead_converted', 'lead', l.id, l.name, L.ip(req));
    res.json({ client_id: r.lastInsertRowid });
  });

  // =============== Appointments: set-up ===============
  app.get('/api/consult-types', L.office, (req, res) => {
    res.json(db.prepare('SELECT * FROM consult_types WHERE tenant_id=? ORDER BY id').all(T(req)));
  });
  app.post('/api/consult-types', L.need('admin'), (req, res) => {
    const name = L.str(req.body.name, 100), minutes = L.int(req.body.minutes), fee = Number(req.body.fee);
    if (!L.must(res, name && minutes >= 10 && minutes <= 180 && fee >= 0, 'Name, minutes (10–180) and fee are required.')) return;
    const r = db.prepare('INSERT INTO consult_types(tenant_id,name,minutes,fee_paise) VALUES (?,?,?,?)').run(T(req), name, minutes, L.paise(fee));
    res.json({ id: r.lastInsertRowid });
  });
  app.patch('/api/consult-types/:id', L.need('admin'), (req, res) => {
    const c = db.prepare('SELECT * FROM consult_types WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!c) return res.status(404).json({ error: 'Not found.' });
    db.prepare('UPDATE consult_types SET name=?, minutes=?, fee_paise=?, active=? WHERE id=?').run(
      L.str(req.body.name || c.name, 100), L.int(req.body.minutes, c.minutes), req.body.fee == null ? c.fee_paise : L.paise(req.body.fee),
      req.body.active == null ? c.active : (req.body.active ? 1 : 0), c.id);
    res.json({ ok: true });
  });
  app.get('/api/availability', L.office, (req, res) => {
    res.json(db.prepare(`SELECT a.*, u.name AS user_name FROM availability a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.user_id,a.weekday,a.start_time`).all(T(req)));
  });
  app.put('/api/availability', L.need('admin', 'advocate'), (req, res) => {
    const uid = L.int(req.body.user_id, req.user.id);
    if (!L.must(res, req.user.role === 'admin' || uid === req.user.id, 'You can set only your own availability.')) return;
    const u = db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND role IN ('admin','advocate')").get(uid, T(req));
    if (!L.must(res, u, 'Choose an advocate.')) return;
    const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
    const ok = slots.every((s) => s.weekday >= 0 && s.weekday <= 6 && /^\d\d:\d\d$/.test(s.start_time) && /^\d\d:\d\d$/.test(s.end_time) && s.start_time < s.end_time);
    if (!L.must(res, ok, 'Check the days and times.')) return;
    db.transaction(() => {
      db.prepare('DELETE FROM availability WHERE tenant_id=? AND user_id=?').run(T(req), uid);
      const ins = db.prepare('INSERT INTO availability(tenant_id,user_id,weekday,start_time,end_time) VALUES (?,?,?,?,?)');
      slots.forEach((s) => ins.run(T(req), uid, s.weekday, s.start_time, s.end_time));
    })();
    res.json({ ok: true });
  });

  // =============== Appointments: public booking + slots ===============
  const expireHolds = () => db.prepare("UPDATE appointments SET status='expired' WHERE status='awaiting_payment' AND hold_until<?").run(L.nowIso());

  const effFee = (tenantId, userId, ct) => {
    const o = db.prepare('SELECT fee_paise FROM consult_fees WHERE tenant_id=? AND user_id=? AND consult_type_id=?').get(tenantId, userId, ct.id);
    return o ? o.fee_paise : ct.fee_paise;
  };
  const advocatesWithSlots = (tenantId) => db.prepare(`SELECT DISTINCT u.id,u.name FROM availability a JOIN users u ON u.id=a.user_id
    WHERE a.tenant_id=? AND u.active=1 AND u.role IN ('admin','advocate') ORDER BY u.name`).all(tenantId);

  app.get('/api/consult-fees', L.office, (req, res) => {
    res.json(db.prepare('SELECT user_id,consult_type_id,fee_paise FROM consult_fees WHERE tenant_id=?').all(T(req)));
  });
  app.put('/api/consult-fees', L.need('admin', 'advocate'), (req, res) => {
    const uid = L.int(req.body.user_id, req.user.id);
    if (!L.must(res, req.user.role === 'admin' || uid === req.user.id, 'You can set only your own fees.')) return;
    const u = db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND role IN ('admin','advocate')").get(uid, T(req));
    const ct = db.prepare('SELECT id FROM consult_types WHERE id=? AND tenant_id=?').get(L.int(req.body.consult_type_id), T(req));
    if (!L.must(res, u && ct, 'Choose an advocate and a consultation type.')) return;
    if (req.body.fee === '' || req.body.fee == null) db.prepare('DELETE FROM consult_fees WHERE user_id=? AND consult_type_id=?').run(u.id, ct.id);
    else {
      const f = Number(req.body.fee);
      if (!L.must(res, Number.isFinite(f) && f >= 0 && f <= 1000000, 'Enter a valid fee in rupees.')) return;
      db.prepare('INSERT INTO consult_fees(tenant_id,user_id,consult_type_id,fee_paise) VALUES (?,?,?,?) ON CONFLICT(user_id,consult_type_id) DO UPDATE SET fee_paise=excluded.fee_paise').run(T(req), u.id, ct.id, L.paise(f));
    }
    audit(T(req), req.user.id, 'consult_fee_set', 'user', u.id, `type ${ct.id}: ${req.body.fee}`, L.ip(req));
    res.json({ ok: true });
  });

  app.get('/api/public/firm', (req, res) => { const t = pubFirm(req); res.json({ name: t ? t.name : 'Client Portal' }); });
  app.get('/api/public/booking', (req, res) => {
    const t = pubFirm(req);
    res.json({
      firm: t.name,
      pay_note: process.env.PAY_NOTE || '',
      types: db.prepare('SELECT id,name,minutes,fee_paise FROM consult_types WHERE tenant_id=? AND active=1 ORDER BY fee_paise').all(t.id),
      advocates: (() => { const types = db.prepare('SELECT * FROM consult_types WHERE tenant_id=? AND active=1').all(t.id);
        return advocatesWithSlots(t.id).map((a) => ({ ...a, fees: Object.fromEntries(types.map((c) => [c.id, effFee(t.id, a.id, c)])) })); })(),
    });
  });

  // slots for a date (IST). Weekday: 0=Sunday. Skips past times and already-held/booked slots.
  function slotsFor(tenantId, typeId, date, advocateId) {
    const ct = db.prepare('SELECT * FROM consult_types WHERE id=? AND tenant_id=? AND active=1').get(typeId, tenantId);
    if (!ct || !L.isDate(date)) return { ct: null, slots: [] };
    expireHolds();
    const wd = new Date(date + 'T12:00:00+05:30').getUTCDay();
    const avail = db.prepare(`SELECT a.* FROM availability a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? AND a.weekday=? AND u.active=1 AND (? IS NULL OR a.user_id=?) ORDER BY a.start_time`).all(tenantId, wd, advocateId || null, advocateId || null);
    const out = []; const now = Date.now() + 30 * 60000;
    for (const a of avail) {
      let s = new Date(`${date}T${a.start_time}:00+05:30`).getTime();
      const end = new Date(`${date}T${a.end_time}:00+05:30`).getTime();
      while (s + ct.minutes * 60000 <= end) {
        const e = s + ct.minutes * 60000;
        const clash = db.prepare(`SELECT 1 FROM appointments WHERE advocate_id=? AND status IN ('confirmed','awaiting_payment') AND start_at<? AND end_at>?
          AND (status='confirmed' OR hold_until>=?)`).get(a.user_id, new Date(e).toISOString(), new Date(s).toISOString(), L.nowIso());
        if (!clash && s >= now) out.push({ start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString(), advocate_id: a.user_id });
        s = e;
      }
    }
    return { ct, slots: out };
  }
  app.get('/api/public/slots', (req, res) => {
    const t = pubFirm(req);
    const { ct, slots } = slotsFor(t.id, L.int(req.query.type), req.query.date, L.int(req.query.advocate));
    res.json(slots.map((x) => ({ ...x, fee_paise: effFee(t.id, x.advocate_id, ct) })));
  });

  app.post('/api/public/book', limiter, (req, res) => {
    const t = pubFirm(req); const b = req.body;
    const name = L.str(b.name, 150), phone = L.str(b.phone, 30), email = L.str(b.email, 200).toLowerCase();
    if (!L.must(res, name && /^[0-9+\-\s]{8,15}$/.test(phone) && /^\S+@\S+\.\S+$/.test(email), 'Please give your name, a valid phone number and email.')) return;
    const date = new Date(new Date(b.start_at).getTime() + 330 * 60000).toISOString().slice(0, 10);
    const { ct, slots } = slotsFor(t.id, L.int(b.type_id), date, L.int(b.advocate_id));
    const slot = ct && slots.find((s) => s.start_at === new Date(b.start_at).toISOString());
    if (!L.must(res, slot, 'That time is no longer available. Please pick another.')) return;
    const clientId = req.user && req.user.role === 'client' ? req.user.client_id : null;
    const lead = db.prepare('INSERT INTO leads(tenant_id,name,phone,email,source,issue,stage,client_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(t.id, name, phone, email, 'online booking', L.str(b.issue, 1500), 'booked', clientId);
    const payRef = 'PAY-' + L.rand(6).toUpperCase();
    const r = db.prepare(`INSERT INTO appointments(tenant_id,lead_id,client_id,name,phone,email,issue,advocate_id,consult_type_id,start_at,end_at,mode,fee_paise,status,pay_ref,hold_until)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.id, lead.lastInsertRowid, clientId, name, phone, email, L.str(b.issue, 1500), slot.advocate_id, ct.id,
      slot.start_at, slot.end_at, 'video', effFee(t.id, slot.advocate_id, ct), 'awaiting_payment', payRef, new Date(Date.now() + 15 * 60000).toISOString());
    res.json({ id: r.lastInsertRowid, pay_ref: payRef, fee_paise: effFee(t.id, slot.advocate_id, ct), hold_minutes: 15, start_at: slot.start_at });
  });

  // Look up a booking by its payment reference (public — reference is the secret)
  app.get('/api/public/booking/:ref', (req, res) => {
    expireHolds();
    const a = db.prepare(`SELECT a.status,a.start_at,a.end_at,a.fee_paise,a.pay_ref,a.meet_link,ct.name AS type_name,u.name AS advocate FROM appointments a
      JOIN consult_types ct ON ct.id=a.consult_type_id JOIN users u ON u.id=a.advocate_id WHERE a.pay_ref=?`).get(L.str(req.params.ref, 30));
    if (!a) return res.status(404).json({ error: 'Booking not found.' });
    if (a.status !== 'confirmed') delete a.meet_link;
    res.json(a);
  });

  function confirmAppointment(a, mode, reference, userId) {
    const meet = 'https://meet.jit.si/KCLEGAL-' + L.rand(8);
    db.transaction(() => {
      let clientId = a.client_id;
      if (!clientId) {
        const ex = a.email && db.prepare('SELECT id FROM clients WHERE tenant_id=? AND lower(email)=?').get(a.tenant_id, a.email);
        clientId = ex ? ex.id : db.prepare('INSERT INTO clients(tenant_id,name,email,phone,lead_id) VALUES (?,?,?,?,?)').run(a.tenant_id, a.name, a.email, a.phone, a.lead_id).lastInsertRowid;
      }
      const { n, year } = nextNumber(a.tenant_id, 'rct');
      const rec = `${prefix(a.tenant_id)}/RCT/${pad(n)}/${year}`;
      db.prepare(`INSERT INTO payments(tenant_id,client_id,rec_no,pay_date,amount_paise,mode,reference,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(a.tenant_id, clientId, rec, todayStr(), a.fee_paise, mode, reference || a.pay_ref, 'Consultation fee ' + a.pay_ref, userId || null);
      db.prepare("UPDATE appointments SET status='confirmed', client_id=?, meet_link=?, hold_until=NULL WHERE id=?").run(clientId, meet, a.id);
      if (a.lead_id) db.prepare("UPDATE leads SET client_id=?, stage='booked' WHERE id=?").run(clientId, a.lead_id);
    })();
  }

  // Gateway webhook placeholder: replace the shared-secret check with Razorpay signature verification when the gateway is live.
  app.post('/api/payments/webhook', (req, res) => {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret || req.headers['x-webhook-secret'] !== secret) return res.status(401).json({ error: 'Unauthorised.' });
    const a = db.prepare("SELECT * FROM appointments WHERE pay_ref=?").get(L.str(req.body.pay_ref, 30));
    if (!a) return res.status(404).json({ error: 'Unknown reference.' });
    if (req.body.status === 'paid' && a.status !== 'confirmed' && Number(req.body.amount_paise) >= a.fee_paise) confirmAppointment(a, 'online', L.str(req.body.txn_id, 60), null);
    res.json({ ok: true });
  });

  // =============== Appointments: office ===============
  app.get('/api/appointments', L.requireLogin, (req, res) => {
    expireHolds();
    if (isClient(req.user)) {
      return res.json(db.prepare(`SELECT a.id,a.start_at,a.end_at,a.status,a.fee_paise,a.pay_ref,CASE WHEN a.status='confirmed' THEN a.meet_link END AS meet_link,ct.name AS type_name
        FROM appointments a JOIN consult_types ct ON ct.id=a.consult_type_id WHERE a.client_id=? ORDER BY a.start_at DESC`).all(req.user.client_id));
    }
    res.json(db.prepare(`SELECT a.*, ct.name AS type_name, u.name AS advocate FROM appointments a JOIN consult_types ct ON ct.id=a.consult_type_id
      JOIN users u ON u.id=a.advocate_id WHERE a.tenant_id=? AND a.start_at>=? AND a.status<>'expired' ORDER BY a.start_at LIMIT 200`)
      .all(T(req), new Date(Date.now() - 7 * 86400000).toISOString()));
  });
  app.post('/api/appointments/:id/confirm', L.need('admin', 'advocate', 'staff', 'accounts'), (req, res) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!a) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, ['awaiting_payment', 'expired'].includes(a.status), 'This booking is already settled.')) return;
    const ref = L.str(req.body.reference, 60);
    if (!L.must(res, ref, 'Enter the payment reference (UTR / receipt) to confirm.')) return;
    confirmAppointment(a, L.str(req.body.mode, 20) || 'upi', ref, req.user.id);
    audit(T(req), req.user.id, 'appointment_confirmed', 'appointment', a.id, ref, L.ip(req));
    res.json({ ok: true });
  });
  app.post('/api/appointments/:id/cancel', L.requireLogin, (req, res) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!a || (isClient(req.user) && a.client_id !== req.user.client_id)) return res.status(404).json({ error: 'Not found.' });
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(a.id);
    res.json({ ok: true });
  });

  // =============== Billing: invoices ===============
  app.get('/api/invoices', L.requireLogin, (req, res) => {
    const cli = isClient(req.user);
    const rows = db.prepare(`SELECT i.*, c.name AS client_name,
      COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.invoice_id=i.id),0) AS paid_paise
      FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.tenant_id=? ${cli ? "AND i.client_id=? AND i.status NOT IN ('draft','cancelled')" : ''}
      ORDER BY i.id DESC LIMIT 300`).all(...(cli ? [T(req), req.user.client_id] : [T(req)]));
    if (!cli && req.user.role === 'telecaller') return res.status(403).json({ error: 'Not permitted.' });
    res.json(rows);
  });
  app.get('/api/invoices/:id', L.requireLogin, (req, res) => {
    const i = db.prepare('SELECT i.*, c.name AS client_name, c.address AS client_address FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.tenant_id=?').get(req.params.id, T(req));
    if (!i || (isClient(req.user) && (i.client_id !== req.user.client_id || ['draft', 'cancelled'].includes(i.status)))) return res.status(404).json({ error: 'Not found.' });
    if (req.user.role === 'telecaller') return res.status(403).json({ error: 'Not permitted.' });
    i.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(i.id);
    i.payments = db.prepare('SELECT id,rec_no,pay_date,amount_paise,mode,reference FROM payments WHERE invoice_id=? ORDER BY id').all(i.id);
    i.paid_paise = i.payments.reduce((s, p) => s + p.amount_paise, 0);
    i.firm = db.prepare('SELECT name FROM tenants WHERE id=?').get(T(req)).name;
    res.json(i);
  });
  app.post('/api/invoices', BILL, (req, res) => {
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.body.client_id), T(req));
    const items = (Array.isArray(req.body.items) ? req.body.items : []).map((x) => ({ d: L.str(x.description, 250), q: Number(x.qty) || 1, r: L.paise(x.rate) }))
      .filter((x) => x.d && x.r > 0 && x.q > 0);
    if (!L.must(res, client && items.length, 'Choose a client and add at least one line with an amount.')) return;
    const date = L.isDate(req.body.inv_date) ? req.body.inv_date : todayStr();
    const total = items.reduce((s, x) => s + Math.round(x.q * x.r), 0);
    const { n, year } = nextNumber(T(req), 'inv');
    const no = `${prefix(T(req))}/INV/${pad(n)}/${year}`;
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO invoices(tenant_id,client_id,matter_id,inv_no,inv_date,due_date,notes,total_paise) VALUES (?,?,?,?,?,?,?,?)')
        .run(T(req), client.id, L.int(req.body.matter_id), no, date, L.isDate(req.body.due_date) ? req.body.due_date : null, L.str(req.body.notes, 800), total);
      const ins = db.prepare('INSERT INTO invoice_items(tenant_id,invoice_id,description,qty,rate_paise) VALUES (?,?,?,?,?)');
      items.forEach((x) => ins.run(T(req), r.lastInsertRowid, x.d, x.q, x.r));
      return r.lastInsertRowid;
    })();
    audit(T(req), req.user.id, 'invoice_created', 'invoice', id, no, L.ip(req));
    res.json({ id, inv_no: no, total_paise: total });
  });
  const invAction = (path, from, to) => app.post(`/api/invoices/:id/${path}`, BILL, (req, res) => {
    const i = db.prepare('SELECT * FROM invoices WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!i) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, from.includes(i.status), `This invoice is ${i.status} and cannot be changed this way.`)) return;
    db.prepare('UPDATE invoices SET status=? WHERE id=?').run(to, i.id);
    audit(T(req), req.user.id, 'invoice_' + path, 'invoice', i.id, i.inv_no, L.ip(req));
    res.json({ ok: true });
  });
  invAction('issue', ['draft'], 'sent');
  invAction('cancel', ['draft', 'sent'], 'cancelled');

  function refreshInvoice(invoiceId) {
    const i = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
    if (!i || ['draft', 'cancelled'].includes(i.status)) return;
    const paid = db.prepare('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE invoice_id=?').get(i.id).v;
    db.prepare('UPDATE invoices SET status=? WHERE id=?').run(paid >= i.total_paise ? 'paid' : paid > 0 ? 'part_paid' : 'sent', i.id);
  }

  // =============== One-time import from Zoho Books (admin) ===============
  app.post('/api/admin/import-zoho', L.need('admin'), (req, res) => {
    const d = req.body || {};
    if (!L.must(res, Array.isArray(d.clients) && Array.isArray(d.invoices) && Array.isArray(d.payments) && d.clients.length <= 2000 && d.invoices.length <= 5000 && d.payments.length <= 5000, 'This is not a valid Zoho import file.')) return;
    const t = T(req); const p100 = (x) => Math.round((Number(x) || 0) * 100); const out = { clients: 0, invoices: 0, payments: 0, skipped: 0 };
    db.transaction(() => {
      const cmap = {};
      for (const c of d.clients) {
        const tag = 'ID ' + L.str(c.zoho_id, 40);
        let row = db.prepare('SELECT id FROM clients WHERE tenant_id=? AND notes LIKE ?').get(t, '%(' + tag + ')%');
        if (!row) {
          const r = db.prepare('INSERT INTO clients(tenant_id,name,email,phone,address,notes) VALUES (?,?,?,?,?,?)')
            .run(t, L.str(c.name, 200), L.str(c.email, 200) || null, L.str(c.phone, 40) || null, L.str(c.address, 400) || null, L.str(c.notes, 800));
          row = { id: r.lastInsertRowid }; out.clients++;
        }
        cmap[c.zoho_id] = row.id;
      }
      const imap = {};
      for (const i of d.invoices) {
        const cid = cmap[i.zoho_id]; const no = L.str(i.inv_no, 40);
        if (!cid || !no || !L.isDate(i.date)) { out.skipped++; continue; }
        const ex = db.prepare('SELECT id FROM invoices WHERE tenant_id=? AND inv_no=?').get(t, no);
        if (ex) { imap[no] = ex.id; out.skipped++; continue; }
        const total = p100(i.total); const paid = p100(i.paid);
        const status = i.status === 'paid' ? 'paid' : i.status === 'draft' ? 'draft' : paid > 0 ? 'part_paid' : 'sent';
        const r = db.prepare('INSERT INTO invoices(tenant_id,client_id,inv_no,inv_date,due_date,notes,status,total_paise) VALUES (?,?,?,?,?,?,?,?)')
          .run(t, cid, no, i.date, L.isDate(i.due) ? i.due : null, L.str(i.ref, 200) || 'Imported from Zoho Books', status, total);
        db.prepare('INSERT INTO invoice_items(tenant_id,invoice_id,description,qty,rate_paise) VALUES (?,?,?,?,?)').run(t, r.lastInsertRowid, 'Professional fees (Zoho Books ' + no + ')', 1, total);
        imap[no] = r.lastInsertRowid; out.invoices++;
      }
      for (const p of d.payments) {
        const cid = cmap[p.zoho_id]; const rec = L.str(p.rec_no, 40);
        if (!cid || !rec || !L.isDate(p.date) || !(p100(p.amount) > 0)) { out.skipped++; continue; }
        if (db.prepare('SELECT 1 FROM payments WHERE tenant_id=? AND rec_no=?').get(t, rec)) { out.skipped++; continue; }
        db.prepare('INSERT INTO payments(tenant_id,client_id,invoice_id,rec_no,pay_date,amount_paise,mode,reference,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(t, cid, p.inv_no ? imap[p.inv_no] || null : null, rec, p.date, p100(p.amount), p.mode === 'cash' ? 'cash' : 'bank', L.str(p.ref, 200) || null, 'Imported from Zoho Books', req.user.id);
        out.payments++;
      }
    })();
    audit(t, req.user.id, 'zoho_import', 'import', 0, JSON.stringify(out), L.ip(req));
    res.json(out);
  });

  // =============== Billing: payments & receipts ===============
  function recordPayment(req, d) {
    const { n, year } = nextNumber(T(req), 'rct');
    const rec = `${prefix(T(req))}/RCT/${pad(n)}/${year}`;
    const r = db.prepare(`INSERT INTO payments(tenant_id,client_id,invoice_id,rec_no,pay_date,amount_paise,mode,reference,notes,bank_txn_id,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(T(req), d.client_id, d.invoice_id || null, rec, d.pay_date, d.amount_paise, d.mode, d.reference || null, d.notes || null, d.bank_txn_id || null, req.user.id);
    if (d.mode === 'cash') {
      db.prepare('INSERT INTO cash_entries(tenant_id,entry_date,kind,amount_paise,head,narration,client_id,created_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(T(req), d.pay_date, 'in', d.amount_paise, 'Fees received', 'Receipt ' + rec, d.client_id, req.user.id);
    }
    if (d.invoice_id) refreshInvoice(d.invoice_id);
    audit(T(req), req.user.id, 'payment_recorded', 'payment', r.lastInsertRowid, rec, L.ip(req));
    return { id: r.lastInsertRowid, rec_no: rec };
  }

  app.post('/api/payments', BILL, (req, res) => {
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.body.client_id), T(req));
    const amount = L.paise(req.body.amount);
    const mode = ['cash', 'bank', 'upi', 'cheque', 'card', 'online'].includes(req.body.mode) ? req.body.mode : null;
    if (!L.must(res, client && amount > 0 && mode, 'Client, amount and mode are required.')) return;
    const inv = L.int(req.body.invoice_id) ? db.prepare('SELECT * FROM invoices WHERE id=? AND tenant_id=? AND client_id=?').get(L.int(req.body.invoice_id), T(req), client.id) : null;
    if (req.body.invoice_id && !L.must(res, inv && !['draft', 'cancelled'].includes(inv.status), 'Choose an issued invoice of this client.')) return;
    res.json(recordPayment(req, { client_id: client.id, invoice_id: inv && inv.id, amount_paise: amount, mode,
      pay_date: L.isDate(req.body.pay_date) ? req.body.pay_date : todayStr(), reference: L.str(req.body.reference, 80), notes: L.str(req.body.notes, 300) }));
  });
  app.get('/api/payments', BILL, (req, res) => {
    res.json(db.prepare(`SELECT p.*, c.name AS client_name, i.inv_no FROM payments p JOIN clients c ON c.id=p.client_id LEFT JOIN invoices i ON i.id=p.invoice_id
      WHERE p.tenant_id=? ORDER BY p.id DESC LIMIT 300`).all(T(req)));
  });
  app.get('/api/payments/:id', L.requireLogin, (req, res) => {
    const p = db.prepare(`SELECT p.*, c.name AS client_name, i.inv_no FROM payments p JOIN clients c ON c.id=p.client_id LEFT JOIN invoices i ON i.id=p.invoice_id
      WHERE p.id=? AND p.tenant_id=?`).get(req.params.id, T(req));
    if (!p || (isClient(req.user) && p.client_id !== req.user.client_id)) return res.status(404).json({ error: 'Not found.' });
    if (req.user.role === 'telecaller') return res.status(403).json({ error: 'Not permitted.' });
    p.firm = db.prepare('SELECT name FROM tenants WHERE id=?').get(T(req)).name;
    res.json(p);
  });
  app.get('/api/my/payments', L.requireLogin, (req, res) => {
    if (!isClient(req.user)) return res.status(400).json({ error: 'Clients only.' });
    res.json(db.prepare('SELECT id,rec_no,pay_date,amount_paise,mode FROM payments WHERE client_id=? ORDER BY id DESC').all(req.user.client_id));
  });

  // =============== Cash book ===============
  app.get('/api/cash', BILL, (req, res) => {
    const from = L.isDate(req.query.from) ? req.query.from : '0000-01-01', to = L.isDate(req.query.to) ? req.query.to : '9999-12-31';
    const sum = (k, where, ...a) => db.prepare(`SELECT COALESCE(SUM(amount_paise),0) v FROM cash_entries WHERE tenant_id=? AND kind=? AND ${where}`).get(T(req), k, ...a).v;
    const opening = sum('in', 'entry_date<?', from) - sum('out', 'entry_date<?', from);
    const rows = db.prepare('SELECT * FROM cash_entries WHERE tenant_id=? AND entry_date>=? AND entry_date<=? ORDER BY entry_date,id').all(T(req), from, to);
    let bal = opening; rows.forEach((r) => { bal += r.kind === 'in' ? r.amount_paise : -r.amount_paise; r.balance_paise = bal; });
    res.json({ opening_paise: opening, closing_paise: bal, rows });
  });
  app.post('/api/cash', BILL, (req, res) => {
    const amount = L.paise(req.body.amount), head = L.str(req.body.head, 80);
    if (!L.must(res, ['in', 'out'].includes(req.body.kind) && amount > 0 && head, 'Type, amount and head are required.')) return;
    const r = db.prepare('INSERT INTO cash_entries(tenant_id,entry_date,kind,amount_paise,head,narration,client_id,created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(T(req), L.isDate(req.body.entry_date) ? req.body.entry_date : todayStr(), req.body.kind, amount, head, L.str(req.body.narration, 300), L.int(req.body.client_id), req.user.id);
    res.json({ id: r.lastInsertRowid });
  });

  // =============== Bank statement import + reconciliation ===============
  function suggest(tenantId, t) {
    if (!t.credit_paise) return;
    const narr = (t.narration || '').toUpperCase();
    const clients = db.prepare('SELECT id,name,phone FROM clients WHERE tenant_id=?').all(tenantId);
    const hits = clients.filter((c) => {
      const words = c.name.toUpperCase().split(/\s+/).filter((w) => w.length >= 4 && !['MRS', 'MESSRS', 'LTD', 'PVT', 'LIMITED', 'PRIVATE'].includes(w));
      return (words.length && words.every((w) => narr.includes(w))) || (c.phone && c.phone.replace(/\D/g, '').length >= 10 && narr.includes(c.phone.replace(/\D/g, '').slice(-10)));
    });
    if (hits.length === 1) db.prepare("UPDATE bank_txns SET matched_client_id=?, status='suggested' WHERE id=?").run(hits[0].id, t.id);
  }
  app.post('/api/bank/import', BILL, (req, res) => {
    const rows = parseCsv(String(req.body.csv || ''));
    if (!L.must(res, rows.length > 1, 'The file looks empty. Upload the bank statement as CSV.')) return;
    let hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /(debit|withdraw|credit|deposit)/i.test(c)));
    if (!L.must(res, hi >= 0, 'Could not find the header row (Date, Narration, Debit, Credit). Check the file.')) return;
    const H = rows[hi].map((h) => h.toLowerCase());
    const ix = (re) => H.findIndex((h) => re.test(h));
    const c = { d: ix(/date/), n: ix(/narr|desc|particular|remark/), ref: ix(/ref|chq|cheque|utr/), dr: ix(/debit|withdraw/), cr: ix(/credit|deposit/), bal: ix(/bal/) };
    let added = 0, skipped = 0, bad = 0;
    const find = db.prepare('SELECT 1 FROM bank_txns WHERE tenant_id=? AND txn_date=? AND COALESCE(narration,\'\')=? AND COALESCE(ref,\'\')=? AND debit_paise=? AND credit_paise=?');
    const ins = db.prepare('INSERT INTO bank_txns(tenant_id,txn_date,narration,ref,debit_paise,credit_paise,balance_paise) VALUES (?,?,?,?,?,?,?)');
    db.transaction(() => {
      for (const r of rows.slice(hi + 1)) {
        const d = parseDate(r[c.d]); const dr = c.dr >= 0 ? money(r[c.dr]) : 0, cr = c.cr >= 0 ? money(r[c.cr]) : 0;
        if (!d || (!dr && !cr)) { bad++; continue; }
        const narr = L.str(c.n >= 0 ? r[c.n] : '', 300), ref = L.str(c.ref >= 0 ? r[c.ref] : '', 80);
        if (find.get(T(req), d, narr, ref, dr, cr)) { skipped++; continue; }
        const x = ins.run(T(req), d, narr, ref, dr, cr, c.bal >= 0 && r[c.bal] ? money(r[c.bal]) : null);
        suggest(T(req), { id: x.lastInsertRowid, narration: narr, credit_paise: cr });
        added++;
      }
    })();
    audit(T(req), req.user.id, 'bank_import', 'bank', null, `added ${added}, duplicates ${skipped}`, L.ip(req));
    res.json({ added, duplicates: skipped, unreadable: bad });
  });
  app.get('/api/bank', BILL, (req, res) => {
    const st = L.str(req.query.status, 20);
    res.json(db.prepare(`SELECT b.*, c.name AS client_name FROM bank_txns b LEFT JOIN clients c ON c.id=b.matched_client_id
      WHERE b.tenant_id=? ${st ? 'AND b.status=?' : ''} ORDER BY b.txn_date DESC, b.id DESC LIMIT 500`).all(...(st ? [T(req), st] : [T(req)])));
  });
  app.post('/api/bank/:id/match', BILL, (req, res) => {
    const t = db.prepare('SELECT * FROM bank_txns WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!t) return res.status(404).json({ error: 'Not found.' });
    if (!L.must(res, t.credit_paise > 0 && t.status !== 'matched', 'Only an unmatched credit can be matched to a client.')) return;
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.body.client_id) || t.matched_client_id, T(req));
    if (!L.must(res, client, 'Choose the client this receipt belongs to.')) return;
    const invId = L.int(req.body.invoice_id);
    const inv = invId ? db.prepare("SELECT id FROM invoices WHERE id=? AND tenant_id=? AND client_id=? AND status IN ('sent','part_paid')").get(invId, T(req), client.id) : null;
    if (invId && !L.must(res, inv, 'Choose an open invoice of this client.')) return;
    const out = db.transaction(() => {
      const p = recordPayment(req, { client_id: client.id, invoice_id: inv && inv.id, amount_paise: t.credit_paise, mode: 'bank', pay_date: t.txn_date, reference: t.ref || t.narration, bank_txn_id: t.id });
      db.prepare("UPDATE bank_txns SET status='matched', matched_payment_id=?, matched_client_id=? WHERE id=?").run(p.id, client.id, t.id);
      return p;
    })();
    res.json(out);
  });
  app.post('/api/bank/:id/ignore', BILL, (req, res) => {
    db.prepare("UPDATE bank_txns SET status='ignored' WHERE id=? AND tenant_id=? AND status<>'matched'").run(req.params.id, T(req));
    res.json({ ok: true });
  });

  // =============== Reports ===============
  app.get('/api/reports/ledger', BILL, (req, res) => {
    const client = db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.query.client_id), T(req));
    if (!client) return res.status(404).json({ error: 'Choose a client.' });
    const rows = [
      ...db.prepare("SELECT inv_date AS date, 'Invoice ' || inv_no AS particulars, total_paise AS debit_paise, 0 AS credit_paise FROM invoices WHERE client_id=? AND status NOT IN ('draft','cancelled')").all(client.id),
      ...db.prepare("SELECT pay_date AS date, 'Receipt ' || rec_no || ' (' || mode || ')' AS particulars, 0 AS debit_paise, amount_paise AS credit_paise FROM payments WHERE client_id=?").all(client.id),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0; rows.forEach((r) => { bal += r.debit_paise - r.credit_paise; r.balance_paise = bal; });
    res.json({ client, rows, balance_paise: bal });
  });
  app.get('/api/reports/outstanding', BILL, (req, res) => {
    res.json(db.prepare(`SELECT c.id,c.name,c.phone,
      COALESCE((SELECT SUM(total_paise) FROM invoices i WHERE i.client_id=c.id AND i.status NOT IN ('draft','cancelled')),0) AS billed_paise,
      COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.client_id=c.id),0) AS paid_paise
      FROM clients c WHERE c.tenant_id=? ORDER BY c.name`).all(T(req)).map((x) => ({ ...x, due_paise: x.billed_paise - x.paid_paise })).filter((x) => x.due_paise !== 0));
  });
  app.get('/api/reports/final', BILL, (req, res) => {
    const from = L.isDate(req.query.from) ? req.query.from : `${new Date().getFullYear()}-04-01`;
    const to = L.isDate(req.query.to) ? req.query.to : todayStr();
    const t = T(req);
    const one = (sql, ...a) => db.prepare(sql).get(...a).v;
    const income = db.prepare('SELECT mode, SUM(amount_paise) AS paise FROM payments WHERE tenant_id=? AND pay_date>=? AND pay_date<=? GROUP BY mode').all(t, from, to);
    const expenses = db.prepare("SELECT head, SUM(amount_paise) AS paise FROM cash_entries WHERE tenant_id=? AND kind='out' AND entry_date>=? AND entry_date<=? GROUP BY head").all(t, from, to);
    const bankOut = one("SELECT COALESCE(SUM(debit_paise),0) v FROM bank_txns WHERE tenant_id=? AND status<>'ignored' AND txn_date>=? AND txn_date<=?", t, from, to);
    if (bankOut) expenses.push({ head: 'Bank payments (from statement)', paise: bankOut });
    const totalIncome = income.reduce((s, x) => s + x.paise, 0), totalExp = expenses.reduce((s, x) => s + x.paise, 0);
    const cashBal = one("SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount_paise ELSE -amount_paise END),0) v FROM cash_entries WHERE tenant_id=? AND entry_date<=?", t, to);
    const lastBank = db.prepare('SELECT balance_paise FROM bank_txns WHERE tenant_id=? AND balance_paise IS NOT NULL AND txn_date<=? ORDER BY txn_date DESC, id DESC LIMIT 1').get(t, to);
    const billed = one("SELECT COALESCE(SUM(total_paise),0) v FROM invoices WHERE tenant_id=? AND status NOT IN ('draft','cancelled') AND inv_date<=?", t, to);
    const paidAll = one('SELECT COALESCE(SUM(amount_paise),0) v FROM payments WHERE tenant_id=? AND pay_date<=?', t, to);
    res.json({ from, to, income, expenses, total_income_paise: totalIncome, total_expense_paise: totalExp, surplus_paise: totalIncome - totalExp,
      cash_balance_paise: cashBal, bank_balance_paise: lastBank ? lastBank.balance_paise : null, receivables_paise: Math.max(0, billed - paidAll) });
  });

  // =============== Judgments ===============
  const SOURCES = [
    { name: 'Supreme Court of India', url: 'https://www.sci.gov.in/judgements-judgement-date/' },
    { name: 'Calcutta High Court', url: 'https://calcuttahighcourt.gov.in/' },
    { name: 'eCourts services (case status)', url: 'https://services.ecourts.gov.in/ecourtindia_v6/' },
    { name: 'NCLT', url: 'https://nclt.gov.in/' },
    { name: 'NCLAT', url: 'https://nclat.nic.in/' },
    { name: 'DRT / DRAT', url: 'https://drt.gov.in/' },
    { name: 'National Green Tribunal', url: 'https://greentribunal.gov.in/' },
    { name: 'Indian Kanoon (free search)', url: 'https://indiankanoon.org/' },
  ];
  app.get('/api/judgments/sources', L.office, (req, res) => res.json(SOURCES));
  app.get('/api/judgments', L.office, (req, res) => {
    const q = L.str(req.query.q, 120).replace(/["'*()^:\-]/g, ' ');
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
    if (!tokens.length) return res.json(db.prepare('SELECT id,court,case_no,title,judge,decided_on,citation,subject FROM judgments WHERE tenant_id=? ORDER BY id DESC LIMIT 50').all(T(req)));
    const match = tokens.map((t) => `"${t}"*`).join(' ');
    res.json(db.prepare(`SELECT j.id,j.court,j.case_no,j.title,j.judge,j.decided_on,j.citation,j.subject,
      snippet(judgments_fts, 1, '[', ']', ' … ', 18) AS snippet
      FROM judgments_fts f JOIN judgments j ON j.id=f.rowid WHERE judgments_fts MATCH ? AND j.tenant_id=? ORDER BY rank LIMIT 50`).all(match, T(req)));
  });
  app.get('/api/judgments/:id', L.office, (req, res) => {
    const j = db.prepare('SELECT * FROM judgments WHERE id=? AND tenant_id=?').get(req.params.id, T(req));
    if (!j) return res.status(404).json({ error: 'Not found.' });
    res.json(j);
  });
  app.post('/api/judgments', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const court = L.str(req.body.court, 150), title = L.str(req.body.title, 300);
    if (!L.must(res, court && title, 'Court and case title are required.')) return;
    const url = L.str(req.body.source_url, 500);
    if (!L.must(res, !url || /^https?:\/\//i.test(url), 'Source link must start with http:// or https://')) return;
    const r = db.prepare(`INSERT INTO judgments(tenant_id,court,case_no,title,judge,decided_on,citation,subject,summary,source_url,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(T(req), court, L.str(req.body.case_no, 100), title, L.str(req.body.judge, 150), L.isDate(req.body.decided_on) ? req.body.decided_on : null,
        L.str(req.body.citation, 150), L.str(req.body.subject, 200), L.str(req.body.summary, 8000), url, req.user.id);
    res.json({ id: r.lastInsertRowid });
  });
  app.delete('/api/judgments/:id', L.need('admin'), (req, res) => {
    db.prepare('DELETE FROM judgments WHERE id=? AND tenant_id=?').run(req.params.id, T(req));
    res.json({ ok: true });
  });
};
