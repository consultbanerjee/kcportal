# KC LEGAL Portal — v5.0 (11 November 2026)
Control-plane and protection release. Cumulative: upload everything in the release zips.

## For the owner (Super Admin)
- **Services matrix** (Firms → Services): one platform master switch and one switch per firm for every running-cost service — Claude AI, AI drafting, case arguments, e-mail assistant, website chat, court data, WhatsApp, outgoing e-mail, payment reminders, Google (Drive/Calendar/Meet/Contacts). New firms start with everything OFF. KC LEGAL keeps what it had (AI drafting, e-mail assistant and website chat stay OFF until you switch them on).
- **Configure a firm** (Firms → Configure): all set-up that used to sit in the firm's Settings now lives here — Claude key/models/drafting rules, Titan/IMAP mailbox, website chat, court-data key, WhatsApp (Meta), payment reminders, Google Drive/Contacts, nightly case-argument automation, birthday greetings, holiday list, weather city.
- **Build Journal** (Super Admin → Build Journal): what the portal is, how it is built, what is used where, running-cost register (live Claude and court-data cost), how to operate it, security, versions and your own dated notes. Download as Word or PDF.
- Optional two-step sign-in (authenticator app) from Account for every user.

## For a firm's administrator
- Settings → **Who can use what**: share each active service with advocates, staff, telecallers, accountants. Nothing else about AI, mail, WhatsApp, court data, storage or automation is visible.
- Start page: live India time, date and local weather, new look.

## Protection
- All set-up paths answer "not found" to firm users (server-side), the Super Admin reaches a firm only through an allow-list of set-up paths (no client data), every change audited.
- Application scripts are no longer public: only the sign-in shell is. Other scripts load after sign-in; Super Admin scripts only for the Super Admin.
- Production build (two-stage Dockerfile): terser + javascript-obfuscator on all browser scripts; the running image holds no readable browser source, tests or notes.
- Production-only blocking of scraping tools, per-session/per-address rate limits, noindex + robots, extra security headers, no caching of API answers or private scripts.

## Deploy
`cd /opt/kcportal && git checkout -- . ; git pull ; docker compose up -d --build` (the first build takes a few minutes longer because of the protection step).
After deploy: Super Admin → Firms → Services → switch on what KC LEGAL needs (AI drafting etc.), then Configure → Claude AI to add the Anthropic key.

## Tests
v4 63, e2e 206, v5 85, logins 4, plus calendar, contacts, drive, meet, whatsapp, reminders, invsend, upi, payees, bank, register, aidraft, chatbot, news — all passing; obfuscated build click-through clean.
