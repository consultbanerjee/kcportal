'use strict';
// Turns the AI's marked-up draft into a Word file and a PDF, and builds annexure PDFs stamped and numbered.
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { PAGES } = require('./drafthouse');

const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
const FONTS = { 'Times New Roman': 'LiberationSerif-', 'Bookman Old Style': 'texgyrebonum-' };
const fontPath = (family, st) => {
  const base = FONTS[family] || FONTS['Times New Roman'], bonum = base.startsWith('texgy');
  const n = bonum ? { r: 'regular', b: 'bold', i: 'italic', bi: 'bolditalic' }[st] : { r: 'Regular', b: 'Bold', i: 'Italic', bi: 'BoldItalic' }[st];
  return path.join(FONT_DIR, base + n + '.ttf');
};
const IN = 72;
const geo = (fmt) => { const pg = PAGES[fmt.page] || PAGES.A4, m = fmt.m; return { w: pg.w, h: pg.h, top: m.top * IN, bottom: m.bottom * IN, left: m.left * IN, right: m.right * IN }; };

// ---- parse markup into sections of blocks ----
function parse(text) {
  const sections = [{ num: true, restart: true, blocks: [] }];
  let cur = sections[0], para = [], tbl = null;
  const flushP = () => { if (para.length) { cur.blocks.push({ t: 'p', text: para.join(' ').replace(/\s+/g, ' ').trim(), align: 'j', indent: true }); para = []; } };
  const flushT = () => { if (tbl) { cur.blocks.push({ t: 'tbl', rows: tbl }); tbl = null; } };
  const sect = (num) => { flushP(); flushT(); if (cur.blocks.length || sections.length > 1 || cur.num !== num) { cur = { num, restart: num, blocks: [] }; sections.push(cur); } else { cur.num = num; cur.restart = num; } };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { flushP(); flushT(); continue; }
    if (/^@NONUM\s*$/.test(line)) { sect(false); continue; }
    if (/^@NUM\s*$/.test(line)) { sect(true); continue; }
    if (/^@PB\s*$/.test(line)) { flushP(); flushT(); cur.blocks.push({ t: 'pb' }); continue; }
    if ((m = line.match(/^@(TH|T)\s+(.*)$/))) { flushP(); (tbl = tbl || []).push({ head: m[1] === 'TH', cells: m[2].split('|').map((s) => s.trim()) }); continue; }
    flushT();
    if ((m = line.match(/^@(CB|C|R|B|L|I)\s?(.*)$/))) {
      flushP();
      const k = m[1], t = m[2];
      cur.blocks.push({ t: 'p', text: t, align: k === 'C' || k === 'CB' ? 'c' : k === 'R' ? 'r' : k === 'I' ? 'j' : 'l', bold: k === 'CB' || k === 'B', indent: false, tight: k === 'L' || k === 'C' || k === 'CB' || k === 'R' || k === 'B' });
      continue;
    }
    para.push(line.trim());
  }
  flushP(); flushT();
  return sections.filter((s) => s.blocks.length || sections.length === 1);
}
const clean = (s) => String(s || '').replace(/[\u2028\u2029]/g, ' ').replace(/\t/g, '    ');

// ---- PDF ----
async function toPdf(text, fmt, opts = {}) {
  const g = geo(fmt), doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const F = {}; for (const s of ['r', 'b', 'i']) F[s] = await doc.embedFont(fs.readFileSync(fontPath(fmt.font, s)), { subset: fontPath(fmt.font, s).endsWith('.ttf') });
  const size = fmt.size, lh = size * 1.15 * (fmt.spacing || 1), tw = g.w - g.left - g.right;
  const width = (t, f) => f.widthOfTextAtSize(clean(t), size);
  let letterhead = null;
  if (opts.letterhead && fs.existsSync(opts.letterhead.path)) { const b = fs.readFileSync(opts.letterhead.path); letterhead = /\.png$/i.test(opts.letterhead.path) ? await doc.embedPng(b) : await doc.embedJpg(b); }
  const sections = parse(text);
  let page, y, pageNo = 0, secNum = true, secOffset = 0, numbered = 0, first = true, lastNumber = 0;
  const newPage = () => {
    page = doc.addPage([g.w, g.h]); pageNo++;
    if (letterhead && first) page.drawImage(letterhead, { x: 0, y: 0, width: g.w, height: g.h });
    y = g.h - (letterhead && first ? (opts.letterhead.topMm || 50) / 25.4 * IN : g.top); first = false;
    if (secNum) { const n = pageNo - secOffset; lastNumber = n; const t = 'Page ' + n; page.drawText(t, { x: (g.w - width(t, F.r)) / 2, y: g.bottom / 2 - size / 3, size, font: F.r }); }
  };
  const need = (h) => { if (y - h < g.bottom) newPage(); };
  const wrap = (t, f, maxW) => { const words = clean(t).split(' '), out = []; let l = ''; for (const w of words) { const c = l ? l + ' ' + w : w; if (width(c, f) <= maxW || !l) l = c; else { out.push(l); l = w; } } if (l) out.push(l); return out; };
  const drawLine = (t, f, x0, maxW, align, justify) => {
    let x = x0; const w = width(t, f);
    if (align === 'c') x = x0 + (maxW - w) / 2; else if (align === 'r') x = x0 + maxW - w;
    if (justify && t.includes(' ')) { const words = t.split(' '), sp = (maxW - words.reduce((a, b) => a + width(b, f), 0)) / (words.length - 1); let cx = x; for (const wd of words) { page.drawText(clean(wd), { x: cx, y, size, font: f }); cx += width(wd, f) + sp; } }
    else page.drawText(clean(t), { x, y, size, font: f });
  };
  secNum = sections[0].num; newPage();
  let firstSec = true;
  for (const s of sections) {
    if (!firstSec) { secNum = s.num; if (s.restart && s.num) secOffset = pageNo; newPage(); }
    else { firstSec = false; if (s.num) secOffset = 0; }
    for (const b of s.blocks) {
      if (b.t === 'pb') { newPage(); continue; }
      if (b.t === 'p') {
        const f = b.bold ? F.b : F.r, ind = b.indent ? 0.5 * IN : 0, lines = wrap(b.text, f, tw - ind);
        const gap = b.tight ? lh * 0.15 : lh * 0.35;
        for (let i = 0; i < lines.length; i++) {
          need(lh); y -= lh;
          const last = i === lines.length - 1;
          drawLine(lines[i], f, g.left + (i === 0 ? ind : 0), tw - (i === 0 ? ind : 0), b.align, b.align === 'j' && !last);
        }
        y -= gap; continue;
      }
      if (b.t === 'tbl') {
        const nc = Math.max(...b.rows.map((r) => r.cells.length)), wts = Array(nc).fill(0);
        b.rows.forEach((r) => r.cells.forEach((c, i) => { wts[i] = Math.max(wts[i], Math.min(Math.max(String(c).length, 6), 60)); }));
        const sum = wts.reduce((a, c) => a + c, 0), cw = wts.map((x) => Math.max(36, (x / sum) * tw)), scale = tw / cw.reduce((a, c) => a + c, 0), cws = cw.map((x) => x * scale), pad = 4, tsz = size, tlh = tsz * 1.15 * Math.min(fmt.spacing || 1, 1.15);
        for (const r of b.rows) {
          const f = r.head ? F.b : F.r, cells = cws.map((w, i) => wrap(r.cells[i] || '', f, w - 2 * pad)), h = Math.max(...cells.map((c) => c.length)) * tlh + 2 * pad;
          need(Math.min(h, g.h - g.top - g.bottom)); const top = y; let x = g.left;
          cws.forEach((w, i) => { page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
            cells[i].forEach((ln, k) => page.drawText(clean(ln), { x: x + pad, y: top - pad - tsz - k * tlh + 2, size: tsz, font: f })); x += w; });
          y = top - h;
        }
        y -= lh * 0.4;
      }
    }
  }
  const bytes = await doc.save();
  return { bytes: Buffer.from(bytes), pages: pageNo, lastNumber };
}

// ---- Word ----
async function toDocx(text, fmt, opts = {}) {
  const D = require('docx');
  const A = { l: D.AlignmentType.LEFT, c: D.AlignmentType.CENTER, r: D.AlignmentType.RIGHT, j: D.AlignmentType.JUSTIFIED };
  const pg = PAGES[fmt.page] || PAGES.A4, tw = (x) => Math.round(x * 1440), half = fmt.size * 2, line = Math.round(240 * (fmt.spacing || 1));
  const run = (t, bold) => new D.TextRun({ text: t, bold: !!bold, font: fmt.font, size: half });
  const sections = parse(text);
  const out = sections.map((s) => {
    const kids = [];
    for (const b of s.blocks) {
      if (b.t === 'pb') { kids.push(new D.Paragraph({ children: [new D.PageBreak()] })); continue; }
      if (b.t === 'p') kids.push(new D.Paragraph({ alignment: A[b.align], spacing: { line, after: b.tight ? 40 : 120 }, indent: b.indent ? { firstLine: 720 } : undefined, children: [run(b.text, b.bold)] }));
      else {
        const nc = Math.max(...b.rows.map((r) => r.cells.length));
        kids.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: b.rows.map((r) => new D.TableRow({ tableHeader: r.head, children: Array.from({ length: nc }, (_, i) => new D.TableCell({ children: [new D.Paragraph({ spacing: { line: 276 }, children: [run(r.cells[i] || '', r.head)] })] })) })) }));
        kids.push(new D.Paragraph({ children: [] }));
      }
    }
    const footer = s.num ? new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: 'Page ', font: fmt.font, size: half }), new D.TextRun({ children: [D.PageNumber.CURRENT], font: fmt.font, size: half })] })] }) : new D.Footer({ children: [new D.Paragraph({})] });
    return { properties: { page: { size: { width: tw(pg.w / 72), height: tw(pg.h / 72) }, margin: { top: tw(fmt.m.top), bottom: tw(fmt.m.bottom), left: tw(fmt.m.left), right: tw(fmt.m.right) }, pageNumbers: s.num && s.restart ? { start: 1 } : undefined } }, footers: { default: footer }, children: kids };
  });
  const doc = new D.Document({ creator: opts.author || 'KC Portal', title: opts.title || 'Draft', styles: { default: { document: { run: { font: fmt.font, size: half } } } }, sections: out });
  return Buffer.from(await D.Packer.toBuffer(doc));
}

// ---- annexures: one stamped PDF per annexure; page numbers continue from the petition ----
async function annexurePdf({ buf, name, mime }, label, startNo, fmt) {
  const g = geo(fmt), out = await PDFDocument.create(); out.registerFontkit(fontkit);
  const fb = await out.embedFont(fs.readFileSync(fontPath(fmt.font, 'b')), { subset: fontPath(fmt.font, 'b').endsWith('.ttf') }), fr = await out.embedFont(fs.readFileSync(fontPath(fmt.font, 'r')), { subset: fontPath(fmt.font, 'r').endsWith('.ttf') });
  const ext = (name.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
  if (ext === '.pdf') { const src = await PDFDocument.load(buf, { ignoreEncryption: true }); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); }
  else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    const im = ext === '.png' ? await out.embedPng(buf) : await out.embedJpg(buf), p = out.addPage([g.w, g.h]), mw = g.w - 2 * 36, mh = g.h - 2 * 60, sc = Math.min(mw / im.width, mh / im.height, 1);
    p.drawImage(im, { x: (g.w - im.width * sc) / 2, y: (g.h - im.height * sc) / 2, width: im.width * sc, height: im.height * sc });
  } else if (ext === '.docx') {
    const txt = (await require('mammoth').extractRawText({ buffer: buf })).value, r = await toPdf(txt, { ...fmt, size: 11, spacing: 1.2 }), src = await PDFDocument.load(r.bytes);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  } else throw new Error('"' + name + '" cannot be turned into a PDF annexure (use PDF, JPG, PNG or Word).');
  out.getPages().forEach((p, i) => {
    const { width, height } = p.getSize(), t = label, sz = 11, w = fb.widthOfTextAtSize(t, sz) + 14;
    p.drawRectangle({ x: width - w - 24, y: height - 40, width: w, height: 22, borderColor: rgb(0, 0, 0), borderWidth: 1, color: rgb(1, 1, 1) });
    p.drawText(t, { x: width - w - 17, y: height - 33, size: sz, font: fb });
    if (startNo) { const n = 'Page ' + (startNo + i); p.drawText(n, { x: (width - fr.widthOfTextAtSize(n, 11)) / 2, y: 18, size: 11, font: fr }); }
  });
  return { bytes: Buffer.from(await out.save()), pages: out.getPageCount() };
}

module.exports = { parse, toPdf, toDocx, annexurePdf, fontPath };
