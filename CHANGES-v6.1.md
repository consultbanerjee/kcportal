# v6.1 (built on v6.0; includes the v5.3 Filing forums work)

## New: Search (Ctrl/Cmd+K, or the Search button in the top bar; full page at #/find)
One box that searches everything the signed-in user is allowed to see: cases, clients, hearings, notings, tasks, letters, dak register, leads and lead notes, appointments, invoices, files, documents, saved judgments, own saved research, the repository links and the filing forums.
- Every word must match (partial words work); if nothing matches, it retries with any word and says so.
- Results are grouped, ranked (title > sub-title > body, exact title first) and highlighted, with a snippet around the hit.
- Respects roles, assigned/team cases, per-role module switches and Super Admin module switches. Clients and Super Admin cannot use it. Firms never see each other's data.
- Save a search (up to 30 per user); recent searches are kept in the browser.
- Wildcards and SQL characters are escaped. API: GET /api/find, GET/POST /api/find/saved, DELETE /api/find/saved/:id.

## New: Filing forums (#/forums), from v5.3
Catalog of 18 West Bengal courts, tribunals and forums with e-filing portal, file limits, signing and payment rules; firms can add their own. Super Admin module switch "efiling". Passwords are not stored: filing is done in an assisted session where the advocate does the captcha, OTP, DSC and payment.

## New: Prepare for filing (on the Filing forums page)
Choose PDFs, order them, name each one, pick the forum. You get one filing set with an index page, bookmarks and page numbers, shrunk or split to the forum's size limit. For forums that judge each document alone (DRT), files are checked one by one and not joined.
- Ghostscript is now installed in the Docker image (Dockerfile). Without it the set is split instead of compressed.
- Nothing is kept on disk; results wait in memory for 20 minutes, per user.
- PDF/A conversion and digital signing are not done (the screen says so for NCLT).
- API: POST /api/filing-prep (multipart), GET /api/filing-prep/:token/:n.

## Other
- Tests added: test/finder.js (48), test/filingprep.js (17). Full suites pass.
- Known leftover: public/views-*.js are old readable copies; they are not in the Docker image. You can delete them from the repo.
