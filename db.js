'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'KC', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL DEFAULT 'firm', active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL, name TEXT NOT NULL, phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('superadmin','admin','advocate','staff','telecaller','accounts','client')),
  client_id INTEGER, pass_hash TEXT, active INTEGER NOT NULL DEFAULT 1,
  invite_token TEXT, invite_expires TEXT, failed_logins INTEGER DEFAULT 0, locked_until TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, email));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
  address TEXT, notes TEXT, lead_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS matters (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER NOT NULL REFERENCES clients(id),
  file_no TEXT NOT NULL, title TEXT NOT NULL, forum TEXT, case_no TEXT, opposite_party TEXT,
  stage TEXT, status TEXT NOT NULL DEFAULT 'open', assigned_to INTEGER, summary TEXT,
  client_visible_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, file_no));

CREATE TABLE IF NOT EXISTS hearings (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER NOT NULL REFERENCES matters(id),
  hearing_date TEXT NOT NULL, purpose TEXT, outcome TEXT, next_date TEXT, source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER, client_id INTEGER,
  name TEXT NOT NULL, category TEXT, storage TEXT NOT NULL DEFAULT 'local', storage_ref TEXT NOT NULL,
  mime TEXT, size INTEGER, uploaded_by INTEGER, client_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER, title TEXT NOT NULL,
  details TEXT, assigned_to INTEGER, assigned_by INTEGER, due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS task_notes (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, task_id INTEGER NOT NULL REFERENCES tasks(id),
  user_id INTEGER, note TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS counters (
  tenant_id INTEGER NOT NULL, kind TEXT NOT NULL, year INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id, kind, year));

CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, ref_no TEXT, matter_id INTEGER, client_id INTEGER,
  to_name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER, approved_by INTEGER, sent_at TEXT, client_visible INTEGER NOT NULL DEFAULT 0,
  read_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS dak (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, ref_no TEXT, received_on TEXT NOT NULL,
  from_name TEXT NOT NULL, subject TEXT NOT NULL, matter_id INTEGER, assigned_to INTEGER,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS notings (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER NOT NULL, user_id INTEGER,
  note TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, matter_id INTEGER, client_id INTEGER,
  from_user INTEGER NOT NULL, to_user INTEGER, body TEXT NOT NULL, read_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER, phone TEXT, direction TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text',
  template TEXT, body TEXT, wa_id TEXT, status TEXT NOT NULL DEFAULT 'queued', error TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_wa_client ON wa_messages(tenant_id, client_id, id);
CREATE INDEX IF NOT EXISTS idx_wa_waid ON wa_messages(wa_id);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  source TEXT, issue TEXT, stage TEXT NOT NULL DEFAULT 'new', assigned_to INTEGER, callback_at TEXT,
  lost_reason TEXT, client_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS lead_notes (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, user_id INTEGER,
  outcome TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS consult_types (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT NOT NULL, minutes INTEGER NOT NULL,
  fee_paise INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS consult_fees (
  tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, consult_type_id INTEGER NOT NULL, fee_paise INTEGER NOT NULL,
  PRIMARY KEY(user_id, consult_type_id));
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, lead_id INTEGER, client_id INTEGER,
  name TEXT NOT NULL, phone TEXT, email TEXT, issue TEXT, advocate_id INTEGER NOT NULL,
  consult_type_id INTEGER NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'video', meet_link TEXT, fee_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment', pay_ref TEXT, hold_until TEXT,
  created_by TEXT NOT NULL DEFAULT 'client', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_appt_slot ON appointments(tenant_id, advocate_id, start_at);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER NOT NULL, matter_id INTEGER,
  inv_no TEXT NOT NULL, inv_date TEXT NOT NULL, due_date TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft', total_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, inv_no));

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1, rate_paise INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER NOT NULL, invoice_id INTEGER,
  rec_no TEXT NOT NULL, pay_date TEXT NOT NULL, amount_paise INTEGER NOT NULL, mode TEXT NOT NULL,
  reference TEXT, notes TEXT, bank_txn_id INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, rec_no));

CREATE TABLE IF NOT EXISTS cash_entries (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, entry_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('in','out')), amount_paise INTEGER NOT NULL,
  head TEXT NOT NULL, narration TEXT, client_id INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS bank_txns (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, txn_date TEXT NOT NULL, narration TEXT,
  ref TEXT, debit_paise INTEGER NOT NULL DEFAULT 0, credit_paise INTEGER NOT NULL DEFAULT 0,
  balance_paise INTEGER, matched_payment_id INTEGER, matched_client_id INTEGER,
  status TEXT NOT NULL DEFAULT 'unmatched', created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS bank_imports (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, filename TEXT, source TEXT NOT NULL DEFAULT 'pdf',
  status TEXT NOT NULL DEFAULT 'processing', pages_total INTEGER DEFAULT 0, pages_done INTEGER DEFAULT 0,
  added INTEGER DEFAULT 0, duplicates INTEGER DEFAULT 0, message TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bank_import_errors (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, import_id INTEGER, raw TEXT, reason TEXT,
  resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bank_rules (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, alias TEXT NOT NULL, party_kind TEXT NOT NULL, party_id INTEGER, party_name TEXT, head TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, alias));

CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, court TEXT NOT NULL, case_no TEXT, title TEXT NOT NULL,
  judge TEXT, decided_on TEXT, citation TEXT, subject TEXT, summary TEXT, source_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual', doc_id INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, tenant_id INTEGER, user_id INTEGER, action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER, detail TEXT, ip TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);


// ---------- migrations for databases created by earlier versions ----------
(function migrate() {
  const cols = db.prepare('PRAGMA table_info(tenants)').all().map((c) => c.name);
  if (!cols.includes('kind')) db.exec("ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'firm'");
  if (!cols.includes('active')) db.exec('ALTER TABLE tenants ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  const usersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() || {}).sql || '';
  if (usersSql && !usersSql.includes("'superadmin'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      const ns = usersSql.replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?users"?/i, 'CREATE TABLE users_new').replace(/CHECK\s*\(\s*role\s+IN\s*\(\s*'admin'/i, "CHECK(role IN ('superadmin','admin'");
      if (!ns.includes("'superadmin'") || !ns.includes('users_new')) throw new Error('users table migration: unexpected schema');
      db.exec(ns);
      db.exec('INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users;');
    })();
    db.pragma('foreign_keys = ON');
  }
})();
db.exec(`
CREATE TABLE IF NOT EXISTS firm_settings (tenant_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (tenant_id, key));
CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, feature TEXT NOT NULL, in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_drafts (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT, instruction TEXT,
  output TEXT, notes TEXT, files TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, lead_id INTEGER, name TEXT, phone TEXT, email TEXT,
  needs_human INTEGER NOT NULL DEFAULT 0, msg_count INTEGER NOT NULL DEFAULT 0, ip TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mail_messages (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, message_id TEXT, from_addr TEXT, from_name TEXT, subject TEXT, body TEXT, refs TEXT,
  received_at TEXT, category TEXT, urgency TEXT, needs_human INTEGER NOT NULL DEFAULT 0, summary TEXT, status TEXT NOT NULL DEFAULT 'new', lead_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (tenant_id, message_id));
CREATE TABLE IF NOT EXISTS mail_replies (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, mail_id INTEGER, to_addr TEXT, subject TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'draft',
  send_at TEXT, sent_at TEXT, auto INTEGER NOT NULL DEFAULT 0, error TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tenant_templates (
  tenant_id INTEGER PRIMARY KEY, settings TEXT NOT NULL DEFAULT '{}', letterhead TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Full-text search over judgments and matters
db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS judgments_fts USING fts5(title, summary, subject, judge, case_no, court, content='judgments', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS judgments_ai AFTER INSERT ON judgments BEGIN
  INSERT INTO judgments_fts(rowid,title,summary,subject,judge,case_no,court) VALUES (new.id,new.title,new.summary,new.subject,new.judge,new.case_no,new.court);
END;
CREATE TRIGGER IF NOT EXISTS judgments_ad AFTER DELETE ON judgments BEGIN
  INSERT INTO judgments_fts(judgments_fts,rowid,title,summary,subject,judge,case_no,court) VALUES('delete',old.id,old.title,old.summary,old.subject,old.judge,old.case_no,old.court);
END;
CREATE TRIGGER IF NOT EXISTS judgments_au AFTER UPDATE ON judgments BEGIN
  INSERT INTO judgments_fts(judgments_fts,rowid,title,summary,subject,judge,case_no,court) VALUES('delete',old.id,old.title,old.summary,old.subject,old.judge,old.case_no,old.court);
  INSERT INTO judgments_fts(rowid,title,summary,subject,judge,case_no,court) VALUES (new.id,new.title,new.summary,new.subject,new.judge,new.case_no,new.court);
END;
`);

function nextNumber(tenantId, kind) {
  const year = new Date().getFullYear();
  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO counters(tenant_id,kind,year,n) VALUES (?,?,?,0)').run(tenantId, kind, year);
    db.prepare('UPDATE counters SET n=n+1 WHERE tenant_id=? AND kind=? AND year=?').run(tenantId, kind, year);
    return db.prepare('SELECT n FROM counters WHERE tenant_id=? AND kind=? AND year=?').get(tenantId, kind, year).n;
  });
  return { n: tx(), year };
}

function audit(tenantId, userId, action, entity, entityId, detail, ip) {
  db.prepare('INSERT INTO audit_log(tenant_id,user_id,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?)')
    .run(tenantId || null, userId || null, action, entity || null, entityId || null, detail ? String(detail).slice(0, 500) : null, ip || null);
}


// ---------- Files (Explorer), Drive sync queue, client expenses ----------
db.exec(`
CREATE TABLE IF NOT EXISTS fs_nodes (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER, parent_id INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('folder','file')), name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
  storage TEXT, storage_ref TEXT, md5 TEXT, sys TEXT, client_visible INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, by_client INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT, deleted_by INTEGER, del_root INTEGER,
  drive_id TEXT, drive_name TEXT, drive_parent TEXT, drive_trashed INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1, sync_error TEXT, sync_tries INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_fs_parent ON fs_nodes(tenant_id, client_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_fs_dirty ON fs_nodes(tenant_id, dirty);
CREATE TABLE IF NOT EXISTS drive_folders (tenant_id INTEGER NOT NULL, key TEXT NOT NULL, drive_id TEXT NOT NULL, PRIMARY KEY(tenant_id, key));
CREATE TABLE IF NOT EXISTS drive_tombstones (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, drive_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL, client_id INTEGER, channel TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, manual INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_rem_inv ON reminder_log(tenant_id, invoice_id, status);

CREATE TABLE IF NOT EXISTS payees (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('advocate','staff','client','other')),
  user_id INTEGER, client_id INTEGER, phone TEXT, upi_id TEXT, bank_details TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pay_schedules (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, payee_id INTEGER NOT NULL REFERENCES payees(id),
  head TEXT NOT NULL, amount_paise INTEGER NOT NULL, frequency TEXT NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('once','weekly','monthly','quarterly','yearly')),
  next_due TEXT NOT NULL, end_date TEXT, mode TEXT NOT NULL DEFAULT 'bank', narration TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payee_payments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, schedule_id INTEGER, payee_id INTEGER NOT NULL REFERENCES payees(id),
  head TEXT NOT NULL, amount_paise INTEGER NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK(status IN ('due','paid','skipped')),
  paid_on TEXT, mode TEXT, reference TEXT, cash_entry_id INTEGER, narration TEXT, paid_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(schedule_id, due_date));
CREATE INDEX IF NOT EXISTS idx_pp_due ON payee_payments(tenant_id, status, due_date);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER NOT NULL, matter_id INTEGER,
  exp_date TEXT NOT NULL, head TEXT NOT NULL, amount_paise INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cash' CHECK(mode IN ('cash','bank','other')), reimbursable INTEGER NOT NULL DEFAULT 0,
  narration TEXT, cash_entry_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_exp_client ON expenses(tenant_id, client_id);
`);
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
if (!hasCol('ai_drafts', 'client_id')) db.exec('ALTER TABLE ai_drafts ADD COLUMN client_id INTEGER');
if (!hasCol('appointments', 'pay_claim')) db.exec('ALTER TABLE appointments ADD COLUMN pay_claim TEXT');
for (const [c, d] of [['party_kind', 'TEXT'], ['party_id', 'INTEGER'], ['party_name', 'TEXT'], ['head', 'TEXT'], ['remark', 'TEXT'], ['import_id', 'INTEGER'], ['source', 'TEXT'], ['conf', 'REAL'], ['by_ai', 'INTEGER DEFAULT 0']]) if (!hasCol('bank_txns', c)) db.exec(`ALTER TABLE bank_txns ADD COLUMN ${c} ${d}`);
for (const [c, d] of [['bank_txn_id', 'INTEGER'], ['bank_created', 'INTEGER DEFAULT 0']]) if (!hasCol('payee_payments', c)) db.exec(`ALTER TABLE payee_payments ADD COLUMN ${c} ${d}`);
if (!hasCol('clients', 'no_reminders')) db.exec('ALTER TABLE clients ADD COLUMN no_reminders INTEGER NOT NULL DEFAULT 0');
for (const [c, d] of [['gc_resource', 'TEXT'], ['gc_hash', 'TEXT'], ['gc_synced_at', 'TEXT']]) if (!hasCol('clients', c)) db.exec(`ALTER TABLE clients ADD COLUMN ${c} ${d}`);
if (!hasCol('clients', 'wa_welcomed_at')) { db.exec('ALTER TABLE clients ADD COLUMN wa_welcomed_at TEXT'); db.exec("UPDATE clients SET wa_welcomed_at='existing' WHERE phone IS NOT NULL AND phone<>''"); }
if (!hasCol('fs_nodes', 'matter_id')) db.exec('ALTER TABLE fs_nodes ADD COLUMN matter_id INTEGER');
if (!hasCol('clients', 'portal_blocked')) db.exec('ALTER TABLE clients ADD COLUMN portal_blocked INTEGER NOT NULL DEFAULT 0');
if (!hasCol('clients', 'share_blocked')) db.exec('ALTER TABLE clients ADD COLUMN share_blocked INTEGER NOT NULL DEFAULT 0');
for (const c of ['meet_event_id TEXT', 'meet_code TEXT', 'meet_note TEXT', 'rec_status TEXT', 'rec_node_id INTEGER']) if (!hasCol('appointments', c.split(' ')[0])) db.exec('ALTER TABLE appointments ADD COLUMN ' + c);
if (!hasCol('clients', 'wa_optout')) db.exec('ALTER TABLE clients ADD COLUMN wa_optout INTEGER NOT NULL DEFAULT 0');
if (!hasCol('documents', 'fs_id')) db.exec('ALTER TABLE documents ADD COLUMN fs_id INTEGER');

module.exports = { db, nextNumber, audit, DATA_DIR };

// ---- v2.3: client reference (who referred the client) and the In-Out register ----
if (!hasCol('clients', 'reference')) db.exec('ALTER TABLE clients ADD COLUMN reference TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS register (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('in','out')), no TEXT NOT NULL,
  entry_date TEXT, entry_time TEXT, party TEXT, their_ref TEXT, subject TEXT, enclosures TEXT, dept TEXT, action TEXT,
  signature TEXT, remarks TEXT, reply_to TEXT, mode TEXT, tracking TEXT, client_id INTEGER, matter_id INTEGER,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, kind, no));
CREATE INDEX IF NOT EXISTS idx_reg_client ON register(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_reg_kind ON register(tenant_id, kind, entry_date);`);
// the old inward book (dak) moves into the register once
if (!db.prepare("SELECT 1 FROM firm_settings WHERE key='reg_dak_moved'").get()) {
  for (const d of db.prepare('SELECT * FROM dak ORDER BY id').all()) {
    const m = d.matter_id ? db.prepare('SELECT client_id FROM matters WHERE id=?').get(d.matter_id) : null;
    db.prepare("INSERT OR IGNORE INTO register(tenant_id,kind,no,entry_date,party,subject,matter_id,client_id,action,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(d.tenant_id, 'in', d.ref_no || ('IN-' + d.id), d.received_on, d.from_name, d.subject, d.matter_id, m ? m.client_id : null, d.status === 'actioned' ? 'Actioned' : 'Open', d.created_at);
  }
  db.prepare("INSERT OR REPLACE INTO firm_settings(tenant_id,key,value) SELECT id,'reg_dak_moved','1' FROM tenants").run();
  db.prepare("INSERT OR IGNORE INTO firm_settings(tenant_id,key,value) VALUES (0,'reg_dak_moved','1')").run();
}

// ---- v2.5: chat tickets, signed-in client live chat ----
for (const c of ['unresolved INTEGER NOT NULL DEFAULT 0', 'address TEXT', "kind TEXT NOT NULL DEFAULT 'public'", 'client_id INTEGER', 'user_id INTEGER', 'ticket_id INTEGER', 'matched_client_id INTEGER']) if (!hasCol('chat_sessions', c.split(' ')[0])) db.exec('ALTER TABLE chat_sessions ADD COLUMN ' + c);
db.exec(`CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, session_id INTEGER, client_id INTEGER, lead_id INTEGER,
  source TEXT NOT NULL DEFAULT 'website chat', name TEXT, phone TEXT, email TEXT, address TEXT,
  subject TEXT, summary TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open',
  existing_client TEXT, staff_note TEXT, assigned_to INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_tk_tenant ON tickets(tenant_id, status, created_at);`);

if (!hasCol('invoices', 'subject')) db.exec('ALTER TABLE invoices ADD COLUMN subject TEXT');

if (!hasCol('invoices', 'share_token')) db.exec('ALTER TABLE invoices ADD COLUMN share_token TEXT');
if (!hasCol('invoices', 'sent_at')) db.exec('ALTER TABLE invoices ADD COLUMN sent_at TEXT');
if (!hasCol('invoices', 'recurring_id')) db.exec('ALTER TABLE invoices ADD COLUMN recurring_id INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS recurring_invoices (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, client_id INTEGER NOT NULL, matter_id INTEGER, name TEXT, subject TEXT, notes TEXT,
  items TEXT NOT NULL, every_n INTEGER NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT 'month', next_date TEXT NOT NULL, end_date TEXT,
  due_days INTEGER NOT NULL DEFAULT 0, auto_send INTEGER NOT NULL DEFAULT 0, send_email INTEGER NOT NULL DEFAULT 1, send_whatsapp INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', last_run TEXT, runs INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invoice_send_log (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, error TEXT, auto INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token ON invoices(share_token) WHERE share_token IS NOT NULL;`);

for (const [col, def] of [['status', "TEXT DEFAULT 'ready'"], ['error', 'TEXT'], ['page', 'TEXT'], ['profile', 'TEXT'], ['doc_ids', 'TEXT'], ['annexures', 'TEXT'], ['built', 'TEXT'], ['share_token', 'TEXT'], ['share_expires', 'TEXT'], ['share_files', 'TEXT'], ['last_number', 'INTEGER']]) {
  try { db.exec(`ALTER TABLE ai_drafts ADD COLUMN ${col} ${def}`); } catch (e) { /* already there */ }
}
