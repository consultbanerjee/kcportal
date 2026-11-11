'use strict';
// CONTROL PLANE (Super Admin only).
//  1. Service switches: one master switch per service and one switch per firm for every running-cost service.
//  2. Staff access: inside what the Super Admin allowed, a firm's own administrator chooses which of its roles may use each service.
//  3. Lock: a firm's users can never read or change the set-up of AI, mail, WhatsApp, court data, Drive or any automation.
//  4. Remote set-up: the Super Admin opens any firm's set-up screens through /api/platform/f/<firm id>/... (set-up paths only,
//     never client data).
//  5. Live weather for the start page.
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;

// id, label shown to the Super Admin, label shown to a firm, who pays, whether staff roles can be given access
const SERVICES = [
  { id: 'claude', label: 'Claude AI — master for the firm', firm: '', group: 'AI', cost: 'Anthropic tokens', roles: false, note: 'Off = every AI feature below stops, whatever else is on.' },
  { id: 'drafting', label: 'AI Drafting Desk', firm: 'AI Drafting', group: 'AI', cost: 'Anthropic tokens', roles: true, defRoles: ['advocate', 'staff'] },
  { id: 'args', label: 'Case arguments, drawbacks and judgment research (nightly)', firm: 'Case arguments and research', group: 'AI', cost: 'Anthropic tokens + web search', roles: true, defRoles: ['advocate'] },
  { id: 'email', label: 'AI e-mail assistant (reads the mailbox, drafts replies)', firm: 'AI e-mail assistant', group: 'AI', cost: 'Anthropic tokens + mailbox', roles: true, defRoles: ['advocate', 'staff'] },
  { id: 'chat', label: 'Website chat assistant', firm: 'Website chat', group: 'AI', cost: 'Anthropic tokens', roles: true, defRoles: ['advocate', 'staff', 'telecaller'] },
  { id: 'courtdata', label: 'Court data (eCourts search, tracking, orders)', firm: 'Court search and tracking', group: 'Data', cost: 'eCourtsIndia per lookup', roles: true, defRoles: ['advocate', 'staff'] },
  { id: 'whatsapp', label: 'WhatsApp messaging (Meta)', firm: 'WhatsApp messages', group: 'Messaging', cost: 'Meta conversation charges', roles: false },
  { id: 'mailout', label: 'E-mail sent by the portal (invoices, reminders, greetings)', firm: 'E-mail sending', group: 'Messaging', cost: 'Mailbox plan', roles: false },
  { id: 'reminders', label: 'Automatic payment reminders (nightly job)', firm: 'Payment reminders', group: 'Automation', cost: 'WhatsApp / e-mail', roles: false },
  { id: 'drive', label: 'Google Drive, Calendar, Meet and Contacts sync', firm: 'Google Drive', group: 'Google', cost: 'Google account storage', roles: false },
];
const SVC = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
const ROLES = [['advocate', 'Advocates'], ['staff', 'Office staff'], ['telecaller', 'Telecallers'], ['accounts', 'Accountants']];

// ---- who may use what (per firm) ----
function aclOf(t) {
  let a = {}; try { a = JSON.parse(AI.getS(t, 'svc_acl', '{}')) || {}; } catch (e) {}
  const out = {};
  for (const s of SERVICES) if (s.roles) out[s.id] = Array.isArray(a[s.id]) ? a[s.id].filter((r) => ROLES.some((x) => x[0] === r)) : s.defRoles.slice();
  return out;
}
const canUse = (user, id) => {
  if (!user || !user.tenant_id) return false;
  if (!AI.svc(user.tenant_id, id)) return false;
  if (user.role === 'admin') return true;
  const s = SVC[id]; if (!s || !s.roles) return true;
  return (aclOf(user.tenant_id)[id] || []).includes(user.role);
};

// request path -> service
const GATES = [
  [/^\/api\/ai\//, 'drafting'], [/^\/api\/mail(\/|$)/, 'email'], [/^\/api\/chats(\/|$)/, 'chat'],
  [/^\/api\/matters\/\d+\/args(\/|$)/, 'args'], [/^\/api\/ecourts\/(?!config$|test$)/, 'courtdata'], [/^\/api\/matters\/\d+\/ecourt(\/|$)/, 'courtdata'],
];
function gate(req, res, next) {
  const u = req.user;
  if (!u || !u.tenant_id || u.role === 'superadmin' || u.role === 'client' || req.saProxy) return next();
  for (const [rx, id] of GATES) {
    if (!rx.test(req.path)) continue;
    if (!AI.svc(u.tenant_id, id)) return res.status(403).json({ error: 'This service is not active for your firm. Please contact the portal provider.', off: id });
    if (!canUse(u, id)) return res.status(403).json({ error: 'You have not been given access to this. Please ask your firm\'s administrator.', off: id });
    break;
  }
  next();
}

// Set-up paths that only the Super Admin may use (a firm's users get "not found", as if they did not exist).
const LOCKED = [
  [/^\/api\/ai-admin(\/|$)/], [/^\/api\/storage(\/|$)/], [/^\/api\/ecourts\/(config|test)$/], [/^\/api\/reminders(\/|$)/],
  [/^\/api\/whatsapp$/, /^(PUT|POST|DELETE|PATCH)$/], [/^\/api\/calendar\/(settings|refresh)$/, /^(PUT|POST)$/], [/^\/api\/contacts(\/|$)/, /^(PUT|POST)$/],
  [/^\/api\/matters\/\d+\/args\/config$/], [/^\/api\/args-admin$/],
];
function lock(req, res, next) {
  const u = req.user;
  if (!u || u.role === 'superadmin' || req.saProxy) return next();
  for (const [rx, m] of LOCKED) if (rx.test(req.path) && (!m || m.test(req.method))) {
    if (req.path === '/api/storage/callback') break;
    return res.status(404).json({ error: 'Not found.' });
  }
  next();
}

// What the Super Admin may open on a firm's behalf — set-up screens only.
const PROXY_OK = /^\/(ai-admin(\/test-(mail|ai))?|storage(\/(connect|sync|disconnect))?|ecourts\/(config|test)|reminders(\/run)?|whatsapp|calendar\/(settings|refresh)|contacts(\/sync)?|args-admin|wx)$/;

// ---- weather (Open-Meteo, no key) ----
let wxTransport = null; const wxCache = new Map();
const WMO = { 0: ['Clear sky', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'], 45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌦️'], 61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'], 71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'], 95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'] };
async function getJson(url) {
  if (wxTransport) return wxTransport(url);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('weather ' + r.status); return r.json();
}
async function weather(lat, lon) {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2), hit = wxCache.get(key);
  if (hit && Date.now() - hit.at < 20 * 60000) return hit.v;
  const j = await getJson('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({ latitude: lat, longitude: lon, current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day', daily: 'temperature_2m_max,temperature_2m_min', timezone: 'Asia/Kolkata', forecast_days: '1' }));
  const c = j.current || {}, d = j.daily || {}, w = WMO[c.weather_code] || ['—', '🌡️'];
  const v = { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m), text: w[0], icon: w[1], day: c.is_day === 1, hi: d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) : null, lo: d.temperature_2m_min ? Math.round(d.temperature_2m_min[0]) : null };
  wxCache.set(key, { at: Date.now(), v }); return v;
}

module.exports = (app) => {
  const SA = L.need('superadmin');
  const firms = () => db.prepare("SELECT id,name FROM tenants WHERE kind='firm' ORDER BY id").all();

  // Super Admin acts on a firm's set-up screens
  app.use((req, res, next) => {
    const m = /^\/api\/platform\/f\/(\d+)(\/[^?]*)$/.exec(req.path); if (!m) return next();
    SA(req, res, (err) => {
      if (err) return next(err);
      const f = db.prepare("SELECT id,name FROM tenants WHERE id=? AND kind='firm'").get(parseInt(m[1], 10));
      if (!f) return res.status(404).json({ error: 'Not found.' });
      const rest = m[2]; if (!PROXY_OK.test(rest)) return res.status(404).json({ error: 'Not found.' });
      if (rest === '/wx') return next();
      const uid = req.user.id; req.saProxy = true; req.saFirm = f; req.user = { ...req.user, tenant_id: f.id, role: 'admin' };
      if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) { try { audit(f.id, uid, 'sa_config', 'firm', f.id, req.method + ' ' + rest, L.ip(req)); } catch (e) {} } });
      const q = req.url.indexOf('?'); req.url = '/api' + rest + (q >= 0 ? req.url.slice(q) : ''); next();
    });
  });

  app.use(lock);
  app.use(gate);

  // ---- services matrix (Super Admin) ----
  app.get('/api/platform/services', SA, (req, res) => {
    const fl = firms();
    res.json({ firms: fl, services: SERVICES.map((s) => ({ id: s.id, label: s.label, group: s.group, cost: s.cost, note: s.note || '', master: AI.svcMaster(s.id), firms: Object.fromEntries(fl.map((f) => [f.id, AI.svcFirm(f.id, s.id)])) })) });
  });
  app.put('/api/platform/services', SA, (req, res) => {
    const b = req.body || {}, s = SVC[b.id]; if (!s) return res.status(400).json({ error: 'Unknown service.' });
    const v = !!b.on;
    if (b.firm_id === null || b.firm_id === undefined || b.firm_id === '') AI.setSvcMaster(s.id, v);
    else { const f = db.prepare("SELECT id FROM tenants WHERE id=? AND kind='firm'").get(parseInt(b.firm_id, 10)); if (!f) return res.status(404).json({ error: 'Not found.' }); AI.setSvcFirm(f.id, s.id, v); }
    audit(null, req.user.id, 'service_switch', 'service', null, `${s.id} ${b.firm_id || 'ALL'} ${v ? 'on' : 'off'}`, L.ip(req));
    res.json({ ok: true });
  });
  // firm-wide switch for several services at once ("switch this firm off")
  app.put('/api/platform/firms/:id/services', SA, (req, res) => {
    const f = db.prepare("SELECT id FROM tenants WHERE id=? AND kind='firm'").get(req.params.id); if (!f) return res.status(404).json({ error: 'Not found.' });
    const m = (req.body || {}).services || {}; for (const [id, v] of Object.entries(m)) if (SVC[id]) AI.setSvcFirm(f.id, id, !!v);
    audit(f.id, req.user.id, 'service_switch', 'firm', f.id, Object.keys(m).join(','), L.ip(req)); res.json({ ok: true });
  });

  // ---- what the signed-in user may use (drives the menu) ----
  app.get('/api/features', L.requireLogin, (req, res) => {
    const u = req.user; if (!u.tenant_id || u.role === 'client' || u.role === 'superadmin') return res.json({});
    const out = {}; for (const id of ['drafting', 'email', 'chat', 'args', 'courtdata']) out[id] = canUse(u, id);
    out.whatsapp = AI.svc(u.tenant_id, 'whatsapp'); out.drive = AI.svc(u.tenant_id, 'drive');
    res.json(out);
  });

  // ---- a firm's administrator: who in the firm may use which service ----
  app.get('/api/access', L.need('admin'), (req, res) => {
    const t = req.user.tenant_id, acl = aclOf(t);
    res.json({ roles: ROLES, services: SERVICES.filter((s) => s.roles).map((s) => ({ id: s.id, label: s.firm, active: AI.svc(t, s.id), roles: acl[s.id] })),
      other: SERVICES.filter((s) => !s.roles && s.firm).map((s) => ({ label: s.firm, active: AI.svc(t, s.id) })) });
  });
  app.put('/api/access', L.need('admin'), (req, res) => {
    const t = req.user.tenant_id, b = (req.body || {}).acl || {}, cur = aclOf(t);
    for (const s of SERVICES) if (s.roles && Array.isArray(b[s.id])) cur[s.id] = b[s.id].filter((r) => ROLES.some((x) => x[0] === r));
    AI.setS(t, 'svc_acl', JSON.stringify(cur));
    audit(t, req.user.id, 'access_changed', 'firm', t, null, L.ip(req)); res.json({ ok: true });
  });

  // ---- case-argument automation, set by the Super Admin per firm ----
  app.get('/api/args-admin', L.need('admin'), (req, res) => { const t = req.user.tenant_id, g = (k, d) => AI.getS(t, k, d);
    res.json({ auto: g('args_auto', '1') === '1', research: g('args_research', '1') === '1', cap: g('args_daily_cap', '8'), model: g('ai_args_model', '') }); });
  app.put('/api/args-admin', L.need('admin'), (req, res) => { const t = req.user.tenant_id, b = req.body || {};
    if (b.auto !== undefined) AI.setS(t, 'args_auto', b.auto ? '1' : '0'); if (b.research !== undefined) AI.setS(t, 'args_research', b.research ? '1' : '0');
    if (b.cap !== undefined) { const n = L.int(b.cap); if (!(n >= 1 && n <= 40)) return res.status(400).json({ error: 'Daily limit must be 1–40.' }); AI.setS(t, 'args_daily_cap', String(n)); }
    if (b.model !== undefined) AI.setS(t, 'ai_args_model', L.str(b.model, 60)); res.json({ ok: true }); });

  // ---- weather ----
  const place = (t) => ({ city: AI.getS(t, 'wx_city', 'Kolkata'), lat: parseFloat(AI.getS(t, 'wx_lat', '22.5726')), lon: parseFloat(AI.getS(t, 'wx_lon', '88.3639')) });
  app.get('/api/weather', L.requireLogin, async (req, res) => {
    const p = place(req.user.tenant_id || 0);
    try { res.json({ city: p.city, ...(await weather(p.lat, p.lon)) }); } catch (e) { res.json({ city: p.city, unavailable: true }); }
  });
  app.get('/api/platform/f/:fid/wx', SA, (req, res) => res.json(place(parseInt(req.params.fid, 10))));
  app.put('/api/platform/f/:fid/wx', SA, async (req, res) => {
    const t = parseInt(req.params.fid, 10), name = L.str((req.body || {}).city, 80);
    if (!db.prepare("SELECT 1 FROM tenants WHERE id=? AND kind='firm'").get(t)) return res.status(404).json({ error: 'Not found.' });
    if (!name) return res.status(400).json({ error: 'Enter a city.' });
    try {
      const j = await getJson('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name, count: '1', language: 'en', countryCode: 'IN' }));
      const r = j.results && j.results[0]; if (!r) return res.status(404).json({ error: 'City not found. Try the nearest big city.' });
      AI.setS(t, 'wx_city', r.name); AI.setS(t, 'wx_lat', String(r.latitude)); AI.setS(t, 'wx_lon', String(r.longitude)); res.json({ city: r.name, lat: r.latitude, lon: r.longitude });
    } catch (e) { res.status(502).json({ error: 'Could not look up the city right now.' }); }
  });
};
Object.assign(module.exports, { SERVICES, ROLES, canUse, aclOf, setWeatherTransport: (f) => { wxTransport = f; wxCache.clear(); } });
