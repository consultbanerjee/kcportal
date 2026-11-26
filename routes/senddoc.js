'use strict';
// "Send" for every Word / PDF download in the portal: e-mail it as an attachment, or send a WhatsApp message with a private
// download link (valid 14 days). The file is produced by the same download address the person already uses, called with their
// own login, so each section's own access rules apply and nothing new is exposed. Only listed download addresses are allowed.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const L = require('../lib'); const WA = require('./whatsapp'); const { db, audit } = L; const { DATA_DIR } = require('../db');
db.exec("CREATE TABLE IF NOT EXISTS file_shares (token TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT, mime TEXT, path TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')))");
const ALLOWED = [/^\/api\/matters\/\d+\/history\/(docx|pdf)$/, /^\/api\/matters\/\d+\/ecourt\/record\/(docx|pdf)$/, /^\/api\/letters\/\d+\/download\/(docx|pdf)$/, /^\/api\/accounts\/report\?[\w=&.\-]+$/, /^\/api\/ai\/draft[\w\/\-.?=&]*$/, /^\/api\/invoices\/\d+\/(pdf|docx)$/, /^\/api\/payments\/\d+\/receipt(\.pdf|\/pdf)?$/];
const base = () => (process.env.PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');
const dir = path.join(DATA_DIR, 'shares'); fs.mkdirSync(dir, { recursive: true });
const clean = () => { for (const r of db.prepare("SELECT token,path FROM file_shares WHERE expires_at<=datetime('now')").all()) { try { fs.unlinkSync(r.path); } catch (e) {} db.prepare('DELETE FROM file_shares WHERE token=?').run(r.token); } };
setInterval(clean, 6 * 3600 * 1000).unref();

module.exports = (app) => {
  app.post('/api/send/doc', L.office, async (req, res) => {
    const t = req.user.tenant_id, b = req.body || {}, p = String(b.path || ''), ch = b.channel, note = L.str(b.message, 800);
    if (!ALLOWED.some((re) => re.test(p))) return res.status(400).json({ error: 'This item cannot be sent from here.' });
    let r; try { r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}${p}`, { headers: { cookie: req.headers.cookie || '' }, redirect: 'manual' }); } catch (e) { return res.status(502).json({ error: 'Could not prepare the file.' }); }
    if (!r.ok) return res.status(r.status === 403 || r.status === 404 ? r.status : 500).json({ error: 'Could not prepare the file.' });
    const buf = Buffer.from(await r.arrayBuffer()), mime = r.headers.get('content-type') || 'application/octet-stream', cd = r.headers.get('content-disposition') || '';
    let name = 'Document'; const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd); if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; } }
    const firm = (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || '';
    try {
      if (ch === 'email') {
        const M = require('./aimail'), to = String(b.to || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid e-mail address.' });
        if (!M.mailReady(t)) return res.status(409).json({ error: 'E-mail sending is not set up for your firm.' });
        await M.sendMail(t, { to, subject: `${name.replace(/\.(pdf|docx)$/i, '')} — ${firm}`, text: `${note ? note + '\n\n' : ''}Please find the attached document.\n\n${firm}`, attachments: [{ filename: name, content: buf }] });
        audit(t, req.user.id, 'doc_emailed', 'doc', 0, name.slice(0, 80) + ' to ' + to, L.ip(req)); return res.json({ ok: true });
      }
      if (ch === 'whatsapp') {
        const to = WA.normPhone(b.to); if (!to) return res.status(400).json({ error: 'Enter a valid mobile number.' });
        const tok = crypto.randomBytes(18).toString('hex'), fp = path.join(dir, tok); fs.writeFileSync(fp, buf);
        db.prepare("INSERT INTO file_shares(token,tenant_id,name,mime,path,expires_at) VALUES (?,?,?,?,?,datetime('now','+14 days'))").run(tok, t, name, mime, fp);
        const text = `${note ? note + '\n' : ''}${name.replace(/\.(pdf|docx)$/i, '')} — ${firm}\nDownload (valid for 14 days): ${base()}/api/public/file/${tok}`;
        audit(t, req.user.id, 'doc_whatsapp', 'doc', 0, name.slice(0, 80) + ' to ' + to, L.ip(req)); return res.json({ ok: true, wa_link: `https://wa.me/${to}?text=${encodeURIComponent(text)}` });
      }
      res.status(400).json({ error: 'Choose e-mail or WhatsApp.' });
    } catch (e) { res.status(500).json({ error: String(e.message || 'Could not send.').slice(0, 200) }); }
  });
  app.get('/api/public/file/:tok', (req, res) => {
    const s = /^[0-9a-f]{36}$/.test(req.params.tok) && db.prepare("SELECT * FROM file_shares WHERE token=? AND expires_at>datetime('now')").get(req.params.tok);
    if (!s || !fs.existsSync(s.path)) return res.status(404).json({ error: 'This link has expired or is not valid.' });
    res.set({ 'Content-Type': s.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.name)}` }); res.send(fs.readFileSync(s.path));
  });
};
