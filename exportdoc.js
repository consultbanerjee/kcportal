'use strict';
// One builder for every "download as Word / PDF" in the portal (case history, court record, registers, chat and activity records).
// spec = { firm, title, subtitle, landscape, sections: [ { heading, kv: [[k, v]], cols: [{h, w}], rows: [[...]], text } ] }  (col widths are relative)
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { fontPath } = require('./draftdoc');
const { T } = require('./ecourtpdf');
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const clip = (s, n = 4000) => String(s == null ? '' : s).slice(0, n);

async function toPdf(spec) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const R = await doc.embedFont(fs.readFileSync(fontPath('Times New Roman', 'r')), { subset: true }), B = await doc.embedFont(fs.readFileSync(fontPath('Times New Roman', 'b')), { subset: true });
  const W = spec.landscape ? 841.89 : 595.28, H = spec.landscape ? 595.28 : 841.89, mx = 42, tw = W - 2 * mx, ink = rgb(.1, .12, .2), mute = rgb(.42, .45, .52); let page, y, n = 0;
  const foot = () => page.drawText(T(`${spec.firm || ''} — ${spec.title} — page ${n}`).slice(0, 150), { x: mx, y: 24, size: 8, font: R, color: mute });
  const np = () => { if (page) foot(); page = doc.addPage([W, H]); n++; y = H - 48; };
  const need = (h) => { if (y - h < 46) np(); };
  const wrap = (t, f, s, w) => { const out = []; for (const para of T(t).split('\n')) { let l = ''; for (const wd of para.split(' ')) { const c = l ? l + ' ' + wd : wd; if (f.widthOfTextAtSize(c, s) <= w || !l) l = c; else { out.push(l); l = wd; } } out.push(l); } return out; };
  const text = (t, { f = R, s = 10.5, c = ink, gap = 3, x = mx, w = tw } = {}) => { for (const l of wrap(t, f, s, w)) { need(s + gap); page.drawText(l, { x, y: y - s, size: s, font: f, color: c }); y -= s + gap; } };
  np(); if (spec.firm) text(spec.firm, { f: B, s: 13 }); text(spec.title, { f: B, s: 14, gap: 4 }); if (spec.subtitle) text(spec.subtitle, { s: 9.5, c: mute, gap: 6 });
  for (const s of spec.sections || []) {
    if (s.heading) { need(34); y -= 8; text(String(s.heading).toUpperCase(), { f: B, s: 10.5, c: rgb(.55, .42, .1) }); page.drawLine({ start: { x: mx, y: y + 1 }, end: { x: W - mx, y: y + 1 }, thickness: .6, color: rgb(.8, .78, .7) }); y -= 5; }
    for (const [k, v] of s.kv || []) { if (v == null || v === '') continue; const ls = wrap(v, R, 10.5, tw - 130); need(ls.length * 13.5); page.drawText(T(k), { x: mx, y: y - 10.5, size: 10, font: B, color: mute }); for (const l of ls) { page.drawText(l, { x: mx + 130, y: y - 10.5, size: 10.5, font: R, color: ink }); y -= 13.5; } }
    if (s.text) text(s.text);
    if (s.cols && s.rows) {
      const tot = s.cols.reduce((a, c) => a + (c.w || 1), 0), cw = s.cols.map((c) => (c.w || 1) / tot * tw);
      const row = (cells, f, c) => { const ls = cells.map((v, i) => wrap(clip(v, 1500), f, 9.5, cw[i] - 6)), hh = Math.max(...ls.map((a) => a.length)) * 12 + 5; need(hh); let x = mx; ls.forEach((a, i) => { a.forEach((l, j) => page.drawText(l, { x, y: y - 10 - j * 12, size: 9.5, font: f, color: c })); x += cw[i]; }); y -= hh; page.drawLine({ start: { x: mx, y: y + 2 }, end: { x: W - mx, y: y + 2 }, thickness: .3, color: rgb(.85, .85, .85) }); };
      row(s.cols.map((c) => c.h), B, mute); if (!s.rows.length) text('None recorded.', { c: mute }); for (const r of s.rows) row(r.map((v) => (v == null ? '' : v)), R, ink);
    }
  }
  foot(); return Buffer.from(await doc.save());
}
async function toDocx(spec) {
  const D = require('docx'), F = 'Times New Roman', sz = 21, P = (t, o = {}) => new D.Paragraph({ spacing: { after: o.after == null ? 60 : o.after }, children: [new D.TextRun({ text: clip(t), bold: !!o.bold, size: o.size || sz, font: F, color: o.color })] });
  const kids = [];
  if (spec.firm) kids.push(P(spec.firm, { bold: true, size: 26 })); kids.push(P(spec.title, { bold: true, size: 28, after: 80 })); if (spec.subtitle) kids.push(P(spec.subtitle, { size: 19, color: '666666', after: 160 }));
  for (const s of spec.sections || []) {
    if (s.heading) kids.push(new D.Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: 'C9B98A', space: 2 } }, children: [new D.TextRun({ text: String(s.heading).toUpperCase(), bold: true, size: sz, font: F, color: '8C6B1A' })] }));
    if (s.kv && s.kv.some(([, v]) => v)) kids.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, borders: D.TableBorder ? undefined : undefined, rows: s.kv.filter(([, v]) => v != null && v !== '').map(([k, v]) => new D.TableRow({ children: [new D.TableCell({ width: { size: 28, type: D.WidthType.PERCENTAGE }, borders: nob(D), children: [P(k, { bold: true, color: '555555' })] }), new D.TableCell({ width: { size: 72, type: D.WidthType.PERCENTAGE }, borders: nob(D), children: [P(v)] })] })) }));
    if (s.text) kids.push(...String(s.text).split('\n').map((l) => P(l)));
    if (s.cols && s.rows) {
      const tot = s.cols.reduce((a, c) => a + (c.w || 1), 0), pc = (c) => Math.max(5, Math.round((c.w || 1) / tot * 100));
      const cell = (v, i, head) => new D.TableCell({ width: { size: pc(s.cols[i]), type: D.WidthType.PERCENTAGE }, shading: head ? { fill: 'F1EDE0', type: D.ShadingType.CLEAR, color: 'auto' } : undefined, children: String(v == null ? '' : v).split('\n').slice(0, 30).map((l) => P(l, { bold: head, size: 19, after: 20 })) });
      kids.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: [new D.TableRow({ tableHeader: true, children: s.cols.map((c, i) => cell(c.h, i, true)) }), ...s.rows.map((r) => new D.TableRow({ children: s.cols.map((c, i) => cell(r[i], i, false)) }))] }));
      if (!s.rows.length) kids.push(P('None recorded.', { color: '777777' }));
    }
  }
  const land = !!spec.landscape, w = land ? 16838 : 11906, h = land ? 11906 : 16838;
  const doc = new D.Document({ creator: spec.firm || 'KC Portal', title: spec.title, styles: { default: { document: { run: { font: F, size: sz } } } },
    sections: [{ properties: { page: { size: { width: w, height: h }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: `${spec.firm || ''} — ${spec.title} — page `, size: 16, font: F, color: '777777' }), new D.TextRun({ children: [D.PageNumber.CURRENT], size: 16, font: F, color: '777777' })] })] }) }, children: kids }] });
  return Buffer.from(await D.Packer.toBuffer(doc));
}
const nob = (D) => { const n = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }; return { top: n, bottom: n, left: n, right: n }; };
const build = (spec, fmt) => (fmt === 'pdf' ? toPdf(spec) : toDocx(spec));
const send = (res, buf, fmt, name) => { res.set({ 'Content-Type': MIME[fmt], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(String(name).replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 120) + '.' + fmt)}` }); res.end(buf); };
module.exports = { build, send, MIME, toPdf, toDocx };
