'use strict';
// v5.4: Prepare for filing - join, index, bookmarks, split to limit, per-document forums, access and isolation
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc54p-'));
const app = require('../server'); const { db } = require('../db'); const { PDFDocument, PDFName } = require('pdf-lib');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); } const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = t; } return { s: r.status, j }; }; }
const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
const pdf = async (pages, noise) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) { const p = d.addPage([595, 842]); p.drawText('page ' + (i + 1), { x: 50, y: 800 }); if (noise) p.node.set(PDFName.of('Junk'), d.context.register(d.context.stream(require('crypto').randomBytes(noise)))); } return Buffer.from(await d.save()); };
const form = (files, o = {}) => { const fd = new FormData(); Object.entries(o).forEach(([k, v]) => fd.append(k, v)); files.forEach(([n, b]) => fd.append('files', new Blob([b], { type: 'application/pdf' }), n)); return fd; };
(async () => {
  const ad = client(), cl = client(), anon = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  const a = await pdf(2), b = await pdf(3), c = await pdf(1);
  let r = await ad('POST', '/api/filing-prep', form([['Petition.pdf', a], ['Annexure_P-1.pdf', b], ['Annexure_P-2.pdf', c]], { forum: 'nclt-kolkata', title: 'Test Petition', titles: JSON.stringify(['Petition', 'Annexure P-1', 'Annexure P-2']) }));
  ok(r.s === 200 && r.j.mode === 'set' && r.j.parts.length === 1, 'joins into one file');
  ok(r.j.pages === 6 + 1, 'total pages = documents + one index page: ' + r.j.pages);
  ok(r.j.contents.map((x) => x.from).join() === '2,4,7', 'index page numbers: ' + r.j.contents.map((x) => x.from));
  const d = await ad('GET', `/api/filing-prep/${r.j.token}/0`, null, true); const buf = Buffer.from(await d.arrayBuffer());
  ok(d.status === 200 && d.headers.get('content-type') === 'application/pdf', 'download works');
  const out = await PDFDocument.load(buf); ok(out.getPageCount() === 7, 'downloaded file has 7 pages');
  ok(!!out.catalog.get(require('pdf-lib').PDFName.of('Outlines')), 'bookmarks present');
  // no index / numbers
  r = await ad('POST', '/api/filing-prep', form([['A.pdf', a]], { index: '0', numbers: '0' })); ok(r.j.pages === 2, 'index can be switched off');
  // splitting: tiny fake limit through a custom forum
  const cf = await ad('POST', '/api/filing-forums', { name: 'Tiny Forum', url: 'https://example.com', max_file_mb: 1 }); const fid = (cf.j && cf.j.id) ? 'f' + cf.j.id : '';
  const big = await pdf(12, 90000);
  r = await ad('POST', '/api/filing-prep', form([['Big.pdf', big], ['Big2.pdf', big], ['Big3.pdf', big]], { forum: fid, title: 'Big' }));
  ok(r.s === 200 && r.j.limit_mb === 1, 'custom forum limit is read: ' + JSON.stringify(r.j).slice(0, 120));
  ok(r.j.parts.length > 1 && r.j.parts.every((p) => p.ok), 'big set split into parts that each fit (' + r.j.parts.length + ' parts, ' + r.j.parts.map((p) => p.mb) + ' MB)');
  const covered = r.j.parts.reduce((n, p) => n + (p.to - p.from + 1), 0); ok(covered === r.j.pages, 'parts cover every page once');
  // per-document forum
  r = await ad('POST', '/api/filing-prep', form([['A.pdf', a]], { forum: 'drt-kolkata' })); ok(r.j.mode === 'each' && r.j.rows[0].ok, 'DRT checks each document, does not join');
  // errors
  r = await ad('POST', '/api/filing-prep', form([])); ok(r.s === 400, 'no files -> 400');
  r = await ad('POST', '/api/filing-prep', form([['bad.pdf', Buffer.from('not a pdf')]])); ok(r.s === 400 && /could not be read/.test(r.j.error), 'damaged pdf reported by name');
  // isolation + auth
  r = await ad('POST', '/api/filing-prep', form([['A.pdf', a]])); const tok = r.j.token;
  r = await anon('GET', `/api/filing-prep/${tok}/0`); ok(r.s === 401, 'anonymous cannot download');
  r = await ad('GET', `/api/filing-prep/${tok}/9`); ok(r.s === 404, 'bad part -> 404');
  r = await ad('GET', `/api/filing-prep/deadbeef/0`); ok(r.s === 404, 'unknown token -> 404');
  r = await anon('POST', '/api/filing-prep', form([['A.pdf', a]])); ok(r.s === 401, 'anonymous cannot prepare');
  console.log(`filingprep: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
