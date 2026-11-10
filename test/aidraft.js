'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kcd-')); process.env.PUBLIC_URL = 'https://portal.kclegal.us';
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const AIM = require('../routes/aimail');
const { PDFDocument } = require('pdf-lib');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const mails = [];
AIM.setMailer({ fetch: async () => ({ messages: [], maxUid: 0 }), send: async (c, m) => { mails.push(m); }, verify: async () => ({}) });
let lastBody;
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), h: r.headers }; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
const pdfOf = async (n, txt) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) { const p = d.addPage([595, 842]); p.drawText(txt + ' p' + (i + 1), { x: 50, y: 700 }); } return Buffer.from(await d.save()); };
(async () => {
  const admin = client(), anon = client(), tok = db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
  await admin('POST', '/api/invite/' + tok, { password: 'StrongPass123' }); await admin('POST', '/api/login', { email: 'kclegal.in@gmail.com', password: 'StrongPass123' });
  const t = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  AI.setS(t, 'ai_drafting', '1'); AI.setSecret(t, 'ai_key', 'k');
  AI.setTransport(async (body) => {
    lastBody = body; const ids = [...JSON.stringify(body.messages).matchAll(/DOCUMENT ID (\d+)/g)].map((m) => +m[1]);
    const txt = '@NONUM\n@CB IN THE HIGH COURT AT CALCUTTA\n@C W.P.A. NO. __ OF 2026\n@NUM\n@CB WRIT PETITION\n' + Array.from({ length: 12 }, (_, i) => `${i + 1}. That your petitioner states that ... A copy of the said order is enclosed herewith and marked as ANNEXURE P-${Math.min(i + 1, 2)}.`).join('\n\n') + '\n\n=====ANNEXURES=====\n' + JSON.stringify(ids.slice(0, 2).map((d, i) => ({ n: i + 1, doc_id: d, title: 'Doc ' + (i + 1), date: '2026-01-0' + (i + 1) })).concat([{ n: 3, doc_id: 99999, title: 'ghost' }])) + '\n=====NOTES FOR ADVOCATE=====\n- check limitation';
    return { content: [{ type: 'text', text: txt }], usage: { input_tokens: 10, output_tokens: 10 } };
  });
  const cid = (await admin('POST', '/api/clients', { name: 'Sita Devi', phone: '9830012345', email: 'sita@example.com', address: '12 Park St' })).j.id;
  const h = app.locals.fsHelpers; h.seed(t, cid, null); const folder = h.ensurePath(t, cid, ['Uploaded'], null, false);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const f1 = await h.putFile(t, { clientId: cid, parent: folder, name: 'Order.pdf', buffer: await pdfOf(3, 'ORDER'), mime: 'application/pdf' });
  const f2 = await h.putFile(t, { clientId: cid, parent: folder, name: 'Letter.png', buffer: png, mime: 'image/png' });
  const f3 = await h.putFile(t, { clientId: cid, parent: folder, name: 'Notes.docx', buffer: Buffer.from('PK\u0003\u0004zz'), mime: 'application/zip' });
  let r = await admin('GET', '/api/ai/kinds'); ok(r.j.find((k) => k.id === 'writ_petition').page === 'A4' && r.j.find((k) => k.id === 'suit').page === 'Legal' && r.j.find((k) => k.id === 'letter').page === null, 'kinds: writ A4, suit Legal, others free');
  r = await admin('GET', '/api/ai/client-docs?client_id=' + cid); ok(r.j.length === 3 && r.j.find((d) => d.name === 'Order.pdf').path === 'Uploaded' && r.j.find((d) => d.name === 'Order.pdf').ok, 'client documents listed');
  const mk = async (kind, extra = {}) => { const fd = new FormData(); fd.append('kind', kind); fd.append('client_id', cid); fd.append('doc_ids', [f1.id, f2.id].join(',')); fd.append('instruction', 'Draft a writ against the Collector'); for (const [k, v] of Object.entries(extra)) fd.append(k, v); const x = await admin('POST', '/api/ai/draft', fd); let d; for (let i = 0; i < 80; i++) { d = await admin('GET', '/api/ai/drafts/' + x.j.id); if (d.j.status !== 'working') break; await new Promise((z) => setTimeout(z, 100)); } return d.j; };
  let d = await mk('writ_petition', { page: 'Legal' });
  ok(d.status === 'ready' && d.fmt.page === 'A4' && d.fmt.font === 'Times New Roman' && d.fmt.size === 14 && d.fmt.m.left === 1.75 && d.fmt.m.top === 1.5 && d.fmt.m.right === 1 && d.fmt.spacing === 1.5, 'writ forced to A4 with HC format even if Legal requested');
  const sys = lastBody.system, msgs = JSON.stringify(lastBody.messages);
  ok(/DOCUMENT ID \d+: Order\.pdf/.test(msgs) && msgs.includes('"type":"document"') && msgs.includes('"type":"image"') && msgs.includes('Sita Devi') && msgs.includes('12 Park St'), 'documents and client details reached the AI');
  ok(/Krishnika|ADVOCATE NAME|Advocate/.test(sys) && /1\.75"/.test(sys) && /FOR THAT/.test(sys) && /ANNEXURE P-1/.test(sys) && lastBody.max_tokens >= 16000, 'house style, format and annexure rules in system prompt');
  ok(d.annexures.length === 2 && d.annexures[0].doc_id === f1.id && !d.annexures.find((a) => a.doc_id === 99999), 'annexure list kept, unknown document dropped');
  ok(/limitation/.test(d.notes), 'notes kept');
  r = await admin('POST', `/api/ai/drafts/${d.id}/build`); ok(r.s === 200 && r.j.files.length === 4, 'built word + petition + 2 annexures ' + JSON.stringify(r.j));
  const files = r.j.files, main = await admin('GET', `/api/ai/drafts/${d.id}/files/0`, null, true);
  const mp = await PDFDocument.load(main.buf); ok(main.s === 200 && mp.getPageCount() >= 3 && Math.abs(mp.getPage(0).getWidth() - 595.28) < 1, 'petition PDF is A4');
  const a1 = await PDFDocument.load((await admin('GET', `/api/ai/drafts/${d.id}/files/2`, null, true)).buf), a2 = await PDFDocument.load((await admin('GET', `/api/ai/drafts/${d.id}/files/3`, null, true)).buf);
  ok(files[2].name.startsWith('Annexure P-1') && a1.getPageCount() === 3 && a2.getPageCount() === 1 && files[0].pages >= 3, 'annexures separate and in order');
  const docx = await admin('GET', `/api/ai/drafts/${d.id}/files/1`, null, true); ok(docx.buf[0] === 0x50 && docx.buf.length > 3000, 'word file produced');
  const filed = db.prepare("SELECT COUNT(*) c FROM fs_nodes WHERE tenant_id=? AND client_id=? AND kind='file' AND name LIKE 'Annexure P-%'").get(t, cid).c; ok(filed === 2, 'copies filed in the client Drafts folder');
  // share
  r = await admin('POST', `/api/ai/drafts/${d.id}/share`, { files: [0, 2], email: true, to: 'sita@example.com', message: 'Please see' });
  ok(r.s === 400 && /not set up/.test(r.j.error), 'email refused without mailbox');
  AI.setS(t, 'mail_smtp_host', 'smtp.x'); AI.setS(t, 'mail_smtp_user', 'i@k.us'); AI.setSecret(t, 'mail_smtp_pass', 'pw');
  r = await admin('POST', `/api/ai/drafts/${d.id}/share`, { files: [0, 2], email: true, to: 'sita@example.com', whatsapp: true, phone: '98300 12345', message: 'Please see' });
  const ml = mails[mails.length - 1]; ok(r.s === 200 && r.j.attached === 2 && ml.attachments.length === 2 && ml.attachments[0].filename.endsWith('.pdf') && /#\/pack\//.test(ml.text), 'email with attachments');
  ok(/^https:\/\/wa\.me\/919830012345\?text=/.test(r.j.wa_link), 'whatsapp link');
  const tk = r.j.link.split('/pack/')[1]; r = await anon('GET', '/api/public/pack/' + tk); ok(r.s === 200 && r.j.files.length === 2 && r.j.firm, 'public pack lists chosen files');
  r = await anon('GET', `/api/public/pack/${tk}/2`, null, true); ok(r.s === 404 === false, 'public download of a chosen file works');
  r = await anon('GET', `/api/public/pack/${tk}/1`, null, true); ok(r.s === 404, 'file not chosen is not reachable');
  r = await anon('GET', '/api/public/pack/nope'); ok(r.s === 404, 'bad token 404');
  // suit = Legal; other = choice; letter on letterhead profile
  d = await mk('suit'); ok(d.fmt.page === 'Legal', 'suit is Legal');
  d = await mk('application', { page: 'Legal' }); ok(d.fmt.page === 'Legal', 'application honours Legal');
  d = await mk('application', { page: 'A4' }); ok(d.fmt.page === 'A4', 'application honours A4');
  r = await admin('POST', `/api/ai/drafts/${d.id}/build`); const lp = await PDFDocument.load((await admin('GET', `/api/ai/drafts/${d.id}/files/0`, null, true)).buf); ok(Math.abs(lp.getPage(0).getWidth() - 595.28) < 1, 'A4 pdf');
  d = await mk('drt_tribunal'); ok(d.fmt.font === 'Bookman Old Style' && d.fmt.size === 12, 'tribunal profile = Bookman 12');
  r = await admin('PATCH', '/api/ai/drafts/' + d.id, { output: '@CB EDITED\n\nText', page: 'Legal' }); d = (await admin('GET', '/api/ai/drafts/' + d.id)).j; ok(d.output.startsWith('@CB EDITED') && d.fmt.page === 'Legal', 'edit + page change saved');
  r = await admin('POST', `/api/ai/drafts/${d.id}/build`); const tp = await PDFDocument.load((await admin('GET', `/api/ai/drafts/${d.id}/files/0`, null, true)).buf); ok(Math.abs(tp.getPage(0).getHeight() - 1008) < 1, 'Legal pdf is 14 inches tall');
  // revise keeps annexures
  d = await mk('writ_petition'); await admin('POST', `/api/ai/drafts/${d.id}/refine`, { instruction: 'shorter' }); let d2; for (let i = 0; i < 50; i++) { d2 = (await admin('GET', '/api/ai/drafts/' + d.id)).j; if (d2.status !== 'working') break; await new Promise((z) => setTimeout(z, 100)); } ok(d2.status === 'ready' && d2.annexures.length === 2, 'revise keeps annexures');
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
