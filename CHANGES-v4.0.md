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

## v4.5 — AI Drafting: Word + PDF buttons, rules kept in step with Claude
- Draft page: "Save as Word (.docx)" and "Save as PDF" buttons download the draft instantly (edits saved first). "Prepare files" still makes the full set with annexure PDFs and files a copy in the client's Drafts folder.
- KC LEGAL's standing drafting rules (signatory, ANNEXURE P-n marking and order, HC / DRT formats, page-size rule, writ structure, Hindi, lease interest, no case numbers in writs) brought in line with the instructions given to Claude; used whenever the firm has not typed its own rules in AI Control → Drafting rules.
- Left menu: all groups start closed after every login (a group you open stays open until you next sign in); cache kc-shell-v34.
- v4.5 Alerts (Settings → Alerts, firm Admin): the portal tests itself every week and lists each fault with severity, area and a "Go there" link. Checks: duplicate / mis-spelt clients, clients without contact, no cases entered, invoice number jumps, old drafts, paid-but-short, totals not matching items, unmatched bank entries, missing letterhead / signature / bank details / QR, Google Drive not connected, AI key and mailbox login, failed drafts, un-accepted invitations, dead Repository links, database integrity, disk space, website certificate. The Admin ticks "Action taken"; a fault that vanishes clears itself, one still present at the next test reopens marked "came back". Count badge on the menu and a card on Home. "Run the test now" button. Cache kc-shell-v35.

## v4.6 — Court data (eCourts) and the case file copy
- **Court search** (Litigation → Court search): by CNR, party, advocate, judge or act/words; filters by state and court level; open the full record; add to Cases (creates the case and fills case no., court, opposite party, stage) or link to an existing case.
- **Case page → Court record**: status, next date, orders, hearing history; "Update now", "Tell the client" (writes the position into the client-visible note), unlink.
- **Cause list** (Litigation → Cause list): "my cases listed" check plus court-wise search.
- **Litigation check** on a party (paid lookup), orders: view, download, AI summary.
- **Daily update at 2 am IST** for all linked open cases; a task is created when the next date, status or orders change. If the server was off at 2 am it runs when it is back the same day.
- **Copy kept in Files**: in the client's *Judgements / <file no.>* folder the portal keeps "Court record - <file no>.pdf" (dates, parties, hearing history, list of orders; rewritten only when something changed) and every order as `Order1_dd-mm-yyyy.pdf`, `Order2_…` (date of the order; numbers follow date order the first time and never change afterwards). Orders you delete from Files are not downloaded again. Failed downloads are retried the next night. Switch: Settings → Court data → "Keep a copy in Files". Button "Save to Files now" on the case page.
- Settings → Court data (key, usage, daily limit); Super Admin: per-firm switch, platform master switch and platform key.
- Service worker cache kc-shell-v37.

## v4.7 — Arguments and Drawbacks for every case
- Case page → **Arguments and drawbacks** (page `#/args/<case>`): the portal reads every document in the case's folder (petition, annexures, orders, saved judgments, court record), finds the prayer, researches judgments on the web, and prepares (1) the **Argument Note** supporting the prayer and (2) a separate **Drawbacks Note** (weak points, what the other side will argue, adverse authorities, gaps, pre-hearing checklist). Side by side, each with **Word** and **PDF** download and an in-page reader.
- Authorities: found with web search, then each page is fetched from trusted legal sites only (indiankanoon, *.gov.in, *.nic.in, livelaw, verdictum, barandbench, casemine) and checked against the case name and year. Only checked cases are cited without a warning; unchecked ones carry "[verify before citing]". Supporting judgments that pass are saved in Files → Judgements → <file no.> → Authorities as "Party vs Party _ dd-mm-yyyy.pdf".
- Copies of both notes go to Files → Arguments → <file no.> (dated; Word and PDF; not shared with the client).
- **Every night at 3 am** (after the 2 am court update) each open case is refreshed only if something changed (new document, order, date, status or instruction), up to 8 cases per firm per night (setting `args_daily_cap`). Per case switch: "Update this case every night". Firm switch `args_auto`; research switch `args_research`; model `ai_args_model` (falls back to the drafting model).
- Uses the firm's drafting rules (KC_RULES) and the page profile of the forum (HC / tribunal / court).

## v4.7 (continued) — Case history, and Word + PDF everywhere
- **Case history** (case page): a dated, precise chronology (particulars, brief facts, present position, every hearing and order, pending work, documents on file) as **Word** or **PDF**; "Keep a copy in Files" stores both in Files → Case history and refreshes them every night (4 am) and after each court update.
- **House rule: every download offers Word and PDF** (except Accounts). Added: court record (Word + PDF; Word copy also kept in Files beside the PDF), In-Out Register (beside CSV), client chat record and portal-activity record (Admin only), letters (on the letter pad). Already both: AI drafts, Arguments, Drawbacks. Court orders and uploaded files stay as originals.
- eCourts usage estimates now use the published pay-as-you-go prices (case ₹1.50, order ₹3.75, order+AI ₹7.50, refresh ₹0.15, cause list ₹3.00, search ₹0.60).
- Cumulative: this package contains v4.5 and v4.6 as well; install it in one go over the live v4.4. Service worker cache kc-shell-v39.

## v4.7 (research rules)
- **Indian law only**: the research uses web search restricted to Indian legal sites (indiankanoon, *.gov.in, *.nic.in, livelaw, verdictum, barandbench); foreign courts are rejected.
- **Tribunal cases** (DRT, NCLT, NCLAT, consumer, ITAT etc.): the same tribunal's own earlier decisions are searched first and listed first; then High Courts and the Supreme Court.
- **Precedents relied on in the papers** are identified, read, and each is checked for overruling, reversal, setting aside, doubting, distinguishing. A new card on the Arguments page ("Precedents relied on in this case") marks the status; if one is overruled the Argument says so, the later decision is read and saved, and a further route ("way forward") is researched. The Drawbacks note treats it as a high risk.
