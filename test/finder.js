'use strict';
// v5.4: unified search (Finder) - coverage, ranking, access limits, firm isolation, saved searches
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc54-'));
const app = require('../server'); const { db } = require('../db');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; const tx = await r.text(); try { j = JSON.parse(tx); } catch (e) {} return { s: r.status, j, tx }; }; }
const signup = async (c, email, pw) => { const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
const find = async (c, q, extra = '') => (await c('GET', '/api/find?q=' + encodeURIComponent(q) + extra));
const grp = (r, k) => (r.j.groups || []).find((g) => g.key === k);
(async () => {
  const ad = client(), a1 = client(), a2 = client(), sa = client(), t2 = client(), anon = client();
  await signup(ad, 'kclegal.in@gmail.com', 'StrongPass123'); await signup(sa, 'consultbanerjee@gmail.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv One', email: 'a1@example.com', role: 'advocate' }); await signup(a1, 'a1@example.com', 'StrongPass123');
  await ad('POST', '/api/users', { name: 'Adv Two', email: 'a2@example.com', role: 'advocate' }); await signup(a2, 'a2@example.com', 'StrongPass123');
  let r = await ad('POST', '/api/clients', { name: 'Sukhobrishti Sparsh Association', phone: '9830012345', email: 'sukho@example.com', address: 'New Town, Rajarhat' }); const cid = r.j.id;
  r = await ad('POST', '/api/clients', { name: 'Arch Pharmalabs Workers Union', phone: '9831000111' }); const cid2 = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid, title: 'Section 16B complaint', case_no: 'CC/385/2025', forum: 'WB Competent Authority', opposite_party: 'Shapoorji Developers' }); const mid = r.j.id;
  r = await ad('POST', '/api/matters', { client_id: cid2, title: 'NCLT resolution plan objection', forum: 'NCLT Mumbai' }); const mid2 = r.j.id;
  await ad('POST', '/api/tasks', { title: 'Draft rejoinder for the association', matter_id: mid });
  await ad('POST', '/api/tasks', { title: 'File vakalatnama in NCLT', matter_id: mid2 });
  await ad('POST', '/api/letters', { matter_id: mid, to_name: 'Competent Authority', subject: 'Prayer for adjournment', body: 'The complainant is unwell and seeks one fortnight adjournment of the hearing.' });
  await ad('POST', '/api/leads', { name: 'Ramesh Gupta', phone: '9831111111', issue: 'Cheque bounce notice from HDFC' });
  await ad('POST', '/api/judgments', { court: 'Supreme Court', title: 'ABC v. XYZ', case_no: 'CA 1/2020', summary: 'Held that arbitration clause survives novation', subject: 'Arbitration', decided_on: '2020-05-05' });

  // ---- coverage and ranking
  r = await find(ad, 'sukho'); ok(r.s === 200 && grp(r, 'clients') && grp(r, 'clients').items[0].title.startsWith('Sukhobrishti'), 'partial word finds the client');
  ok(grp(r, 'matters') === undefined || grp(r, 'matters').items.every((x) => /Section 16B/.test(x.title)), 'cases of that client come with it (client name is searched)');
  r = await find(ad, '385/2025'); ok(grp(r, 'matters') && grp(r, 'matters').items[0].id === mid, 'case number with a slash');
  r = await find(ad, '9830012'); ok(grp(r, 'clients') && grp(r, 'clients').items[0].id === cid, 'phone fragment finds the client');
  r = await find(ad, 'fortnight adjournment'); ok(grp(r, 'letters') && /fortnight/i.test(grp(r, 'letters').items[0].snippet), 'words inside a letter, with a snippet around the hit');
  r = await find(ad, 'rejoinder'); ok(grp(r, 'tasks') && grp(r, 'tasks').items.length === 1, 'task title');
  r = await find(ad, 'cheque'); ok(grp(r, 'leads') && grp(r, 'leads').items[0].title === 'Ramesh Gupta', 'lead by issue');
  r = await find(ad, 'novation'); ok(grp(r, 'judgments') && grp(r, 'judgments').items[0].open === 'judgment', 'judgment summary');
  r = await find(ad, 'Supreme Court'); ok(grp(r, 'repository'), 'repository links are searched');
  r = await find(ad, 'NCLAT'); ok(grp(r, 'forums') && grp(r, 'forums').items.some((x) => /NCLAT/.test(x.title)), 'filing forums are searched');
  r = await find(ad, 'nclt'); ok(r.j.groups[0].best >= r.j.groups[r.j.groups.length - 1].best, 'groups ordered best first');
  r = await find(ad, "a' OR 1=1 --"); ok(r.s === 200 && r.j.total < 5, 'one-letter and filler words do not match everything in the loose fallback: ' + r.j.total);
  r = await find(ad, 'zzqq arch'); ok(!(r.j.groups || []).some((g) => g.key === 'repository' || g.key === 'forums'), 'loose fallback does not pull link catalogues');
  r = await find(ad, 'Arch Pharmalabs'); ok(grp(r, 'clients').items[0].id === cid2 && r.j.total >= 2, 'all words must match; exact client first');
  r = await find(ad, 'Arch Sukhobrishti'); ok(r.j.relaxed === true && r.j.total > 0, 'relaxed: when no item has every word, show items with some');
  r = await find(ad, 'zzzqqq'); ok(r.s === 200 && r.j.total === 0 && r.j.groups.length === 0, 'nothing found is an empty answer');
  r = await find(ad, '%'); ok(r.j.total === 0, 'one wildcard character is not a search');
  r = await find(ad, '%%'); ok(r.j.total === 0, 'wildcards are taken literally');
  r = await find(ad, '_ _'); ok(r.j.total === 0, 'underscore wildcards are taken literally');
  r = await find(ad, "x'; DROP TABLE clients;--"); ok(r.s === 200 && db.prepare('SELECT COUNT(*) n FROM clients').get().n >= 2, 'quote and SQL text is harmless');
  r = await find(ad, 'sukho', '&types=tasks'); ok(r.j.groups.length === 0, 'type filter keeps only the chosen types');
  r = await find(ad, 'rejoinder', '&types=tasks,letters'); ok(r.j.groups.length === 1 && r.j.groups[0].key === 'tasks', 'type filter with a list');
  r = await find(ad, 'x'); ok(r.j.total === 0, 'a single letter is ignored');

  // ---- who may see what
  ok((await anon('GET', '/api/find?q=sukho')).s === 401, 'sign-in needed');
  ok((await sa('GET', '/api/find?q=sukho')).s === 403, 'platform owner account has no firm data to search');
  await ad('PUT', '/api/team/settings', { restrict: true });
  const u1 = db.prepare("SELECT id FROM users WHERE email='a1@example.com'").get().id;
  await ad('PUT', `/api/matters/${mid}/team`, { members: [{ user_id: u1, level: 'work' }] });
  r = await find(a1, 'rejoinder'); ok(!grp(r, 'tasks'), 'a part the admin switched off for advocates is not searched (Tasks)');
  r = await find(a1, 'sukho'); ok(grp(r, 'matters') && !grp(r, 'clients'), 'Clients switched off for advocates: the case is found, the client list is not searched');
  await ad('PUT', '/api/team/settings', { advocate: ['clients', 'tasks', 'letters'] });
  r = await find(a2, 'sukho'); ok(!grp(r, 'matters') && !grp(r, 'tasks') && !grp(r, 'letters'), 'restricted advocate not on the case finds none of its case papers (the client list follows the Clients switch, as elsewhere)');
  r = await find(a2, 'rejoinder'); ok(!grp(r, 'tasks'), 'tasks of a hidden case stay hidden');
  r = await find(a2, 'adjournment'); ok(!grp(r, 'letters'), 'letters of a hidden case stay hidden');
  r = await find(a1, 'sukho'); ok(grp(r, 'matters') && grp(r, 'clients'), 'advocate added to the case finds the case and the client');
  r = await find(a1, 'Arch Pharmalabs'); ok(!grp(r, 'matters'), 'but not the other case');
  r = await find(a1, 'rejoinder'); ok(grp(r, 'tasks') && grp(r, 'tasks').items.length === 1, 'tasks of his case show');
  r = await find(a1, 'vakalatnama'); ok(!grp(r, 'tasks'), 'tasks of the other case do not');
  r = await find(a1, 'fortnight'); ok(grp(r, 'letters'), 'letters of his case show');
  await ad('PUT', '/api/team/settings', { restrict: false });

  // ---- another firm sees nothing of ours
  r = await sa('POST', '/api/platform/firms', { name: 'Test Chambers', prefix: 'TC', admin_name: 'Tara', admin_email: 'tara@test.in' }); const f2 = r.j.id;
  await signup(t2, 'tara@test.in', 'StrongPass123');
  r = await find(t2, 'sukho'); ok(r.s === 200 && r.j.total === 0, 'another firm cannot find our client');
  r = await find(t2, 'novation'); ok(r.j.total === 0, 'another firm cannot find our judgments');
  r = await find(t2, 'adjournment'); ok(r.j.total === 0, 'another firm cannot find our letters');
  await t2('POST', '/api/clients', { name: 'Sukhobrishti Their Own' }); r = await find(t2, 'sukho'); ok(r.j.total === 1 && grp(r, 'clients').items.length === 1, 'it finds only its own');
  r = await find(ad, 'Sukhobrishti'); ok(!(r.j.groups.find((g) => g.key === 'clients').items.some((x) => /Their Own/.test(x.title))), 'and we do not see theirs');

  // ---- module switches
  await sa('PUT', `/api/platform/firms/${f2}/plan`, { off: ['repository', 'efiling'] });
  r = await find(t2, 'Supreme Court'); ok(!grp(r, 'repository'), 'repository switched off: not searched');
  r = await find(t2, 'NCLAT'); ok(!grp(r, 'forums'), 'filing forums switched off: not searched');
  ok(!(await find(t2, 'x y')).j.types.some(([k]) => k === 'repository'), 'types list leaves out switched-off sources');

  // ---- saved searches
  r = await ad('POST', '/api/find/saved', { q: 'sukhobrishti', types: 'matters,clients' }); ok(r.s === 200 && r.j.id, 'save a search'); const sid = r.j.id;
  ok((await ad('POST', '/api/find/saved', { q: 'Sukhobrishti', types: 'matters,clients' })).j.dup === true, 'same search is not saved twice');
  ok((await ad('POST', '/api/find/saved', { q: 'a' })).s === 400, 'too short to save');
  ok((await ad('GET', '/api/find/saved')).j.length === 1, 'list saved');
  ok((await a1('GET', '/api/find/saved')).j.length === 0, 'saved searches are personal');
  ok((await a1('DELETE', '/api/find/saved/' + sid)).s === 404, 'cannot remove someone else\'s');
  ok((await ad('DELETE', '/api/find/saved/' + sid)).s === 200 && (await ad('GET', '/api/find/saved')).j.length === 0, 'remove');
  console.log('finder:', pass, 'passed,', fail, 'failed'); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
