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
  prefix TEXT NOT NULL DEFAULT 'KC', created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL, name TEXT NOT NULL, phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','advocate','staff','telecaller','accounts','client')),
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

CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, court TEXT NOT NULL, case_no TEXT, title TEXT NOT NULL,
  judge TEXT, decided_on TEXT, citation TEXT, subject TEXT, summary TEXT, source_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual', doc_id INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, tenant_id INTEGER, user_id INTEGER, action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER, detail TEXT, ip TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
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

module.exports = { db, nextNumber, audit, DATA_DIR };
