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

## v4.3 — Repository and login page
- Repository is now a dropdown group (orange heading, white items) with one page per section; "All sections" shows everything with search.
- New sections: All High Courts (25 + judgment search), Forums (consumer, ADR, ombudsman, grievance), Authorities and commissions, Parliament and Legislatures, International courts (with / without link to India), Government repositories, Newspapers (world, India).
- Tribunals now include CGIT-cum-Labour Courts, West Bengal Industrial Tribunals and Labour Courts, WB Administrative Tribunal, WBREAT, Armed Forces Tribunal, Railway Claims Tribunal. Courts section unchanged.
- "Free eLibrary and research" renamed "eLibrary & Research"; "Government services" split into Central Government Services and West Bengal Government Services (firm-hidden links carried over).
- Login page: explanatory paragraph and booking link removed.
- Repository self-checks: every 7 days the server visits each link (and each firm's own links). A link that fails twice in a row is flagged "link may be down"; a permanent redirect to a new address is followed and the new address is used automatically. Sites that block automatic visitors are treated as alive. The Admin can press "Check now"; the last check date shows on every Repository page. New list entries still arrive with portal releases.

## v4.4 — Payment QR on invoices
- Document design (Settings): new "Payment QR" upload beside Letterhead, Logo and Signature (JPG/PNG, up to 2 MB, admin only; remove any time).
- Invoices (screen, print, PDF and the client's public pay link) print the QR between the bank details and the signature, with an optional caption (default "Scan to pay"). One-page layout kept.
- Design page regrouped: Firm documents · Header · Colours & font · Page & margins · Titles & signatory · Payment details (bank, PAN, QR caption, footer note) · Terms & conditions.
- Service worker cache kc-shell-v32.
- v4.4b: payment area now has four titled items (heading + description, e.g. Bank Details, PAN, UPI, GSTIN) printed to the left of the QR; old bank-details/PAN entries carry over automatically. Option "Hide the address line at the bottom of invoices" (on for KC LEGAL; letters keep the full letter pad).
