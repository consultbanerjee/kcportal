# v6.2 (24 November 2026): repair release, built on GitHub main (v6.1)

## Fixed
- **Case law engine restored for the Super Admin** (Super Admin > Firms > "Case law engine" tab, and its API under /api/platform/caselaw/engine). It was added in v5.4 and lost when v6.0 was uploaded over it. Court switches, collect level, daily update hour, run/pause/stop and progress all work again.
- **Build Journal**: releases now in version order; the missing v5.4 and v6.0 entries added; v5.1.2, v5.2 and v5.3 no longer change their date with every release; one "this release" marker only.
- Service-worker cache bumped to kc-shell-v62 so phones pick up the change.

## New: "must still work" check
`npm run check` (test/mustwork.js). It compares every API route and screen against test/routes.lock.json (490 entries, drawn from the last 60 commits) and stops the release if anything an earlier release had is missing. It also checks the Case law engine wiring, the private-script manifest, Build Journal order and version, and that the deploy files are present.
- Run it before every release. After adding features on purpose: `node test/mustwork.js --update` (adds only; removing a feature needs `--allow-remove` and the owner's say-so).

## Tests
All 32 suites pass (e2e 206, v6 61, v5 85, v54 13, finder 50, filingprep 17, and the rest). Must-still-work check passes; confirmed it fails when the engine is removed.

## Not changed
Plan and usage page: it lives in private/views-v6.js since v6.0 and is the better version; the old copy in sa-core.js stays removed.
