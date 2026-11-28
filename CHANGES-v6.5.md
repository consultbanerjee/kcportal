# v6.5 (27 November 2026): case law reader

## New (every firm)
- **Judgment preview on the right** of the Research Desk > Case law results, with tabs on top: Download Word, Download PDF, Marked Word / Marked PDF (once something is marked), Bookmark, Save to a case, **Save in client folder** (goes into the client's Judgements folder; Word or PDF, plain or with the reader's marks).
- **Instrument panel**: pen (underline) in deep red, green, navy blue, black; highlighter in fluorescent green, yellow, orange, blue; eraser (drag, or click a marked place); undo, redo, clear all. Marks are saved per person per judgment.
- **Note window** under the preview: date and time stamp can be switched on or off (a stamp starts each new line when on; an "Add stamp" button works when off). Draft is kept on the device; "Save note" keeps it in My research, "Save note in client folder" files a Word note in the client's Judgements folder.

## Super Admin
- **Dashboard** is the Super Admin home page: six compact boxes — date and time (live, India time), disk space (ring, Drive bar, 3-day graph), server (load, memory, graphs and numbers), expiry and renewals, recurring usage and bills (Claude usage this month, firm invoices), case law engine status. Refreshes every minute.
- Fixed: the Activity log link was being sent back to Settings for the Super Admin.
- Case law engine is now in the left panel.
- "Firms and services" and "Activity log" joined into one **Settings** section (Activity log is a tab).

## Technical
- New routes: marks (GET/PUT), annotated download (POST), to-client, note-to-client under /api/research/caselaw. exportdoc.js can draw highlight / underline marks into PDF and Word.
- New table cl_marks. Service-worker cache kc-shell-v65. test/v65.js added; route lock updated.
