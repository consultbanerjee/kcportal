# v6.0 — Practice management release (cumulative; includes everything up to v5.x)

All features are generic and work for every firm on the white-label portal.

## New
- **Time and billing**: log hours per case, live start/stop timer (with rounding), filters, report, per-firm and per-user hourly rates, and "Bill selected" which turns unbilled time into an invoice.
- **Conflict check**: search a name against clients, leads, cases (opposite party, title) and the register before taking a new matter; history for admins; details hidden for cases the user cannot access.
- **Global search** (`/api/gsearch`): one box across clients, cases, invoices, papers and more, respecting each user's access.
- **Case pipeline board**: cases by stage (New + six stages).
- **Full firm export**: Admin downloads all firm data as one Excel file (audited).
- **Plan page for firms**: modules, usage against limits, provider invoices.
- **Plan limits**: Super Admin can set max users and max clients per firm; the portal enforces them.
- Super Admin: "Time and billing" module and plan fields added to firm form and overview.

## Fixed
- Firm Plan page was broken in production (route lived in a Super-Admin-only script).
- Removed stale readable copies of private view scripts from `public/`.
- Service-worker cache bumped to kc-shell-v60.

## Tests
All 29 suites pass (e2e 206, v6 61, v5 85, v4 63, advocate 50, and the rest).
