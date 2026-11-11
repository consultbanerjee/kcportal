'use strict';
// One-file, printable copy of a case's court record (status, dates, parties, hearing history, orders).
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { fontPath } = require('./draftdoc');
const T = (s) => String(s == null ? '' : s).replace(new RegExp('['+String.fromCharCode(8232,8233)+'\t\r]','g'),' ').replace(new RegExp('[^\u0020-\u024F\u2010-\u2022\u2026\u20B9\n]','g'),'?');
const dmy = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d || ''); };

async function summaryPdf(o) { // o: {firm, matter, client, brief, detail, orders, saved:{key->name}, fetchedAt}
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const emb = async (s) => doc.embedFont(fs.readFileSync(fontPath('Times New Roman', s)), { subset: true });
  const R = await emb('r'), B = await emb('b');
  const W = 595.28, H = 841.89, mx = 48, tw = W - 2 * mx, ink = rgb(.1, .12, .2), mute = rgb(.4, .43, .5);
  let page, y, n = 0;
  const foot = () => { const t = T(`${o.firm} — court record copy, ${o.matter.file_no} — page ${n}`); page.drawText(t, { x: mx, y: 26, size: 8, font: R, color: mute }); };
  const np = () => { if (page) foot(); page = doc.addPage([W, H]); n++; y = H - 52; };
  const need = (h) => { if (y - h < 50) np(); };
  const wrap = (t, f, s, w) => { const out = []; for (const para of T(t).split('\n')) { let l = ''; for (const wd of para.split(' ')) { const c = l ? l + ' ' + wd : wd; if (f.widthOfTextAtSize(c, s) <= w || !l) l = c; else { out.push(l); l = wd; } } out.push(l); } return out; };
  const text = (t, { f = R, s = 10.5, x = mx, w = tw, c = ink, gap = 3 } = {}) => { for (const l of wrap(t, f, s, w)) { need(s + gap); page.drawText(l, { x, y: y - s, size: s, font: f, color: c }); y -= s + gap; } };
  const h = (t) => { need(34); y -= 8; text(t.toUpperCase(), { f: B, s: 10.5, c: rgb(.55, .42, .1) }); page.drawLine({ start: { x: mx, y: y + 1 }, end: { x: W - mx, y: y + 1 }, thickness: .6, color: rgb(.8, .78, .7) }); y -= 5; };
  const kv = (k, v) => { if (!v) return; const lines = wrap(v, R, 10.5, tw - 130); need(lines.length * 13.5); page.drawText(T(k), { x: mx, y: y - 10.5, size: 10, font: B, color: mute }); for (const l of lines) { page.drawText(l, { x: mx + 130, y: y - 10.5, size: 10.5, font: R, color: ink }); y -= 13.5; } };
  const table = (cols, rows) => { // cols: [{h,w}] widths sum to tw
    const row = (cells, f, c) => { const ls = cells.map((v, i) => wrap(v, f, 9.5, cols[i].w - 6)), hh = Math.max(...ls.map((a) => a.length)) * 12 + 5; need(hh); let x = mx; ls.forEach((a, i) => { a.forEach((l, j) => page.drawText(l, { x, y: y - 10 - j * 12, size: 9.5, font: f, color: c })); x += cols[i].w; }); y -= hh; page.drawLine({ start: { x: mx, y: y + 2 }, end: { x: W - mx, y: y + 2 }, thickness: .3, color: rgb(.85, .85, .85) }); };
    row(cols.map((c) => c.h), B, mute); rows.forEach((r) => row(r, R, ink)); };

  np();
  text(o.firm, { f: B, s: 13 }); text('COURT RECORD — COPY FOR THE FILE', { f: B, s: 10, c: mute, gap: 6 });
  const b = o.brief, m = o.matter;
  text(`${(b.petitioners || []).join(', ') || m.title}  vs  ${(b.respondents || []).join(', ') || m.opposite_party || ''}`, { f: B, s: 14, gap: 5 });
  text(`Copied from the eCourts system on ${dmy(String(o.fetchedAt || '').slice(0, 10))}. Check the official eCourts website or the certified copy before relying on it in court.`, { s: 9, c: mute, gap: 6 });
  h('Our file');
  kv('File no.', m.file_no); kv('Client', o.client); kv('Matter', m.title);
  h('Case');
  kv('CNR', b.cnr); kv('Case type / no.', [b.case_type, b.case_number].filter(Boolean).join(' ')); kv('Court', [b.court, b.district, b.state].filter(Boolean).join(', '));
  kv('Status', b.status); kv('Next hearing', dmy(b.next_date)); kv('Last hearing', dmy(b.last_date)); kv('Purpose', b.purpose); kv('Filing date', dmy(b.filing_date)); kv('Decision date', dmy(b.decision_date));
  kv('Judge(s)', (b.judges || []).join('; ')); kv('Acts and sections', o.detail.acts && (typeof o.detail.acts === 'string' ? o.detail.acts : JSON.stringify(o.detail.acts)));
  h('Parties and advocates');
  kv('Petitioner(s)', (b.petitioners || []).join('; ')); kv('Advocate(s)', (b.petitioner_advocates || []).join('; ')); kv('Respondent(s)', (b.respondents || []).join('; ')); kv('Advocate(s)', (b.respondent_advocates || []).join('; '));
  const hs = (o.detail.hearings || []).map((x) => [dmy(x.businessOnDate || x.hearingDate || x.date), x.purposeOfHearing || x.purpose || '', x.nextHearingDate ? dmy(x.nextHearingDate) : '']).filter((r) => r[0]).sort((a, c) => (a[0].split('-').reverse().join('') < c[0].split('-').reverse().join('') ? 1 : -1));
  if (hs.length) { h(`History of hearings (${hs.length})`); table([{ h: 'Date', w: 80 }, { h: 'Purpose / business', w: tw - 170 }, { h: 'Next date', w: 90 }], hs); }
  if (o.orders.length) { h(`Orders and judgments (${o.orders.length})`); table([{ h: 'Date', w: 80 }, { h: 'Kind', w: 150 }, { h: 'Saved in this folder as', w: tw - 230 }], o.orders.map((x) => [dmy(x.date), [x.kind, x.type].filter(Boolean).join(' — '), o.saved[x.key] || '(not downloaded yet)'])); }
  const ias = (o.detail.iAs || []).map((x) => (typeof x === 'string' ? x : Object.values(x).filter((v) => v && typeof v !== 'object').join(' · '))).filter(Boolean);
  if (ias.length) { h('Interlocutory applications'); ias.slice(0, 40).forEach((s) => text('• ' + s, { s: 10 })); }
  foot();
  return Buffer.from(await doc.save());
}

// plain, paginated text copy of a judgment fetched from a web page (used for authorities saved in Files)
async function textPdf({ title, source, text }) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const R = await doc.embedFont(fs.readFileSync(fontPath('Times New Roman', 'r')), { subset: true }), B = await doc.embedFont(fs.readFileSync(fontPath('Times New Roman', 'b')), { subset: true });
  const W = 595.28, H = 841.89, mx = 60, tw = W - 2 * mx, S = 11, LH = 15; let page, y, n = 0;
  const np = () => { if (page) page.drawText(T('Page ' + n), { x: W / 2 - 18, y: 28, size: 8, font: R }); page = doc.addPage([W, H]); n++; y = H - 60; };
  const line = (l, f) => { if (y < 55) np(); page.drawText(l, { x: mx, y, size: S, font: f || R }); y -= LH; };
  const wrap = (t, f) => { const out = []; for (const para of T(t).split('\n')) { let l = ''; for (const w of para.split(' ')) { const c = l ? l + ' ' + w : w; if (f.widthOfTextAtSize(c, S) <= tw || !l) l = c; else { out.push(l); l = w; } } out.push(l); } return out; };
  np(); for (const l of wrap(title, B)) line(l, B); for (const l of wrap(source, R)) line(l); y -= 8;
  for (const l of wrap(text, R)) { if (!l.trim()) { y -= 6; continue; } line(l); }
  page.drawText(T('Page ' + n), { x: W / 2 - 18, y: 28, size: 8, font: R });
  return Buffer.from(await doc.save());
}
module.exports = { summaryPdf, dmy, textPdf, T };
