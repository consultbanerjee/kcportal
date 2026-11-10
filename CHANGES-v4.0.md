# v4.0 — white-label eOffice

Super Admin: plans and module switches per firm, Claude on/off (per firm and platform), token and cost meter with editable rates,
subscription invoices, dues and auto-suspend (owner firm exempt), platform API key.
Accounts: automatic heads, income and expenditure, statement of affairs, trial balance, month-wise heads, ageing, payables,
bank reconciliation, Excel workbook, printable audit pack with blank audit-report format, opening balances.
Also: Repository, client consent records, follow-up worklist, limitation calculator, Titan Mail button, onboarding checklist,
home dashboard cards, firm-prefix matter numbers. KC LEGAL data and settings are untouched (additive migrations only).
Tests: node test/v4.js (61 checks) plus all earlier suites.

## v4.2 — Login for everyone
- Single "Login" page for all roles; each user is taken to their own pages after sign-in.
- Per-firm login link: `/#/login?firm=<slug>` shows that firm's name and limits sign-in to that firm.
- If one email belongs to more than one firm, the user is asked which firm to open.
- "Forgot password": emailed link valid 30 minutes (uses the firm's own mailbox); same reply for known and unknown emails; resetting also clears lockouts.
- Service worker cache bumped to kc-shell-v27.
