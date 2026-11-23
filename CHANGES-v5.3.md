# KC LEGAL Portal v5.3 — Filing forums (generic, for every firm)

- New menu item **Filing forums** (module switch "Filing forums (e-filing guide)" in Super Admin plans).
- Catalogue of 18 West Bengal forums: Calcutta High Court, district courts, DRT/DRAT, NCLT, NCLAT, GSTAT Kolkata, consumer commissions, WBRERA,
  WBAT, WB Taxation Tribunal, and 8 forums marked "to verify". Each shows portal, login, signing, largest file, fees, notes and an assist level.
- Each firm can add its own forums (stored per firm; other firms never see them).
- PDF size check per forum, done in the browser; nothing is uploaded.
- No passwords are stored. Filing is an assisted session: the advocate logs in, signs and pays; the portal prepares and checks PDFs.

Files: assets/forums-wb.json, routes/efiling.js, private/views-forums.js, private/manifest.json, public/app.js, routes/superadmin.js, server.js.
