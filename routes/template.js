'use strict';
// Per-firm document design: letterhead image (or text header), colours, margins, titles, signatory, payment details.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const L = require('../lib');
const { db, audit } = L;
const { DATA_DIR } = require('../db');

const KC = {
  header_name: 'KC LEGAL', tagline: 'Advocates, Solicitors, Consultants', address: 'Olisa House, 10th Floor, 4, Government Place, Kolkata 700001, WB.',
  phone: '+91 98311 90819', email: 'info@kclegal.us', website: 'www.kclegal.us', signatory_name: 'Krishnika Chatterjee', signatory_title: 'Advocate', top_mm: 58, bottom_mm: 14, primary: '#14388c', accent: '#ffad33',
};
const KC_TERMS = ['Payment shall be paid in favour of KC LEGAL through account payee cheque or demand draft or online bank transfer only.',
  'Payment shall be made within the due date, failing which a simple interest of 6% will be levied up to one month, and thereafter the firm reserve right to initiate appropriate legal action to recover the dues.',
  'All disputes are subject to Kolkata jurisdiction only. Regarding financial disputes, all the correspondence shall be marked to kclegal.us@gmail.com only.',
  'In case of non-payment, the service may be discontinued without any further notice.',
  'GST not applicable on the bill of advocates/law firms vide notification no.12/2017 Central Tax.',
  'TDS of not more than 10% can be deducted under section 194J of the Income Tax Act, 1961. TDS Certificate shall be furnished upon deduction if any.',
  'Transaction within Special Economic Zone area does not attract any Tax liabilities.'].join('\n');
const base = (name) => ({
  header_name: name, tagline: '', address: '', phone: '', email: '', website: '',
  primary: '#14388c', accent: '#ffad33', title_color: '#d0021b', font: 'sans', page_size: 'a4', top_mm: 50, bottom_mm: 11, left_mm: 20, right_mm: 20,
  invoice_title: 'INVOICE', receipt_title: 'RECEIPT', signatory_name: '', signatory_title: '', payment_details: '',
  invoice_footer: 'Kindly quote the invoice number when making payment.', pan: '', qr_caption: 'Scan to pay', inv_hide_footer: /KC LEGAL/i.test(name || '') ? '1' : '',
  pay1_title: 'Bank Details', pay1_text: '', pay2_title: 'PAN', pay2_text: '', pay3_title: '', pay3_text: '', pay4_title: '', pay4_text: '', invoice_terms: /KC LEGAL/i.test(name || '') ? KC_TERMS : '',
});
const STR = { header_name: 80, tagline: 120, address: 240, phone: 60, email: 120, website: 120, invoice_title: 30, receipt_title: 30, signatory_name: 80, signatory_title: 80, payment_details: 600, invoice_footer: 300, pan: 40, qr_caption: 40, pay1_title: 40, pay2_title: 40, pay3_title: 40, pay4_title: 40, pay1_text: 400, pay2_text: 400, pay3_text: 400, pay4_text: 400, invoice_terms: 1800 };
const NUM = { top_mm: [0, 120], bottom_mm: [0, 80], left_mm: [5, 60], right_mm: [5, 60] };
const COL = ['primary', 'accent', 'title_color'];

const assetFile = (tid, kind) => { try { return fs.readdirSync(dir(tid)).find((f) => f.startsWith(kind + '.')) || null; } catch (e) { return null; } };
const sigFile = (tid) => assetFile(tid, 'signature');
const dir = (tid) => path.resolve(DATA_DIR, 'templates', String(tid));
function read(tid) {
  const r = db.prepare('SELECT * FROM tenant_templates WHERE tenant_id=?').get(tid);
  const t = db.prepare('SELECT name FROM tenants WHERE id=?').get(tid);
  let s = {}; try { s = JSON.parse((r && r.settings) || '{}'); } catch (e) {}
  return { settings: { ...base(t ? t.name : ''), ...s }, letterhead: r && r.letterhead && fs.existsSync(path.join(dir(tid), r.letterhead)) ? r.letterhead : null };
}
function ensureTemplate(firm, isKC) {
  if (db.prepare('SELECT 1 FROM tenant_templates WHERE tenant_id=?').get(firm.id)) return;
  let lh = null; const s = isKC ? { ...KC } : { header_name: firm.name };
  const A = path.join(__dirname, '..', 'assets');
  if (isKC && fs.existsSync(path.join(A, 'kc-letterhead.jpg'))) {
    fs.mkdirSync(dir(firm.id), { recursive: true });
    fs.copyFileSync(path.join(A, 'kc-letterhead.jpg'), path.join(dir(firm.id), 'letterhead.jpg')); lh = 'letterhead.jpg';
    for (const [f, to] of [['kc-logo.png', 'logo.png'], ['kc-signature.png', 'signature.png']]) if (fs.existsSync(path.join(A, f))) fs.copyFileSync(path.join(A, f), path.join(dir(firm.id), to));
  }
  db.prepare('INSERT INTO tenant_templates(tenant_id,settings,letterhead) VALUES (?,?,?)').run(firm.id, JSON.stringify(s), lh);
}
function clean(body, cur) {
  const out = { ...cur };
  for (const [k, max] of Object.entries(STR)) if (body[k] !== undefined) out[k] = L.str(body[k], max);
  for (const k of COL) if (body[k] !== undefined && /^#[0-9a-fA-F]{6}$/.test(body[k])) out[k] = body[k].toLowerCase();
  for (const [k, [lo, hi]] of Object.entries(NUM)) if (body[k] !== undefined) { const n = Number(body[k]); if (Number.isFinite(n)) out[k] = Math.max(lo, Math.min(hi, Math.round(n))); }
  if (body.inv_hide_footer !== undefined) out.inv_hide_footer = body.inv_hide_footer && body.inv_hide_footer !== '0' ? '1' : '';
  if (['sans', 'serif'].includes(body.font)) out.font = body.font;
  if (['a4', 'legal', 'letter'].includes(body.page_size)) out.page_size = body.page_size;
  if (!out.invoice_title) out.invoice_title = 'INVOICE';
  if (!out.receipt_title) out.receipt_title = 'RECEIPT';
  return out;
}

function tplInfo(tid) {
  const r = read(tid), sg = sigFile(tid), lg = assetFile(tid, 'logo'), qr = assetFile(tid, 'qr'), m = (f) => fs.statSync(path.join(dir(tid), f)).mtimeMs;
  return { settings: r.settings, has_letterhead: !!r.letterhead, v: r.letterhead ? m(r.letterhead) : 0, has_signature: !!sg, sv: sg ? m(sg) : 0, has_logo: !!lg, lv: lg ? m(lg) : 0, has_qr: !!qr, qv: qr ? m(qr) : 0 };
}
function publicAsset(tid, kind) {
  const f = kind === 'letterhead' ? read(tid).letterhead : ['logo', 'signature', 'qr'].includes(kind) ? assetFile(tid, kind) : null;
  return f && fs.existsSync(path.join(dir(tid), f)) ? path.join(dir(tid), f) : null;
}
module.exports = (app) => {
  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
  const T = (req) => req.user.tenant_id;

  app.get('/api/template', L.requireLogin, (req, res) => {
    const r = read(T(req));
    res.json(tplInfo(T(req)));
  });
  app.put('/api/template', L.need('admin'), (req, res) => {
    const cur = read(T(req)).settings;
    const next = clean(req.body || {}, cur);
    db.prepare('INSERT INTO tenant_templates(tenant_id,settings) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET settings=excluded.settings, updated_at=CURRENT_TIMESTAMP').run(T(req), JSON.stringify(next));
    audit(T(req), req.user.id, 'template_saved', 'template', T(req), null, L.ip(req));
    res.json({ settings: next });
  });
  app.post('/api/template/letterhead', L.need('admin'), up.single('file'), (req, res) => {
    const b = req.file && req.file.buffer;
    const ext = b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b && b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG' ? 'png' : null;
    if (!L.must(res, ext, 'Please upload a JPG or PNG picture of your letter pad (full A4 page, up to 4 MB).')) return;
    fs.mkdirSync(dir(T(req)), { recursive: true });
    for (const f of fs.readdirSync(dir(T(req)))) if (f.startsWith('letterhead')) fs.unlinkSync(path.join(dir(T(req)), f));
    const name = 'letterhead.' + ext; fs.writeFileSync(path.join(dir(T(req)), name), b, { mode: 0o600 });
    db.prepare('INSERT INTO tenant_templates(tenant_id,letterhead) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET letterhead=excluded.letterhead, updated_at=CURRENT_TIMESTAMP').run(T(req), name);
    audit(T(req), req.user.id, 'letterhead_uploaded', 'template', T(req), name, L.ip(req));
    res.json({ ok: true });
  });
  app.delete('/api/template/letterhead', L.need('admin'), (req, res) => {
    const r = read(T(req));
    if (r.letterhead) { try { fs.unlinkSync(path.join(dir(T(req)), r.letterhead)); } catch (e) {} }
    db.prepare('UPDATE tenant_templates SET letterhead=NULL WHERE tenant_id=?').run(T(req));
    res.json({ ok: true });
  });
  app.post('/api/template/signature', L.need('admin'), up.single('file'), (req, res) => {
    const b = req.file && req.file.buffer;
    if (!L.must(res, b && b.length <= 1024 * 1024, 'Signature picture must be under 1 MB.')) return;
    const ext = b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b && b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG' ? 'png' : null;
    if (!L.must(res, ext, 'Please upload a JPG or PNG picture of the signature (a transparent PNG looks best).')) return;
    fs.mkdirSync(dir(T(req)), { recursive: true });
    for (const f of fs.readdirSync(dir(T(req)))) if (f.startsWith('signature.')) fs.unlinkSync(path.join(dir(T(req)), f));
    fs.writeFileSync(path.join(dir(T(req)), 'signature.' + ext), b, { mode: 0o600 });
    audit(T(req), req.user.id, 'signature_uploaded', 'template', T(req), null, L.ip(req));
    res.json({ ok: true });
  });
  app.delete('/api/template/signature', L.need('admin'), (req, res) => {
    const f = sigFile(T(req)); if (f) { try { fs.unlinkSync(path.join(dir(T(req)), f)); } catch (e) {} }
    res.json({ ok: true });
  });
  app.get('/api/template/signature', L.requireLogin, (req, res) => {
    const f = sigFile(T(req)); if (!f) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(path.join(dir(T(req)), f));
  });
  app.post('/api/template/logo', L.need('admin'), up.single('file'), (req, res) => {
    const b = req.file && req.file.buffer;
    if (!L.must(res, b && b.length <= 1024 * 1024, 'Logo picture must be under 1 MB.')) return;
    const ext = b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b && b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG' ? 'png' : null;
    if (!L.must(res, ext, 'Please upload a JPG or PNG picture of the logo (a transparent PNG looks best).')) return;
    fs.mkdirSync(dir(T(req)), { recursive: true });
    for (const f of fs.readdirSync(dir(T(req)))) if (f.startsWith('logo.')) fs.unlinkSync(path.join(dir(T(req)), f));
    fs.writeFileSync(path.join(dir(T(req)), 'logo.' + ext), b, { mode: 0o600 });
    audit(T(req), req.user.id, 'logo_uploaded', 'template', T(req), null, L.ip(req));
    res.json({ ok: true });
  });
  app.delete('/api/template/logo', L.need('admin'), (req, res) => {
    const f = assetFile(T(req), 'logo'); if (f) { try { fs.unlinkSync(path.join(dir(T(req)), f)); } catch (e) {} }
    res.json({ ok: true });
  });
  app.get('/api/template/logo', L.requireLogin, (req, res) => {
    const f = assetFile(T(req), 'logo'); if (!f) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(path.join(dir(T(req)), f));
  });
  app.post('/api/template/qr', L.need('admin'), up.single('file'), (req, res) => {
    const b = req.file && req.file.buffer;
    if (!L.must(res, b && b.length <= 2 * 1024 * 1024, 'QR picture must be under 2 MB.')) return;
    const ext = b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : b && b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG' ? 'png' : null;
    if (!L.must(res, ext, 'Please upload a JPG or PNG picture of your payment QR code (UPI / bank).')) return;
    fs.mkdirSync(dir(T(req)), { recursive: true });
    for (const f of fs.readdirSync(dir(T(req)))) if (f.startsWith('qr.')) fs.unlinkSync(path.join(dir(T(req)), f));
    fs.writeFileSync(path.join(dir(T(req)), 'qr.' + ext), b, { mode: 0o600 });
    audit(T(req), req.user.id, 'qr_uploaded', 'template', T(req), null, L.ip(req));
    res.json({ ok: true });
  });
  app.delete('/api/template/qr', L.need('admin'), (req, res) => {
    const f = assetFile(T(req), 'qr'); if (f) { try { fs.unlinkSync(path.join(dir(T(req)), f)); } catch (e) {} }
    res.json({ ok: true });
  });
  app.get('/api/template/qr', L.requireLogin, (req, res) => {
    const f = assetFile(T(req), 'qr'); if (!f) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(path.join(dir(T(req)), f));
  });
  app.get('/api/template/letterhead', L.requireLogin, (req, res) => {
    const r = read(T(req));
    if (!r.letterhead) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(path.join(dir(T(req)), r.letterhead));
  });
};
module.exports.ensureTemplate = ensureTemplate;

module.exports.tplInfo = tplInfo;
module.exports.publicAsset = publicAsset;
