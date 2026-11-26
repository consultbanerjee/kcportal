'use strict';
// Super Admin "Server and renewals": renewal reminders, how the server is running, and storage use of the server and Google Drive.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const L = require('../lib');
const AI = require('../aicore');
const { db } = L;

db.exec(`CREATE TABLE IF NOT EXISTS server_stats (t TEXT PRIMARY KEY, load1 REAL, mem_pct REAL, disk_pct REAL, rss_mb REAL, data_mb REAL)`);
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const run = (cmd, args, ms = 20000) => new Promise((r) => execFile(cmd, args, { timeout: ms, maxBuffer: 4e6 }, (e, out) => r(e ? '' : String(out))));

async function disk() {
  const o = (await run('df', ['-kP', DATA])).trim().split('\n')[1]; if (!o) return null;
  const c = o.split(/\s+/), total = +c[1] * 1024, used = +c[2] * 1024, free = +c[3] * 1024;
  return { total, used, free, pct: Math.round((used / total) * 1000) / 10 };
}
let duCache = { at: 0, rows: [] };
async function dataSizes() {
  if (Date.now() - duCache.at < 10 * 60e3) return duCache.rows;
  const rows = [];
  try {
    for (const n of fs.readdirSync(DATA)) {
      const o = (await run('du', ['-sk', path.join(DATA, n)], 60000)).split(/\s+/)[0];
      rows.push({ name: n, mb: Math.round((+o || 0) / 1024) });
    }
  } catch (e) {}
  rows.sort((a, b) => b.mb - a.mb); duCache = { at: Date.now(), rows }; return rows;
}
async function driveQuota() {
  let D; try { D = require('./drive'); } catch (e) { return { error: 'Drive module not loaded' }; }
  for (const f of db.prepare("SELECT id FROM tenants WHERE kind='firm' AND active=1 ORDER BY id").all()) {
    try {
      if (!D.connected(f.id)) continue;
      const j = await D.call(f.id, 'GET', 'https://www.googleapis.com/drive/v3/about?fields=storageQuota,user(emailAddress)');
      const q = j.storageQuota || {}; return { email: j.user && j.user.emailAddress, limit: +q.limit || 0, usage: +q.usage || 0, inDrive: +q.usageInDrive || 0, trash: +q.usageInDriveTrash || 0 };
    } catch (e) { return { error: String(e.message).slice(0, 160) }; }
  }
  return { error: 'Google Drive is not connected for any firm.' };
}

async function sample() {
  try {
    const d = await disk(), mem = (os.totalmem() - os.freemem()) / os.totalmem() * 100;
    db.prepare('INSERT OR REPLACE INTO server_stats(t,load1,mem_pct,disk_pct,rss_mb,data_mb) VALUES (?,?,?,?,?,?)').run(new Date().toISOString().slice(0, 16), os.loadavg()[0], Math.round(mem * 10) / 10, d ? d.pct : null, Math.round(process.memoryUsage().rss / 1048576), duCache.rows.reduce((a, r) => a + r.mb, 0));
    db.prepare("DELETE FROM server_stats WHERE t < ?").run(new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 16));
  } catch (e) {}
}
const SEED = [
  { name: 'Server (Hostinger KVM 2 VPS)', due: '2026-12-08', note: 'Auto-renewal is on; keep the card valid', url: 'https://hpanel.hostinger.com' },
  { name: 'Domain kclegal.us', due: '', note: 'Set the expiry date from the registrar', url: '' },
  { name: 'Domain kclegal.in', due: '', note: 'Set the expiry date from the registrar', url: '' },
  { name: 'Anthropic (Claude plan and API credits)', due: '', note: 'Monthly plan renewal; keep API credits topped up', url: 'https://console.anthropic.com' },
  { name: 'Google Drive storage (Google One)', due: '', note: 'Storage plan renewal', url: 'https://one.google.com' },
  { name: 'Website hosting (kclegal.us WordPress)', due: '', note: 'Hosting renewal', url: '' },
  { name: 'WhatsApp / Meta and SMS balances', due: '', note: 'Check message credits', url: '' },
];
const renewals = () => {
  let r = null; try { r = JSON.parse(AI.getS(0, 'renewals', 'null')); } catch (e) {}
  if (!Array.isArray(r)) { r = SEED.map((x, i) => ({ id: i + 1, ...x })); AI.setS(0, 'renewals', JSON.stringify(r)); }
  return r;
};
const daysTo = (d) => (d ? Math.ceil((new Date(d + 'T00:00:00+05:30') - Date.now()) / 86400e3) : null);

function startWorker() { const t = setInterval(sample, 10 * 60e3), f = setTimeout(async () => { await dataSizes(); sample(); }, 60e3); t.unref && t.unref(); f.unref && f.unref(); }

module.exports = (app) => {
  const SA = L.need('superadmin');
  app.get('/api/platform/server', SA, async (req, res) => {
    const [d, du, drive] = await Promise.all([disk(), dataSizes(), driveQuota()]);
    const hist = db.prepare('SELECT t,load1,mem_pct,disk_pct FROM server_stats WHERE t>=? ORDER BY t').all(new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 16));
    let dbMb = 0; try { dbMb = Math.round(fs.statSync(path.join(DATA, 'portal.db')).size / 1048576); } catch (e) {}
    res.json({
      now: { load: os.loadavg(), cpus: os.cpus().length, mem_total: os.totalmem(), mem_free: os.freemem(), uptime: os.uptime(), proc_up: process.uptime(), rss_mb: Math.round(process.memoryUsage().rss / 1048576), node: process.version, disk: d, db_mb: dbMb },
      data: du, drive, history: hist, renewals: renewals().map((r) => ({ ...r, days: daysTo(r.due) })),
    });
  });
  app.get('/api/platform/renewals/soon', SA, (req, res) => res.json(renewals().map((r) => ({ ...r, days: daysTo(r.due) })).filter((r) => r.days !== null && r.days <= 30).sort((a, b) => a.days - b.days)));
  app.put('/api/platform/renewals', SA, (req, res) => {
    const arr = (Array.isArray(req.body.renewals) ? req.body.renewals : []).slice(0, 60).map((r, i) => ({ id: i + 1, name: L.str(r.name, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(r.due || '') ? r.due : '', note: L.str(r.note, 200), url: /^https:\/\//.test(r.url || '') ? L.str(r.url, 300) : '' })).filter((r) => r.name);
    AI.setS(0, 'renewals', JSON.stringify(arr)); res.json({ ok: true });
  });
};
Object.assign(module.exports, { startWorker, sample });
