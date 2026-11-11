'use strict';
// WhatsApp messages to clients through Meta's WhatsApp Business Cloud API (the official channel).
// - Business-started messages must use a template approved by Meta; free text is allowed only within 24 hours of the client's last message.
// - Without the API set up, "Open in WhatsApp" (wa.me) lets staff send by hand from their own phone / WhatsApp Web; the attempt is still logged.
const crypto = require('crypto');
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

const GRAPH = 'https://graph.facebook.com/v21.0';
let transport = async (method, url, { headers, body } = {}) => { const r = await fetch(url, { method, headers, body }); return { status: r.status, json: async () => r.json().catch(() => ({})) }; };
const setTransport = (t) => { transport = t; };

// Templates the firm creates (and gets approved) in Meta's WhatsApp Manager. Names must match exactly; {{1}}, {{2}} are filled in when sending.
const DEFAULT_TEMPLATES = [
  { name: 'kc_hearing_reminder', label: 'Hearing reminder', text: 'Dear {{1}}, your case {{2}} is listed on {{3}}. — {{4}}', vars: ['Client name', 'Case', 'Date', 'Firm'] },
  { name: 'kc_appointment_confirmed', label: 'Consultation confirmed', text: 'Dear {{1}}, your consultation on {{2}} is confirmed. Join here: {{3}} — {{4}}', vars: ['Client name', 'Date & time', 'Video link', 'Firm'] },
  { name: 'kc_fee_reminder', label: 'Fee reminder', text: 'Dear {{1}}, a gentle reminder that invoice {{2}} for {{3}} is pending. — {{4}}', vars: ['Client name', 'Invoice no.', 'Amount', 'Firm'] },
  { name: 'kc_payment_link', label: 'Payment reminder with link', text: 'Dear {{1}}, invoice {{2}} for {{3}} is pending. You can pay by Google Pay / any UPI app here: {{4}} — {{5}}', vars: ['Client name', 'Invoice no.', 'Amount', 'Payment link', 'Firm'] },
  { name: 'kc_birthday', label: 'Birthday greeting', text: 'Dear {{1}}, warm birthday greetings from {{2}}! Wishing you good health and happiness in the year ahead.', vars: ['Name', 'Firm'] },
  { name: 'kc_welcome', label: 'Welcome greeting', text: 'Welcome to {{1}}! Dear {{2}}, thank you for choosing us. We will keep you informed about your matters here. For any query, just reply to this message. — {{1}}', vars: ['Firm', 'Client name'] },
  { name: 'kc_general_update', label: 'General update', text: 'Dear {{1}}, {{2}} — {{3}}', vars: ['Client name', 'Message', 'Firm'] },
];
const S = (t, k, d = '') => AI.getS(t, k, d);
const cfg = (t) => ({ phone_id: S(t, 'wa_phone_id'), token: AI.dec(S(t, 'wa_token')), app_secret: AI.dec(S(t, 'wa_app_secret')), verify: S(t, 'wa_verify'), waba: S(t, 'wa_waba'), lang: S(t, 'wa_lang', 'en') });
const configured = (t) => { const c = cfg(t); return !!(c.phone_id && c.token) && AI.svc(t, 'whatsapp'); };
const templates = (t) => { try { const j = JSON.parse(S(t, 'wa_templates')); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return DEFAULT_TEMPLATES; };

// 10-digit Indian numbers get 91; leading 0 / + / spaces removed
function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const lastTen = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const fill = (text, vars) => String(text).replace(/\{\{(\d+)\}\}/g, (_, i) => (vars[i - 1] != null ? vars[i - 1] : ''));

async function graph(t, payload) {
  const c = cfg(t);
  const r = await transport('POST', `${GRAPH}/${encodeURIComponent(c.phone_id)}/messages`, { headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }) });
  const j = await r.json();
  if (r.status >= 300) throw new Error((j.error && (j.error.error_user_msg || j.error.message)) || 'WhatsApp refused the message (' + r.status + ').');
  return j.messages && j.messages[0] && j.messages[0].id;
}
const windowOpen = (t, clientId) => !!db.prepare("SELECT 1 FROM wa_messages WHERE tenant_id=? AND client_id=? AND direction='in' AND created_at > datetime('now','-24 hours')").get(t, clientId);

// Send to a client. opts: { template, vars } or { text }. Returns { id, status } or { link } when the API is not set up.
async function sendToClient(t, clientId, opts, userId) {
  const cl = db.prepare('SELECT id,name,phone,wa_optout FROM clients WHERE id=? AND tenant_id=?').get(clientId, t);
  if (!cl) throw Object.assign(new Error('Client not found.'), { status: 404 });
  const to = normPhone(cl.phone); if (!to) throw Object.assign(new Error('This client has no valid mobile number. Add one on the client page.'), { status: 400 });
  if (cl.wa_optout) throw Object.assign(new Error('This client has asked not to receive WhatsApp messages.'), { status: 409 });
  let body, row = { template: null, kind: 'text' };
  if (opts.template) {
    const tpl = templates(t).find((x) => x.name === opts.template); if (!tpl) throw Object.assign(new Error('Unknown template.'), { status: 400 });
    const vars = (opts.vars || []).map((v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 300));
    body = fill(tpl.text, vars); row = { template: tpl.name, kind: 'template', vars };
  } else { body = L.str(opts.text, 1500); if (!body) throw Object.assign(new Error('Write a message.'), { status: 400 }); }
  if (!configured(t)) {
    const r = db.prepare("INSERT INTO wa_messages(tenant_id,client_id,phone,direction,kind,template,body,status,created_by) VALUES (?,?,?,'out',?,?,?,'opened',?)").run(t, clientId, to, row.kind, row.template, body, userId || null);
    return { id: r.lastInsertRowid, status: 'opened', link: `https://wa.me/${to}?text=${encodeURIComponent(body)}` };
  }
  if (!opts.template && !windowOpen(t, clientId)) throw Object.assign(new Error('WhatsApp allows free-text only within 24 hours of the client\'s last message. Use a template instead.'), { status: 409 });
  const payload = opts.template
    ? { to, type: 'template', template: { name: row.template, language: { code: cfg(t).lang }, components: row.vars.length ? [{ type: 'body', parameters: row.vars.map((v) => ({ type: 'text', text: v || '-' })) }] : [] } }
    : { to, type: 'text', text: { body, preview_url: false } };
  const ins = db.prepare("INSERT INTO wa_messages(tenant_id,client_id,phone,direction,kind,template,body,status,created_by) VALUES (?,?,?,'out',?,?,?,'queued',?)").run(t, clientId, to, row.kind, row.template, body, userId || null);
  try { const wid = await graph(t, payload); db.prepare("UPDATE wa_messages SET wa_id=?, status='sent' WHERE id=?").run(wid || null, ins.lastInsertRowid); return { id: ins.lastInsertRowid, status: 'sent' }; }
  catch (e) { db.prepare("UPDATE wa_messages SET status='failed', error=? WHERE id=?").run(String(e.message).slice(0, 300), ins.lastInsertRowid); throw Object.assign(e, { status: 502, rowId: ins.lastInsertRowid }); }
}

// First time a client has a WhatsApp number in the portal: send one welcome greeting (only when the API is set up, switch in Settings).
async function welcomePending(t) {
  if (S(t, 'wa_welcome', '1') !== '1' || !configured(t)) return 0;
  const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'KC LEGAL'; let n = 0;
  for (const c of db.prepare("SELECT id,name,phone FROM clients WHERE tenant_id=? AND wa_welcomed_at IS NULL AND phone IS NOT NULL AND phone<>''").all(t)) {
    if (!normPhone(c.phone)) continue;
    if (db.prepare("UPDATE clients SET wa_welcomed_at=? WHERE id=? AND wa_welcomed_at IS NULL").run(new Date().toISOString(), c.id).changes !== 1) continue;   // claim first: never greet twice
    try { await sendToClient(t, c.id, { template: 'kc_welcome', vars: [firm, c.name] }, null); n++; } catch (e) { /* logged as failed in the chat; not retried */ }
  }
  return n;
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id, admin = L.need('admin'), staffy = L.need('admin', 'advocate', 'staff');
  const base = (req) => (process.env.PUBLIC_URL || `https://${req.headers.host}`);
  const status = (req) => { const t = T(req), c = cfg(t); return { configured: configured(t), phone_id: c.phone_id, waba: c.waba, lang: c.lang, has_token: !!c.token, has_secret: !!c.app_secret, verify: c.verify, webhook_url: `${base(req)}/api/whatsapp/webhook/${t}`, templates: templates(t), auto_booking: S(t, 'wa_auto_booking') === '1', welcome: S(t, 'wa_welcome', '1') === '1' }; };

  app.get('/api/whatsapp', staffy, (req, res) => res.json(req.saProxy ? status(req) : { configured: configured(T(req)), templates: templates(T(req)) }));
  app.put('/api/whatsapp', admin, (req, res) => {
    const t = T(req), b = req.body, was = configured(t);
    if (b.phone_id !== undefined) AI.setS(t, 'wa_phone_id', L.str(b.phone_id, 40).replace(/\D/g, ''));
    if (b.waba !== undefined) AI.setS(t, 'wa_waba', L.str(b.waba, 40).replace(/\D/g, ''));
    if (b.lang !== undefined) AI.setS(t, 'wa_lang', L.str(b.lang, 10) || 'en');
    if (L.str(b.token, 600)) AI.setS(t, 'wa_token', AI.enc(L.str(b.token, 600)));
    if (L.str(b.app_secret, 100)) AI.setS(t, 'wa_app_secret', AI.enc(L.str(b.app_secret, 100)));
    if (!S(t, 'wa_verify')) AI.setS(t, 'wa_verify', L.rand(12));
    if (!was && configured(t)) db.prepare("UPDATE clients SET wa_welcomed_at='before-setup' WHERE tenant_id=? AND wa_welcomed_at IS NULL AND phone IS NOT NULL AND phone<>''").run(t);   // greet only clients added after WhatsApp is switched on
    if (b.welcome !== undefined) AI.setS(t, 'wa_welcome', b.welcome ? '1' : '0');
    if (b.auto_booking !== undefined) AI.setS(t, 'wa_auto_booking', b.auto_booking ? '1' : '0');
    if (Array.isArray(b.templates)) {
      const ok = b.templates.map((x) => ({ name: L.str(x.name, 60).replace(/[^a-z0-9_]/g, ''), label: L.str(x.label, 60), text: L.str(x.text, 900), vars: (Array.isArray(x.vars) ? x.vars : []).slice(0, 10).map((v) => L.str(v, 40)) })).filter((x) => x.name && x.text);
      AI.setS(t, 'wa_templates', JSON.stringify(ok.length ? ok : DEFAULT_TEMPLATES));
    }
    res.json(status(req));
  });

  app.get('/api/clients/:id/whatsapp', staffy, (req, res) => {
    const t = T(req), c = db.prepare('SELECT id,name,phone,wa_optout FROM clients WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!c) return res.status(404).json({ error: 'Not found.' });
    res.json({ phone: c.phone, number: normPhone(c.phone), optout: !!c.wa_optout, configured: configured(t), window_open: windowOpen(t, c.id), templates: templates(t),
      messages: db.prepare('SELECT id,direction,kind,template,body,status,error,created_at FROM wa_messages WHERE tenant_id=? AND client_id=? ORDER BY id DESC LIMIT 200').all(t, c.id).reverse() });
  });
  app.post('/api/clients/:id/whatsapp', staffy, async (req, res) => {
    try {
      const r = await sendToClient(T(req), +req.params.id, { template: req.body.template ? L.str(req.body.template, 60) : null, vars: req.body.vars, text: req.body.text }, req.user.id);
      audit(T(req), req.user.id, 'whatsapp_sent', 'client', +req.params.id, req.body.template || 'text', L.ip(req));
      res.json(r);
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not send.' }); if (!e.status) console.error(e); }
  });
  app.put('/api/clients/:id/whatsapp-consent', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const r = db.prepare('UPDATE clients SET wa_optout=? WHERE id=? AND tenant_id=?').run(req.body.optout ? 1 : 0, req.params.id, T(req));
    if (!r.changes) return res.status(404).json({ error: 'Not found.' });
    res.json({ optout: !!req.body.optout });
  });

  // ---- Meta calls these: verification (GET) and delivery receipts / replies (POST) ----
  app.get('/api/whatsapp/webhook/:tid', (req, res) => {
    const c = cfg(+req.params.tid);
    if (c.verify && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === c.verify) return res.status(200).send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(403);
  });
  app.post('/api/whatsapp/webhook/:tid', (req, res) => {
    const t = +req.params.tid, c = cfg(t);
    if (!c.app_secret) return res.sendStatus(403);
    const sig = String(req.headers['x-hub-signature-256'] || ''), want = 'sha256=' + crypto.createHmac('sha256', c.app_secret).update(req.rawBody || Buffer.from('')).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.sendStatus(403);
    try {
      for (const en of req.body.entry || []) for (const ch of en.changes || []) {
        const v = ch.value || {};
        for (const st of v.statuses || []) {
          const s = ['sent', 'delivered', 'read', 'failed'].includes(st.status) ? st.status : null; if (!s) continue;
          db.prepare('UPDATE wa_messages SET status=?, error=? WHERE tenant_id=? AND wa_id=?').run(s, s === 'failed' ? L.str((st.errors && st.errors[0] && (st.errors[0].message || st.errors[0].title)) || 'failed', 300) : null, t, st.id);
        }
        for (const m of v.messages || []) {
          const body = m.type === 'text' ? L.str(m.text && m.text.body, 3000) : `[${m.type || 'message'}]`;
          const cl = db.prepare("SELECT id FROM clients WHERE tenant_id=? AND replace(replace(replace(replace(phone,' ',''),'-',''),'+',''),'(','') LIKE ?").get(t, '%' + lastTen(m.from));
          if (db.prepare('SELECT 1 FROM wa_messages WHERE wa_id=?').get(m.id)) continue;
          db.prepare("INSERT INTO wa_messages(tenant_id,client_id,phone,direction,kind,body,wa_id,status) VALUES (?,?,?,'in','text',?,?,'received')").run(t, cl ? cl.id : null, m.from, body, m.id);
          if (cl && /^\s*(stop|unsubscribe)\s*$/i.test(body)) db.prepare('UPDATE clients SET wa_optout=1 WHERE id=?').run(cl.id);
          if (cl && /^\s*(start|subscribe)\s*$/i.test(body)) db.prepare('UPDATE clients SET wa_optout=0 WHERE id=?').run(cl.id);
        }
      }
    } catch (e) { console.error('whatsapp webhook:', e.message); }
    res.sendStatus(200);
  });
};
Object.assign(module.exports, { welcomePending, setTransport, sendToClient, normPhone, configured, templates });
