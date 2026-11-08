# KC LEGAL portal

Client, office and admin portal: matters & case record, documents (clients can add, never alter), tasks, eOffice letters/inward register,
messages, CRM + telecaller, paid online-consultation booking, billing (invoices, receipts, cash book, bank-statement import, ledgers,
final accounts) and judgments search. Node 22 + SQLite, one container, HTTPS by Caddy.

## First deployment (Hostinger VPS, Ubuntu 24.04 with Docker)
1. DNS: add an **A record** `portal` → the VPS IP at the DNS host of kclegal.us.
2. On the server:  `git clone <private repo> /opt/kcportal && cd /opt/kcportal && cp .env.example .env && nano .env`
3. `docker compose up -d --build`
4. `docker compose logs portal | grep -A2 FIRST-TIME` → open that one-time link to set the administrator password.
5. Nightly backup: `crontab -e` → `0 2 * * * /opt/kcportal/backup.sh`  (copy `backups/` off the server regularly).

## Update
`git pull && docker compose up -d --build` — data lives in `./data` and survives.

## Tests
`npm test` (end-to-end API tests, 87 checks) — uses a temporary database.
