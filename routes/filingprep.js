'use strict';
// v5.4: Prepare for filing. Joins the chosen PDFs in order into one filing set with a contents page, bookmarks and page numbers, then makes sure it
// fits the forum's size limit: it tries Ghostscript (when installed on the server) to shrink scanned pages, and otherwise splits the set into parts.
// Nothing is kept on disk; results wait in memory for 20 minutes. Same for every firm.
const crypto = require('crypto'); const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const multer = require('multer'); const { PDFDocument, StandardFonts, rgb, PDFName, PDFHexString } = require('pdf-lib');
const L = require('../lib');
const MB = 1048576, MAXF = 60, MAXEACH = 120 * MB;
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAXEACH, files: MAXF } });
const STORE = new Map();           // token -> { tenant, user, parts:[{name,buf}], at }
const TTL = 20 * 60 * 1000, CAPBYTES = 400 * MB;
const sweep = () => { const now = Date.now(); for (const [k, v] of STORE) if (now - v.at > TTL) STORE.delete(k); let tot = 0; for (const v of STORE.values()) tot += v.parts.reduce((n, p) => n + p.buf.length, 0); if (tot > CAPBYTES) { const old = [...STORE.entries()].sort((a, b) => a[1].at - b[1].at); for (const [k] of old) { STORE.delete(k); tot = 0; for (const v of STORE.values()) tot += v.parts.reduce((n, p) => n + p.buf.length, 0); if (tot <= CAPBYTES) break; } } };
const iv = setInterval(sweep, 60000); iv.unref && iv.unref();
const safe = (s) => String(s || '').replace(/[^\x20-\x7E]/g, '?').slice(0, 90);          // the standard font only draws basic Latin
const baseName = (n) => String(n || 'document').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'document';
const fileSafe = (s) => String(s || 'filing').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'filing';

let GS = null;                                   // Ghostscript is optional; the Dockerfile installs it
const hasGs = () => { if (GS !== null) return GS; try { const r = require('child_process').spawnSync('gs', ['--version'], { timeout: 5000 }); GS = r.status === 0; } catch (e) { GS = false; } return GS; };
function shrink(buf, preset) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcfp-')), inp = path.join(dir, 'in.pdf'), out = path.join(dir, 'out.pdf'); fs.writeFileSync(inp, buf);
    const done = (v) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } resolve(v); };
    const p = spawn('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/' + preset, '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-sOutputFile=' + out, inp], { stdio: 'ignore' });
    const to = setTimeout(() => { p.kill('SIGKILL'); }, 240000);
    p.on('error', () => { clearTimeout(to); done(null); });
    p.on('close', (c) => { clearTimeout(to); let r = null; if (c === 0) { try { r = fs.readFileSync(out); } catch (e) { r = null; } } done(r); });
  });
}
async function contentsPages(out, font, title, parts, startPage, total) {
  const PER = 36, n = Math.max(1, Math.ceil(parts.length / PER)), pages = [];
  for (let i = 0; i < n; i++) {
    const pg = out.insertPage(i, [595.28, 841.89]); pages.push(pg);
    pg.drawText(i === 0 ? safe(title) : safe(title) + ' (contents, continued)', { x: 56, y: 790, size: 14, font });
    if (i === 0) pg.drawText('INDEX', { x: 56, y: 764, size: 11, font });
    let y = i === 0 ? 738 : 764;
    parts.slice(i * PER, (i + 1) * PER).forEach((p, j) => {
      const no = i * PER + j + 1, from = p.start + n + 1, to = from + p.count - 1;
      pg.drawText(`${no}.  ${safe(p.title)}`.slice(0, 82), { x: 56, y, size: 10, font });
      pg.drawText(p.count > 1 ? `${from} - ${to}` : String(from), { x: 480, y, size: 10, font }); y -= 19;
    });
  }
  return n;
}
function addBookmarks(out, parts, shift) {
  const ctx = out.context, pages = out.getPages(), root = ctx.nextRef(), refs = parts.map(() => ctx.nextRef());
  parts.forEach((p, i) => {
    const dict = ctx.obj({ Title: PDFHexString.fromText(p.title), Parent: root, Dest: [pages[p.start + shift].ref, PDFName.of('Fit')] });
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]); if (i < parts.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], dict);
  });
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: parts.length }));
  out.catalog.set(PDFName.of('Outlines'), root); out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
// cut a set of pages (0-based indexes) out of a built document into its own PDF
async function slice(doc, from, to) { const d = await PDFDocument.create(); const pg = await d.copyPages(doc, Array.from({ length: to - from }, (_, i) => from + i)); pg.forEach((x) => d.addPage(x)); return Buffer.from(await d.save({ useObjectStreams: true })); }
async function splitToLimit(buf, limit, weights) {
  const doc = await PDFDocument.load(buf), n = doc.getPageCount(), total = weights.reduce((a, b) => a + b, 0) || n, out = []; let from = 0;
  while (from < n) {
    let w = 0, to = from; while (to < n && (w + weights[to]) <= limit * 0.9 && to - from < 2000) { w += weights[to]; to++; } if (to === from) to = from + 1;
    let part = await slice(doc, from, to);
    while (part.length > limit && to - from > 1) { to = from + Math.max(1, Math.floor((to - from) / 2)); part = await slice(doc, from, to); }
    out.push({ buf: part, from, to }); from = to;
  }
  return { parts: out, over: out.filter((p) => p.buf.length > limit).length, total };
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;
  const gate = L.need('admin', 'advocate', 'staff');
  const forumOf = (req, id) => {
    id = String(id || ''); if (!id) return null;
    const c = require('./efiling').catalog().find((f) => f.id === id); if (c) return { name: c.name, mb: c.max_file_mb || 0, scope: c.limit_scope || 'set', pdfa: /PDF\/A/i.test(c.format || ''), signing: c.signing || '' };
    const m = /^f(\d+)$/.exec(id); if (m) { const r = L.db.prepare('SELECT name,max_file_mb,signing FROM firm_forums WHERE id=? AND tenant_id=?').get(Number(m[1]), T(req)); if (r) return { name: r.name, mb: r.max_file_mb || 0, scope: 'set', pdfa: false, signing: r.signing || '' }; }
    return null;
  };
  app.post('/api/filing-prep', gate, (req, res, next) => up.array('files', MAXF)(req, res, (e) => (e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'One of the files is over 120 MB. Compress it first.' : 'Upload failed: ' + e.message }) : next())), async (req, res) => {
    try {
      const files = (req.files || []).filter((f) => /\.pdf$/i.test(f.originalname) || f.mimetype === 'application/pdf');
      if (!L.must(res, files.length, 'Choose at least one PDF.')) return;
      const forum = forumOf(req, req.body.forum), title = L.str(req.body.title, 80).trim() || 'Filing set', limit = forum && forum.mb ? forum.mb * MB : 0;
      let names = []; try { names = JSON.parse(req.body.titles || '[]'); } catch (e) { names = []; }
      const notes = [];
      // forums that judge each document on its own (e.g. DRT): report every file against the limit and stop
      if (forum && forum.scope === 'document' && limit) {
        const rows = files.map((f) => ({ name: f.originalname, mb: +(f.size / MB).toFixed(2), ok: f.size <= limit }));
        return res.json({ mode: 'each', forum: forum.name, limit_mb: forum.mb, rows, notes: ['This forum checks each document against its limit, so the files are not joined. Shrink any file marked over the limit.'] });
      }
      const out = await PDFDocument.create(), font = await out.embedFont(StandardFonts.Helvetica), parts = [];
      for (let i = 0; i < files.length; i++) {
        let src; try { src = await PDFDocument.load(files[i].buffer); } catch (e) { return res.status(400).json({ error: `"${files[i].originalname}" could not be read as a PDF (it may be damaged or password-protected).` }); }
        const pgs = await out.copyPages(src, src.getPageIndices()); const start = out.getPageCount(); pgs.forEach((p) => out.addPage(p));
        parts.push({ title: L.str(names[i], 120).trim() || baseName(files[i].originalname), start, count: pgs.length, bytes: files[i].size });
      }
      const withIndex = req.body.index !== '0', withNumbers = req.body.numbers !== '0';
      let shift = 0; if (withIndex) shift = await contentsPages(out, font, title, parts, 0, 0);
      if (withNumbers) out.getPages().forEach((pg, i) => { const { width } = pg.getSize(); const t = `Page ${i + 1}`, w = font.widthOfTextAtSize(t, 10); pg.drawText(t, { x: (width - w) / 2, y: 22, size: 10, font, color: rgb(0.1, 0.1, 0.1) }); });
      addBookmarks(out, parts, shift); out.setTitle(safe(title)); out.setProducer('Filing set'); out.setCreator('');
      let buf = Buffer.from(await out.save({ useObjectStreams: true })); const pageCount = out.getPageCount(), original = buf.length; let result = [{ name: fileSafe(title) + '.pdf', buf }];
      if (limit && buf.length > limit) {
        if (hasGs()) { for (const preset of ['ebook', 'screen']) { const s = await shrink(buf, preset); if (s && s.length < buf.length) { buf = s; notes.push(`Compressed with the "${preset}" setting (bookmarks are lost in compression).`); } if (buf.length <= limit) break; } result = [{ name: fileSafe(title) + '.pdf', buf }]; }
        else notes.push('Scanned pages could not be re-compressed on this server (Ghostscript is not installed), so the set is split instead.');
      }
      if (limit && buf.length > limit) {
        const weights = []; parts.forEach((p) => { for (let k = 0; k < p.count; k++) weights.push(p.bytes / Math.max(1, p.count)); }); const pre = withIndex ? shift : 0; const w = Array(pre).fill(8000).concat(weights);
        const sp = await splitToLimit(buf, limit, w.length === pageCount ? w : Array(pageCount).fill(buf.length / pageCount));
        result = sp.parts.map((p, i) => ({ name: `${fileSafe(title)}_part${i + 1}of${sp.parts.length}.pdf`, buf: p.buf, from: p.from + 1, to: p.to }));
        notes.push(`The set is ${(original / MB).toFixed(1)} MB, over the ${forum.mb} MB limit, so it is split into ${result.length} parts. Page numbers run through all parts.`);
        if (sp.over) notes.push(`${sp.over} part(s) are still over the limit because a single page is larger than it. Re-scan that page at a lower resolution.`);
      }
      if (forum && forum.pdfa) notes.push('This forum asks for PDF/A signed with a digital signature. This set is a normal PDF; convert it to PDF/A and sign it before uploading.');
      else if (forum && forum.signing) notes.push('Signing: ' + forum.signing + '. Sign the final file yourself before uploading.');
      const token = crypto.randomBytes(16).toString('hex'); STORE.set(token, { tenant: T(req), user: req.user.id, parts: result.map((r) => ({ name: r.name, buf: r.buf })), at: Date.now() }); sweep();
      L.audit && L.audit(T(req), req.user.id, 'filing_prep', 'filing', 0, `${files.length} files -> ${result.length} part(s)`, L.ip(req));
      res.json({ mode: 'set', token, forum: forum ? forum.name : '', limit_mb: forum ? forum.mb : 0, pages: pageCount, gs: hasGs(), parts: result.map((r, i) => ({ n: i, name: r.name, mb: +(r.buf.length / MB).toFixed(2), ok: !limit || r.buf.length <= limit, from: r.from || 1, to: r.to || pageCount })), contents: parts.map((p, i) => ({ no: i + 1, title: p.title, from: p.start + shift + 1, pages: p.count })), notes });
    } catch (e) { console.error('filing-prep', e.message); res.status(500).json({ error: 'Could not prepare the set: ' + e.message }); }
  });
  app.get('/api/filing-prep/:token/:n', gate, (req, res) => {
    const s = STORE.get(String(req.params.token)); if (!s || s.tenant !== T(req) || s.user !== req.user.id) return res.status(404).json({ error: 'This download has expired. Prepare the set again.' });
    const p = s.parts[L.int(req.params.n)]; if (!p) return res.status(404).json({ error: 'Not found.' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${p.name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.send(p.buf);
  });
};
