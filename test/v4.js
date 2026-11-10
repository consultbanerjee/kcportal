'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kc4-'));
const app = require('../server'); const { db } = require('../db'); const AI = require('../aicore'); const B = require('../routes/books'); const SA = require('../routes/superadmin');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const srv = app.listen(0), base = 'http://127.0.0.1:' + srv.address().port;
function client() { let cookie = ''; return async (method, url, body, raw) => { const h = { 'X-Requested-With': 'kcportal', cookie }; let b = body; if (body) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; if (raw) return r; let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }; }
const login = async (c, email, pw) => { db.prepare("UPDATE users SET invite_token=COALESCE(invite_token,'t'||id||'x'||abs(random())), invite_expires=COALESCE(invite_expires,'2999-01-01') WHERE email=? AND pass_hash IS NULL").run(email); const row = db.prepare('SELECT invite_token t FROM users WHERE email=?').get(email); if (row && row.t) await c('POST', '/api/invite/' + row.t, { password: pw }); return c('POST', '/api/login', { email, password: pw }); };
(async () => {
  const sa = client(), ad = client();
  await login(sa, 'consultbanerjee@gmail.com', 'StrongPass123'); await login(ad, 'kclegal.in@gmail.com', 'StrongPass123');
  const kc = db.prepare("SELECT id FROM tenants WHERE kind='firm'").get().id;
  let r = await sa('GET', '/api/platform/overview');
  ok(r.s === 200 && r.j.firms.length === 1 && r.j.firms[0].exempt && r.j.firms[0].plan === 'premium' && r.j.firms[0].off.length === 0 && r.j.firms[0].claude, 'KC LEGAL seeded: premium, all modules, Claude on, owner firm');
  ok((await ad('GET', '/api/platform/overview')).s === 403, 'firm admin cannot open platform');

  // second firm
  r = await sa('POST', '/api/platform/firms', { name: 'Test Chambers', prefix: 'TC', admin_name: 'Tara', admin_email: 'tara@test.in' }); ok(r.s === 200, 'firm created');
  const f2 = r.j.id; const t2 = client(); await login(t2, 'tara@test.in', 'StrongPass123');

  // module gating
  ok((await t2('GET', '/api/invoices')).s === 200 && (await t2('GET', '/api/leads')).s === 200, 'all modules open by default');
  r = await sa('PUT', `/api/platform/firms/${f2}/plan`, { plan: 'starter', apply_preset: true, fee: 1500 }); ok(r.s === 200, 'apply starter plan');
  ok((await t2('GET', '/api/leads')).s === 403, 'CRM closed on starter');
  ok((await t2('GET', '/api/invoices')).s === 200 && (await ad('GET', '/api/leads')).s === 200, 'accounts open for Test Chambers; KC LEGAL unaffected');
  r = await sa('PUT', `/api/platform/firms/${f2}/plan`, { off: ['accounts'] }); ok((await t2('GET', '/api/books')).s === 403 && (await t2('GET', '/api/invoices')).s === 403, 'accounts closed');
  r = await t2('GET', '/api/modules'); ok(r.j.off.includes('accounts') && !r.j.off.includes('crm'), 'modules endpoint reflects off list');
  ok((await sa('PUT', `/api/platform/firms/${f2}/plan`, { fee: -5 })).s === 400, 'bad fee refused');
  await sa('PUT', `/api/platform/firms/${f2}/plan`, { off: [] });

  // Claude switch + token meter
  let calls = 0; AI.setTransport(async () => { calls++; return { content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 2000, output_tokens: 500 } }; });
  AI.setS(f2, 'ai_drafting', '1');
  r = await t2('GET', '/api/features'); ok(r.j.drafting === true, 'feature on when allowed');
  r = await t2('POST', '/api/ai-admin/test-ai'); ok(r.s === 200 && r.j.ok, 'AI call works'); 
  await AI.call(f2, 'drafting', { system: 's', messages: [{ role: 'user', content: 'x' }] });
  await sa('PUT', `/api/platform/firms/${f2}/plan`, { claude: false });
  r = await t2('POST', '/api/ai-admin/test-ai'); ok(r.s === 403 && /switched off/.test(r.j.error) && calls === 2, 'Claude off blocks the call before it reaches the API');
  r = await t2('GET', '/api/features'); ok(r.j.drafting === false, 'features hidden when Claude off');
  r = await t2('GET', '/api/ai-admin'); ok(r.j.claude_allowed === false, 'admin sees the switch state');
  await sa('PUT', `/api/platform/firms/${f2}/plan`, { claude: true, markup: 20 });
  await sa('PUT', '/api/platform/settings', { claude_all: false }); r = await ad('POST', '/api/ai-admin/test-ai'); ok(r.s === 403, 'master switch blocks every firm');
  await sa('PUT', '/api/platform/settings', { claude_all: true, rate_in: 3, rate_out: 15, usd_inr: 80 });
  const month = new Date().toISOString().slice(0, 7);
  r = await sa('GET', '/api/platform/usage?month=' + month); const u = r.j.firms.find((x) => x.id === f2);
  ok(u.calls === 2 && u.in_tok === 4000 && u.out_tok === 1000, 'tokens counted per firm: ' + JSON.stringify([u.calls, u.in_tok, u.out_tok]));
  // (4000/1e6*3 + 1000/1e6*15) = 0.027 USD * 80 = 2.16 INR = 216 paise; +20% = 259
  ok(u.cost_paise === 216 && u.bill_paise === 259, 'cost and billed amount: ' + u.cost_paise + '/' + u.bill_paise);
  ok(r.j.firms.find((x) => x.id === kc).calls === 0, 'KC LEGAL has no usage');
  r = await sa('PUT', '/api/platform/settings', { platform_key: 'sk-ant-testkey1234' }); ok(r.s === 200 && AI.apiKey(f2) === 'sk-ant-testkey1234', 'platform key is used by firms without their own');
  ok(!JSON.stringify((await sa('GET', '/api/platform/overview')).j).includes('testkey1234'), 'platform key never returned');

  // billing
  db.prepare("UPDATE ai_usage SET created_at='2026-09-15 10:00:00' WHERE tenant_id=?").run(f2);
  r = await sa('POST', '/api/platform/billing/generate', { period: '2026-09' }); ok(r.s === 200 && r.j.created.length === 1 && r.j.created[0].total_paise === 150000 + 259, 'monthly invoice = fee + AI usage: ' + JSON.stringify(r.j));
  r = await sa('POST', '/api/platform/billing/generate', { period: '2026-09' }); ok(r.j.created.length === 0, 'not generated twice');
  r = await sa('POST', '/api/platform/billing', { tenant_id: f2, amount: 5000, note: 'Setup' }); ok(r.s === 200, 'manual charge');
  let bl = (await sa('GET', '/api/platform/billing')).j; ok(bl.length === 2 && bl.every((x) => x.status === 'due'), 'two invoices due');
  r = await sa('POST', `/api/platform/billing/${bl.find((x) => x.kind === 'manual').id}/paid`, { ref: 'UPI123' }); ok(r.s === 200, 'mark paid');
  r = await t2('GET', '/api/my-plan'); ok(r.s === 200 && r.j.invoices.length === 2 && r.j.fee_paise === 150000, 'firm sees only its own plan and invoices');
  ok((await ad('GET', '/api/my-plan')).j.invoices.length === 0, 'KC LEGAL sees none of the other firm');
  // dues: auto-suspend
  await sa('PUT', `/api/platform/firms/${f2}/plan`, { autosuspend: true, grace: 1 });
  db.prepare("UPDATE sub_invoices SET due_date='2026-01-01' WHERE status='due'").run();
  await sa('PUT', `/api/platform/firms/${kc}/plan`, { autosuspend: true }); // exempt: must survive
  r = await sa('POST', '/api/platform/enforce'); ok(r.j.suspended.length === 1 && r.j.suspended[0] === 'Test Chambers', 'overdue firm suspended, owner firm exempt');
  ok((await t2('GET', '/api/me')).j.user === null || (await t2('GET', '/api/dashboard')).s === 401, 'suspended firm cannot sign in');
  await sa('PATCH', '/api/platform/firms/' + f2, { active: true });
  r = await ad('GET', '/api/onboarding'); ok(r.s === 200 && r.j.total === 8, 'onboarding checklist');

  // ---- books
  const c1 = db.prepare("INSERT INTO clients(tenant_id,name) VALUES (?,?)").run(kc, 'A Client').lastInsertRowid;
  db.prepare("INSERT INTO invoices(tenant_id,client_id,inv_no,inv_date,status,total_paise) VALUES (?,?,?,?,?,?)").run(kc, c1, 'I1', '2026-05-01', 'sent', 100000);
  db.prepare("INSERT INTO payments(tenant_id,client_id,rec_no,pay_date,amount_paise,mode) VALUES (?,?,?,?,?,?)").run(kc, c1, 'R1', '2026-05-10', 40000, 'cash');
  const ce = db.prepare("INSERT INTO cash_entries(tenant_id,entry_date,kind,amount_paise,head,narration) VALUES (?,?,?,?,?,?)");
  ce.run(kc, '2026-05-10', 'in', 40000, 'Fees received', 'Receipt R1'); ce.run(kc, '2026-05-12', 'out', 5000, 'Xerox and printing', ''); ce.run(kc, '2026-05-20', 'out', 12000, 'Airtel bill', ''); ce.run(kc, '2026-06-02', 'out', 7000, 'Mystery spend', '');
  db.prepare("INSERT INTO payments(tenant_id,client_id,rec_no,pay_date,amount_paise,mode) VALUES (?,?,?,?,?,?)").run(kc, c1, 'R2', '2026-06-05', 30000, 'upi');
  db.prepare("INSERT INTO bank_txns(tenant_id,txn_date,narration,debit_paise,credit_paise,balance_paise,status,head) VALUES (?,?,?,?,?,?,?,?)").run(kc, '2026-06-06', 'ATM CHARGE', 118, 0, 29882, 'tagged', 'Bank charge');
  db.prepare("INSERT INTO bank_txns(tenant_id,txn_date,narration,debit_paise,credit_paise,status) VALUES (?,?,?,?,?,?)").run(kc, '2026-06-07', 'unknown credit', 0, 9999, 'unmatched');
  r = await ad('GET', '/api/books?fy=2026'); const bk = r.j;
  ok(r.s === 200 && bk.total_income_paise === 70000, 'income: cash receipt counted once + upi receipt: ' + bk.total_income_paise);
  const ex = Object.fromEntries(bk.expense.map((x) => [x.head, x.paise]));
  ok(ex['Stationery and printing'] === 5000 && ex['Electricity, internet and phone'] === 12000 && ex['Miscellaneous expenses'] === 7000 && ex['Bank charges and interest'] === 118, 'heads auto-classified: ' + JSON.stringify(ex));
  ok(bk.total_expense_paise === 24118 && bk.surplus_paise === 70000 - 24118, 'totals and surplus');
  ok(bk.cash_paise === 40000 - 5000 - 12000 - 7000 && bk.bank_book_paise === 30000 - 118, 'cash and bank balances: ' + bk.cash_paise + '/' + bk.bank_book_paise);
  ok(bk.receivable_paise === 100000 - 70000 && bk.unposted.n === 1 && bk.unposted.cr === 9999, 'receivable and unposted bank entries (not counted)');
  const tr = bk.trial.reduce((a, x) => [a[0] + x.dr, a[1] + x.cr], [0, 0]); ok(tr[0] === tr[1], 'trial balance balances');
  ok(bk.checks.some((x) => /not posted/.test(x.text)) && bk.checks.some((x) => /Miscellaneous/.test(x.text)), 'readiness checks raised');
  r = await ad('PUT', '/api/books/opening', { cash: 1000, bank: 500 }); ok(r.s === 200, 'opening balances'); bk.cash_paise;
  r = await ad('GET', '/api/books?fy=2026'); ok(r.j.cash_paise === bk.cash_paise + 100000 && r.j.bank_book_paise === bk.bank_book_paise + 50000, 'opening balances flow into balances');
  r = await ad('POST', '/api/books/heads', { name: 'Gifts', grp: 'expense', keywords: 'mystery' }); ok(r.s === 200, 'custom head');
  r = await ad('GET', '/api/books?fy=2026'); ok(r.j.expense.some((x) => x.head === 'Gifts' && x.paise === 7000) && !r.j.expense.some((x) => x.head === 'Miscellaneous expenses'), 'new keyword re-classifies old entries');
  r = await ad('GET', '/api/books?from=2026-06-01&to=2026-06-30'); ok(r.j.total_income_paise === 30000 && r.j.rows.length === 3, 'custom date range');
  const x = await ad('GET', '/api/books/export.xlsx?fy=2026', null, true); const buf = Buffer.from(await x.arrayBuffer());
  ok(x.status === 200 && buf.slice(0, 2).toString() === 'PK' && /spreadsheetml/.test(x.headers.get('content-type')), 'xlsx download');
  const JSZip = require('jszip'); const z = await JSZip.loadAsync(buf); ok(Object.keys(z.files).filter((n) => /worksheets\/sheet/.test(n)).length === 7, 'seven sheets');
  r = await ad('DELETE', '/api/books/heads/' + db.prepare("SELECT id FROM acc_heads WHERE name='Rent' OR name='Office rent'").get().id); ok(r.s === 400, 'standard head cannot be deleted');
  const ac = client(); db.prepare("INSERT INTO users(tenant_id,email,name,role) VALUES (?,?,?,'telecaller')").run(kc, 'tc@kc.in', 'Tele');
  await login(ac, 'tc@kc.in', 'StrongPass123'); ok((await ac('GET', '/api/books')).s === 403, 'telecaller cannot open books');

  // ---- repository
  r = await ad('GET', '/api/repository'); ok(r.s === 200 && r.j.length >= 6 && r.j[0].cat === 'Courts' && r.j.reduce((s, c) => s + c.links.length, 0) > 40, 'repository catalog');
  ok(r.j.every((c) => c.links.every((l) => /^https:\/\//.test(l.url))), 'all links https');
  r = await ad('POST', '/api/repository', { cat: 'Courts', title: 'Alipore Court', url: 'https://example.org/a' }); ok(r.s === 200, 'add own link');
  ok((await ad('POST', '/api/repository', { cat: 'X', title: 'Bad', url: 'javascript:alert(1)' })).s === 400, 'non-http link refused');
  const key = (await ad('GET', '/api/repository')).j[0].links[0].key; await ad('POST', '/api/repository/hide', { key, hidden: true });
  r = await ad('GET', '/api/repository'); ok(r.j[0].links[0].hidden === true && r.j[0].links.some((l) => l.title === 'Alipore Court' && !l.std), 'hide standard, keep own');
  ok((await ad('POST', '/api/repository/hide', { key: 'nope', hidden: true })).s === 400, 'unknown key refused');
  ok((await (async () => { const o = client(); await login(o, 'tara@test.in', 'StrongPass123'); return (await o('GET', '/api/repository')).j[0].links[0].hidden; })()) === false, 'hiding is per firm');
  const cl = client(); const cu = db.prepare("INSERT INTO users(tenant_id,email,name,role,client_id) VALUES (?,?,?,'client',?)").run(kc, 'cl@x.in', 'Cli', c1); await login(cl, 'cl@x.in', 'StrongPass123'); ok((await cl('GET', '/api/repository')).s === 403, 'clients cannot open the repository');

  // ---- consents
  r = await ad('POST', '/api/consents', { client_id: c1, purposes: ['Contacting me by WhatsApp / SMS', 'Birthday and festival greetings'], mode: 'written' }); ok(r.s === 200, 'consent recorded');
  r = await ad('GET', '/api/consents'); ok(r.j.rows.length === 2 && r.j.without === 0, 'consents listed');
  db.prepare("INSERT INTO cal_birthdays(tenant_id,name,month,day,client_id) VALUES (?,?,?,?,?)").run(kc, 'A Client', 1, 1, c1);
  await ad('POST', `/api/consents/${r.j.rows.find((x) => /WhatsApp/.test(x.purpose)).id}/withdraw`); await ad('POST', `/api/consents/${r.j.rows.find((x) => /Birthday/.test(x.purpose)).id}/withdraw`);
  ok(db.prepare('SELECT wa_optout FROM clients WHERE id=?').get(c1).wa_optout === 1 && db.prepare('SELECT active FROM cal_birthdays WHERE client_id=?').get(c1).active === 0, 'withdrawal stops WhatsApp and greetings');
  ok((await ad('POST', '/api/consents', { client_id: 99999, purposes: ['x'] })).s === 400, 'consent needs a real client');

  // ---- follow-ups
  db.prepare("INSERT INTO leads(tenant_id,name,phone,stage,callback_at) VALUES (?,?,?,?,?)").run(kc, 'Lead One', '9830000000', 'contacted', '2020-01-01 10:00');
  db.prepare("INSERT INTO matters(tenant_id,client_id,file_no,title,status) VALUES (?,?,?,?,'open')").run(kc, c1, 'KC/M/1/2026', 'Open matter');
  r = await ad('GET', '/api/followups'); ok(r.s === 200 && r.j.leads.some((l) => l.name === 'Lead One' && l.overdue) && r.j.nodate.length === 1 && r.j.dues.length === 1, 'follow-up worklist: ' + JSON.stringify([r.j.leads.length, r.j.nodate.length, r.j.dues.length]));
  r = await ad('GET', '/api/home-extra'); ok(r.s === 200 && r.j.books && r.j.books.month, 'home extras');
  console.log(`v4: ${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
