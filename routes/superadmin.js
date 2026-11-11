'use strict';
// Super Admin layer: plans and module switches per firm, Claude on/off, token and cost meter, subscription invoices,
// dues handling, and the onboarding checklist each firm's Admin sees.
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

// Modules a firm can be given. Switching one off hides it from the menu and closes its API.
const MODULES = [
  ['accounts', 'Accounts and reports'], ['crm', 'CRM (leads, tickets, calls)'], ['calendar', 'Calendar and birthdays'],
  ['repository', 'Repository (court and library links)'], ['judgments', 'Judgments'], ['ai', 'AI drafting, email and chat (Claude)'],
];
const PLANS = {
  starter: { label: 'Starter', off: ['ai', 'crm'] },
  standard: { label: 'Standard', off: ['ai'] },
  premium: { label: 'Premium (everything)', off: [] },
};
const GATES = [
  [/^\/(invoices|payments|cash|bank|reports|ledger|payees|payee-payments|recurring|expenses|books)(\/|$)/, 'accounts'],
  [/^\/(leads|tickets|appointments|consult-types)(\/|$)/, 'crm'],
  [/^\/calendar(\/|$)/, 'calendar'],
  [/^\/repository(\/|$)/, 'repository'],
  [/^\/(followups)(\/|$)/, 'crm'],
  [/^\/judgments(\/|$)/, 'judgments'],
];
const todayStr = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const offList = (tid) => AI.getS(tid, 'sa_off', '').split(',').filter(Boolean);
const monthOf = (d) => d.slice(0, 7);
const RATE = () => ({
  rin: parseFloat(AI.getS(0, 'sa_rate_in', '3')) || 0, rout: parseFloat(AI.getS(0, 'sa_rate_out', '15')) || 0, fx: parseFloat(AI.getS(0, 'sa_usd_inr', '88')) || 0,
});
// usage cost in paise for one firm and one month (YYYY-MM); markup is the firm's own percentage
function usageOf(tid, month) {
  const r = db.prepare("SELECT COUNT(*) calls, COALESCE(SUM(in_tok),0) i, COALESCE(SUM(out_tok),0) o FROM ai_usage WHERE tenant_id=? AND substr(created_at,1,7)=?").get(tid, month);
  const R = RATE(), mk = parseFloat(AI.getS(tid, 'sa_markup', '0')) || 0;
  const usd = (r.i / 1e6) * R.rin + (r.o / 1e6) * R.rout;
  const raw = Math.round(usd * R.fx * 100);
  return { calls: r.calls, in_tok: r.i, out_tok: r.o, usd: +usd.toFixed(4), cost_paise: raw, bill_paise: Math.round(raw * (1 + mk / 100)), markup: mk };
}
const prevMonth = (d) => { const [y, m] = d.slice(0, 7).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

function generate(period, byUser) {
  const out = [];
  for (const f of db.prepare("SELECT id,name FROM tenants WHERE kind='firm' AND active=1").all()) {
    if (db.prepare("SELECT 1 FROM sub_invoices WHERE tenant_id=? AND kind='monthly' AND period=?").get(f.id, period)) continue;
    const fee = L.int(AI.getS(f.id, 'sa_fee', '0')) || 0;
    const ai = AI.getS(f.id, 'sa_ai_bill', '1') === '1' ? usageOf(f.id, period).bill_paise : 0;
    if (fee + ai <= 0) continue;
    const grace = L.int(AI.getS(f.id, 'sa_net', '10')) || 10;
    const due = new Date(Date.now() + 19800000 + grace * 86400000).toISOString().slice(0, 10);
    const id = db.prepare("INSERT INTO sub_invoices(tenant_id,kind,period,plan_paise,ai_paise,total_paise,note,due_date) VALUES (?,?,?,?,?,?,?,?)").run(f.id, 'monthly', period, fee, ai, fee + ai, 'Portal subscription and AI usage for ' + period, due).lastInsertRowid;
    out.push({ id, firm: f.name, total_paise: fee + ai });
  }
  audit(null, byUser || null, 'sub_generated', 'platform', 0, period + ' x' + out.length, '');
  return out;
}
// dues: firms with an invoice overdue beyond their grace days are disabled when auto-suspend is on (never an exempt firm)
function enforceDues() {
  const sus = [];
  for (const f of db.prepare("SELECT id,name FROM tenants WHERE kind='firm' AND active=1").all()) {
    if (AI.getS(f.id, 'sa_exempt', '0') === '1' || AI.getS(f.id, 'sa_autosuspend', '0') !== '1') continue;
    const g = L.int(AI.getS(f.id, 'sa_grace', '15')) || 15, lim = new Date(Date.now() + 19800000 - g * 86400000).toISOString().slice(0, 10);
    if (db.prepare("SELECT 1 FROM sub_invoices WHERE tenant_id=? AND status='due' AND due_date<?").get(f.id, lim)) {
      db.prepare('UPDATE tenants SET active=0 WHERE id=?').run(f.id);
      db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=?)').run(f.id);
      audit(null, null, 'firm_suspended_dues', 'tenant', f.id, f.name, ''); sus.push(f.name);
    }
  }
  return sus;
}

module.exports = (app) => {
  const SA = L.need('superadmin');
  const T = (req) => req.user.tenant_id;

  // ---- module gate (runs before every route below it) ----
  app.use('/api', (req, res, next) => {
    if (!req.user || !req.user.tenant_id || req.user.role === 'superadmin') return next();
    for (const [re, mod] of GATES) if (re.test(req.path)) {
      if (offList(req.user.tenant_id).includes(mod)) return res.status(403).json({ error: 'This part is not included in your plan. Please contact the portal provider.' });
      break;
    }
    next();
  });
  app.get('/api/modules', L.requireLogin, (req, res) => {
    const t = req.user.tenant_id, off = req.user.role === 'superadmin' ? [] : offList(t);
    const powered = AI.getS(t, 'sa_powered', '');
    res.json({ off, claude: AI.allowed(t), powered, product: AI.getS(0, 'sa_product', '') });
  });

  // ---- firms: plan, modules, Claude switch ----
  app.get('/api/platform/overview', SA, (req, res) => {
    const month = monthOf(todayStr()), R = RATE();
    const firms = db.prepare("SELECT id,name,slug,active FROM tenants WHERE kind='firm' ORDER BY id").all().map((f) => {
      const u = usageOf(f.id, month), g = (k, d) => AI.getS(f.id, k, d);
      const due = db.prepare("SELECT COALESCE(SUM(total_paise),0) v, COUNT(*) n FROM sub_invoices WHERE tenant_id=? AND status='due'").get(f.id);
      return { ...f, plan: g('sa_plan', 'premium'), fee_paise: L.int(g('sa_fee', '0')) || 0, off: offList(f.id), claude: AI.svcFirm(f.id, 'claude'), ecourts: AI.svcFirm(f.id, 'courtdata'), markup: u.markup, ai_bill: g('sa_ai_bill', '1') === '1',
        autosuspend: g('sa_autosuspend', '0') === '1', exempt: g('sa_exempt', '0') === '1', grace: L.int(g('sa_grace', '15')) || 15, net: L.int(g('sa_net', '10')) || 10, powered: g('sa_powered', ''), usage: u, due_paise: due.v, due_n: due.n,
        drive: !!AI.dec(g('drive_refresh', '')),
        users: db.prepare("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role<>'client' AND active=1").get(f.id).n };
    });
    res.json({ month, firms, modules: MODULES, plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.label])),
      claude_all: AI.getS(0, 'sa_claude_all', '1') === '1', ecourts_all: AI.getS(0, 'sa_ecourts_all', '1') === '1', ecourts_key_set: !!AI.secret(0, 'platform_ecourts_key'), rates: { in: R.rin, out: R.rout, fx: R.fx }, key_set: !!AI.secret(0, 'platform_key'), key_env: !!process.env.ANTHROPIC_API_KEY,
      product: AI.getS(0, 'sa_product', ''), auto_bill: AI.getS(0, 'sa_auto', '0') === '1' });
  });
  app.put('/api/platform/firms/:id/plan', SA, (req, res) => {
    const f = db.prepare("SELECT * FROM tenants WHERE id=? AND kind='firm'").get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Not found.' });
    const b = req.body || {}, S = (k, v) => AI.setS(f.id, k, v);
    if (b.plan && PLANS[b.plan]) { S('sa_plan', b.plan); if (b.apply_preset) S('sa_off', PLANS[b.plan].off.join(',')); }
    if (Array.isArray(b.off)) S('sa_off', b.off.filter((m) => MODULES.some((x) => x[0] === m)).join(','));
    if (b.fee !== undefined) { const n = Math.round(Number(b.fee) * 100); if (!(n >= 0 && n < 1e10)) return res.status(400).json({ error: 'Enter a valid monthly fee.' }); S('sa_fee', String(n)); }
    if (b.claude !== undefined) S('sa_claude', b.claude ? '1' : '0');
    if (b.ecourts !== undefined) S('sa_ecourts', b.ecourts ? '1' : '0');
    if (b.markup !== undefined) { const n = Number(b.markup); if (!(n >= 0 && n <= 1000)) return res.status(400).json({ error: 'Markup must be between 0 and 1000 percent.' }); S('sa_markup', String(n)); }
    for (const [k, key] of [['ai_bill', 'sa_ai_bill'], ['autosuspend', 'sa_autosuspend'], ['exempt', 'sa_exempt']]) if (b[k] !== undefined) S(key, b[k] ? '1' : '0');
    for (const [k, key, lo, hi] of [['grace', 'sa_grace', 1, 120], ['net', 'sa_net', 1, 90]]) if (b[k] !== undefined) { const n = L.int(b[k]); if (!(n >= lo && n <= hi)) return res.status(400).json({ error: `${k} days must be ${lo}–${hi}.` }); S(key, String(n)); }
    if (b.powered !== undefined) S('sa_powered', L.str(b.powered, 120));
    audit(null, req.user.id, 'firm_plan_changed', 'tenant', f.id, Object.keys(b).join(','), L.ip(req));
    res.json({ ok: true });
  });
  app.put('/api/platform/settings', SA, (req, res) => {
    const b = req.body || {};
    if (b.claude_all !== undefined) AI.setS(0, 'sa_claude_all', b.claude_all ? '1' : '0');
    if (b.ecourts_all !== undefined) AI.setS(0, 'sa_ecourts_all', b.ecourts_all ? '1' : '0');
    if (typeof b.ecourts_key === 'string' && b.ecourts_key !== '') AI.setSecret(0, 'platform_ecourts_key', b.ecourts_key === '__clear__' ? '' : L.str(b.ecourts_key, 200));
    for (const [k, key] of [['rate_in', 'sa_rate_in'], ['rate_out', 'sa_rate_out'], ['usd_inr', 'sa_usd_inr']]) if (b[k] !== undefined) { const n = Number(b[k]); if (!(n >= 0 && n < 100000)) return res.status(400).json({ error: 'Enter valid rates.' }); AI.setS(0, key, String(n)); }
    if (typeof b.platform_key === 'string' && b.platform_key !== '') AI.setSecret(0, 'platform_key', b.platform_key === '__clear__' ? '' : L.str(b.platform_key, 300));
    if (b.product !== undefined) AI.setS(0, 'sa_product', L.str(b.product, 80));
    if (b.auto_bill !== undefined) AI.setS(0, 'sa_auto', b.auto_bill ? '1' : '0');
    audit(null, req.user.id, 'platform_settings', 'platform', 0, Object.keys(b).join(','), L.ip(req));
    res.json({ ok: true });
  });

  // ---- token and cost meter ----
  app.get('/api/platform/usage', SA, (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : monthOf(todayStr());
    const firms = db.prepare("SELECT id,name FROM tenants WHERE kind='firm' ORDER BY id").all().map((f) => ({
      id: f.id, name: f.name, ...usageOf(f.id, month),
      by_feature: db.prepare("SELECT feature, COUNT(*) calls, SUM(in_tok) in_tok, SUM(out_tok) out_tok FROM ai_usage WHERE tenant_id=? AND substr(created_at,1,7)=? GROUP BY feature ORDER BY 2 DESC").all(f.id, month) }));
    const months = db.prepare('SELECT DISTINCT substr(created_at,1,7) m FROM ai_usage ORDER BY 1 DESC LIMIT 18').all().map((x) => x.m);
    res.json({ month, months, firms, rates: RATE(), total_cost_paise: firms.reduce((s, f) => s + f.cost_paise, 0), total_bill_paise: firms.reduce((s, f) => s + f.bill_paise, 0) });
  });

  // ---- subscription invoices ----
  app.get('/api/platform/billing', SA, (req, res) => {
    const today = todayStr();
    res.json(db.prepare('SELECT s.*, t.name firm FROM sub_invoices s JOIN tenants t ON t.id=s.tenant_id ORDER BY s.id DESC LIMIT 300').all()
      .map((r) => ({ ...r, overdue: r.status === 'due' && r.due_date && r.due_date < today })));
  });
  app.post('/api/platform/billing/generate', SA, (req, res) => {
    const period = /^\d{4}-\d{2}$/.test(req.body.period || '') ? req.body.period : prevMonth(todayStr());
    res.json({ period, created: generate(period, req.user.id) });
  });
  app.post('/api/platform/billing', SA, (req, res) => {
    const f = db.prepare("SELECT id FROM tenants WHERE id=? AND kind='firm'").get(L.int(req.body.tenant_id)), amt = L.paise(req.body.amount), note = L.str(req.body.note, 300);
    if (!L.must(res, f && amt > 0 && note, 'Choose a firm and enter an amount and a note.')) return;
    const id = db.prepare("INSERT INTO sub_invoices(tenant_id,kind,period,other_paise,total_paise,note,due_date) VALUES (?,?,?,?,?,?,?)").run(f.id, 'manual', todayStr(), amt, amt, note, L.isDate(req.body.due_date) ? req.body.due_date : todayStr()).lastInsertRowid;
    res.json({ id });
  });
  app.post('/api/platform/billing/:id/paid', SA, (req, res) => {
    const r = db.prepare("UPDATE sub_invoices SET status='paid', paid_on=?, paid_ref=? WHERE id=? AND status='due'").run(L.isDate(req.body.paid_on) ? req.body.paid_on : todayStr(), L.str(req.body.ref, 80), req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Not found or already settled.' });
    res.json({ ok: true });
  });
  app.post('/api/platform/billing/:id/cancel', SA, (req, res) => {
    const r = db.prepare("UPDATE sub_invoices SET status='cancelled' WHERE id=? AND status='due'").run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Not found or already settled.' });
    res.json({ ok: true });
  });
  app.post('/api/platform/enforce', SA, (req, res) => res.json({ suspended: enforceDues() }));

  // ---- what a firm's Admin sees about its own plan (never other firms) ----
  app.get('/api/my-plan', L.need('admin'), (req, res) => {
    const t = T(req), month = monthOf(todayStr()), g = (k, d) => AI.getS(t, k, d), u = usageOf(t, month);
    res.json({ plan: PLANS[g('sa_plan', 'premium')] ? PLANS[g('sa_plan', 'premium')].label : 'Custom', fee_paise: L.int(g('sa_fee', '0')) || 0, off: offList(t), claude: AI.allowed(t), month,
      usage: { calls: u.calls, in_tok: u.in_tok, out_tok: u.out_tok, bill_paise: g('sa_ai_bill', '1') === '1' ? u.bill_paise : 0 }, modules: MODULES,
      invoices: db.prepare('SELECT id,period,kind,total_paise,note,status,due_date,paid_on FROM sub_invoices WHERE tenant_id=? ORDER BY id DESC LIMIT 24').all(t) });
  });

  // ---- onboarding checklist for a firm's Admin ----
  app.get('/api/onboarding', L.need('admin'), (req, res) => {
    const t = T(req), c = (sql, ...a) => db.prepare(sql).get(t, ...a).n;
    let s = {}; try { s = JSON.parse((db.prepare('SELECT settings FROM tenant_templates WHERE tenant_id=?').get(t) || {}).settings || '{}'); } catch (e) {}
    const tpl = require('./template').tplInfo ? require('./template').tplInfo(t) : {};
    const steps = [
      ['Firm name, address, phone and email', !!(s.address && s.phone && s.email), '#/template'],
      ['Logo and letterhead', !!(tpl.has_logo || tpl.has_letterhead), '#/template'],
      ['Bank details and PAN for invoices', !!(s.payment_details || s.pan), '#/template'],
      ['Add your team', c("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role NOT IN ('admin','client')") > 0, '#/team'],
      ['Add your first client', c('SELECT COUNT(*) n FROM clients WHERE tenant_id=?') > 0, '#/clients'],
      ['Open your first case', c('SELECT COUNT(*) n FROM matters WHERE tenant_id=?') > 0, '#/matters'],
      ['Raise your first invoice', c('SELECT COUNT(*) n FROM invoices WHERE tenant_id=?') > 0, '#/accounts'],
    ];
    res.json({ steps: steps.map(([label, done, href]) => ({ label, done, href })), done: steps.filter((x) => x[1]).length, total: steps.length });
  });
};

let timer;
module.exports.startWorker = () => {
  const run = () => {
    try {
      const d = new Date(Date.now() + 19800000), day = d.getUTCDate(), hr = d.getUTCHours();
      if (AI.getS(0, 'sa_auto', '0') === '1' && day <= 3 && hr >= 9) generate(prevMonth(d.toISOString().slice(0, 10)), null);
      if (hr >= 9 && hr < 20) enforceDues();
    } catch (e) { console.error('superadmin worker', e.message); }
  };
  timer = setInterval(run, 30 * 60 * 1000); timer.unref && timer.unref();
};
Object.assign(module.exports, { generate, enforceDues, usageOf, MODULES, PLANS });
