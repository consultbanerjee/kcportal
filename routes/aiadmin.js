'use strict';
// Admin control panel for the AI features (switches, API key, mailbox, chat options, usage).
const L = require('../lib');
const AI = require('../aicore');
const mail = require('./aimail');
const { db, audit } = L;

const TOG = ['drafting', 'email', 'chat'];
const TXT = { ai_model: 60, ai_drafting_rules: 6000, mail_imap_host: 120, mail_imap_user: 200, mail_smtp_host: 120, mail_smtp_user: 200, mail_from_name: 100, mail_signature: 800,
  chat_greeting: 400, chat_origins: 600, chat_firm_info: 4000 };
const NUMS = { mail_imap_port: [1, 65535], mail_smtp_port: [1, 65535], mail_poll_min: [2, 120], mail_auto_delay_min: [1, 1440], chat_daily_cap: [10, 5000] };
const SECRETS = ['ai_key', 'mail_imap_pass', 'mail_smtp_pass'];

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  app.get('/api/features', L.requireLogin, (req, res) => {
    if (!req.user.tenant_id || req.user.role === 'client' || req.user.role === 'superadmin') return res.json({});
    res.json(Object.fromEntries(TOG.map((f) => [f, AI.on(req.user.tenant_id, f)])));
  });
  app.get('/api/ai-admin', L.need('admin'), (req, res) => {
    const t = T(req), g = (k, d = '') => AI.getS(t, k, d);
    const usage = db.prepare("SELECT feature, COUNT(*) calls, COALESCE(SUM(in_tok),0) in_tok, COALESCE(SUM(out_tok),0) out_tok FROM ai_usage WHERE tenant_id=? AND created_at>=date('now','start of month') GROUP BY feature").all(t);
    const slug = (db.prepare('SELECT slug FROM tenants WHERE id=?').get(t) || {}).slug;
    res.json({
      on: Object.fromEntries(TOG.map((f) => [f, AI.on(t, f)])),
      key_set: !!AI.secret(t, 'ai_key'), key_env: !!process.env.ANTHROPIC_API_KEY, key_hint: AI.secret(t, 'ai_key') ? '…' + AI.secret(t, 'ai_key').slice(-4) : '',
      text: Object.fromEntries(Object.keys(TXT).map((k) => [k, g(k)])), num: { mail_imap_port: g('mail_imap_port', '993'), mail_smtp_port: g('mail_smtp_port', '465'), mail_poll_min: g('mail_poll_min', '5'), mail_auto_delay_min: g('mail_auto_delay_min', '30'), chat_daily_cap: g('chat_daily_cap', '400') },
      mail_mode: g('mail_mode', 'review'), mail_ai_disclose: g('mail_ai_disclose', '1') === '1',
      secrets: { mail_imap_pass: !!AI.secret(t, 'mail_imap_pass'), mail_smtp_pass: !!AI.secret(t, 'mail_smtp_pass') },
      mail_last_poll: g('mail_last_poll'), mail_last_error: g('mail_last_error'), usage, model_default: AI.model(t), slug,
      embed: `<script src="${process.env.PUBLIC_URL || 'https://portal.kclegal.us'}/chat.js?firm=${slug}" defer></script>`,
    });
  });
  app.put('/api/ai-admin', L.need('admin'), (req, res) => {
    const t = T(req), b = req.body || {};
    for (const f of TOG) if (b.on && b.on[f] !== undefined) AI.setS(t, 'ai_' + f, b.on[f] ? '1' : '0');
    for (const [k, max] of Object.entries(TXT)) if (b.text && b.text[k] !== undefined) AI.setS(t, k, L.str(b.text[k], max));
    for (const [k, [lo, hi]] of Object.entries(NUMS)) if (b.num && b.num[k] !== undefined) { const n = L.int(b.num[k]); if (n == null || n < lo || n > hi) return res.status(400).json({ error: `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}.` }); AI.setS(t, k, String(n)); }
    if (b.mail_mode !== undefined) AI.setS(t, 'mail_mode', b.mail_mode === 'auto' ? 'auto' : 'review');
    if (b.mail_ai_disclose !== undefined) AI.setS(t, 'mail_ai_disclose', b.mail_ai_disclose ? '1' : '0');
    for (const k of SECRETS) if (b.secrets && typeof b.secrets[k] === 'string' && b.secrets[k] !== '') AI.setSecret(t, k, b.secrets[k] === '__clear__' ? '' : L.str(b.secrets[k], 300));
    if (b.on && b.on.email && AI.getS(t, 'mail_last_uid') === '' ) { /* first poll fetches the last 3 days */ }
    audit(t, req.user.id, 'ai_settings_changed', 'firm', t, Object.keys(b).join(','), L.ip(req));
    res.json({ ok: true });
  });
  app.post('/api/ai-admin/test-mail', L.need('admin'), async (req, res) => {
    try { res.json(await mail.verify(T(req))); } catch (e) { res.status(502).json({ error: 'Test failed.' }); }
  });
  app.post('/api/ai-admin/test-ai', L.need('admin'), async (req, res) => {
    try { const r = await AI.call(T(req), 'test', { system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], max_tokens: 10 }); res.json({ ok: /ok/i.test(AI.textOf(r)) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
};
