'use strict';
/* "Must still work" check. Run before every release:  npm run check
   It fails if a feature that existed in an earlier release has gone missing (the way v6.0 once removed the v5.4 Case law engine).
   - test/routes.lock.json lists every API route and every screen the portal has had. A release may ADD to it, never lose from it.
   - After adding features on purpose:  node test/mustwork.js --update   (this only adds; removals need --allow-remove and the owner's say-so)
   Needs no database or network. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), lockFile = path.join(__dirname, 'routes.lock.json');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const ls = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.js')).map((f) => d + '/' + f);

let bad = 0; const fail = (m) => { bad++; console.log('  FAIL  ' + m); };

// 1. collect what the code offers today
const now = new Set();
for (const f of [...ls('routes'), 'server.js']) {
  const s = rd(f);
  for (const m of s.matchAll(/app\.(get|post|put|patch|delete)\(\s*(['"`])(\/[^'"`]*)\2/g)) now.add(`${m[1].toUpperCase()} ${m[3]}`);
}
for (const f of ls('private')) {
  for (const m of rd(f).matchAll(/^route\(\/\^(\\\/[^\n]*?)\$\//gm)) now.add('SCREEN ' + m[1].replace(/\\\//g, '/'));
}
// tabs of the Super Admin page
for (const m of rd('private/sa-core.js').matchAll(/const SAT = \[(.*?)\];\n/gs)) for (const t of m[1].matchAll(/\['(\w+)'/g)) now.add('SATAB ' + t[1]);

// 2. compare with the lock file
const args = process.argv.slice(2);
let lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : [];
const lost = lock.filter((x) => !now.has(x));
if (args.includes('--update')) {
  if (lost.length && !args.includes('--allow-remove')) { console.log('Missing from the code (not updating):\n  ' + lost.join('\n  ')); process.exit(1); }
  fs.writeFileSync(lockFile, JSON.stringify([...now].sort(), null, 1) + '\n');
  console.log(`Lock updated: ${now.size} routes and screens (${[...now].filter((x) => !lock.includes(x)).length} new, ${lost.length} removed).`); process.exit(0);
}
if (lost.length) fail(`${lost.length} earlier feature(s) are missing:\n        ` + lost.join('\n        '));
const added = [...now].filter((x) => !lock.includes(x));
if (added.length) console.log(`  note  ${added.length} new route(s)/screen(s) not yet in the lock; run: node test/mustwork.js --update`);

// 3. the Super Admin Case law engine must be wired end to end
const need = [
  ['routes/caselaw.js', "/api/platform/caselaw/engine'", 'Case law engine endpoint'],
  ['private/sa-core.js', 'saCaselaw', 'Case law engine screen'],
  ['private/sa-core.js', "['caselaw', 'Case law engine']", 'Case law engine tab'],
];
for (const [f, needle, what] of need) if (!rd(f).includes(needle)) fail(`${what} is missing from ${f}`);

// 4. files named in the manifest and in server.js exist
const man = JSON.parse(rd('private/manifest.json'));
for (const k of Object.keys(man)) for (const n of man[k]) if (!fs.existsSync(path.join(root, 'private', n + '.js'))) fail(`manifest lists private/${n}.js but it does not exist`);
for (const m of rd('server.js').matchAll(/require\('(\.\/[^']+)'\)/g)) {
  const p = path.join(root, m[1]); if (!fs.existsSync(p) && !fs.existsSync(p + '.js')) fail(`server.js requires ${m[1]} but it does not exist`);
}

// 5. Build Journal: releases in version order, last entry is this version, dated entries not left on "this release"
const j = rd('routes/journal.js'), ver = (j.match(/const VERSION = '([\d.]+)'/) || [])[1];
const rel = [...j.matchAll(/^  \['v(\d+)(?:\.(\d+))?(?:\.(\d+))?/gm)].map((m) => [+m[1], +(m[2] || 0), +(m[3] || 0)]);
const num = (r) => r[0] * 1e6 + r[1] * 1e3 + r[2];
for (let i = 1; i < rel.length; i++) if (num(rel[i]) < num(rel[i - 1])) fail(`Build Journal release list is out of order near v${rel[i].join('.')}`);
const last = rel[rel.length - 1]; if (!ver || (+ver.split('.')[0] !== last[0] || +ver.split('.')[1] !== last[1])) fail(`journal VERSION ${ver} does not match the last release entry v${last && last.join('.')}`);
if ((j.match(/this release/g) || []).length > 1) fail('more than one Build Journal entry says "this release"');
if (/\+ BUILD_DATE \+/.test(j.replace(/\['v[\d.]+ \(this release, ' \+ BUILD_DATE \+ '\)'/, ''))) fail('an older Build Journal entry uses BUILD_DATE, so its date changes with every release');

// 6. cumulative release: the guarded files all present
for (const f of ['Dockerfile', 'docker-compose.yml', 'Caddyfile', 'backup.sh', 'package.json', 'package-lock.json']) if (!fs.existsSync(path.join(root, f))) fail(`${f} is missing from the release`);

console.log(bad ? `\nMUST-STILL-WORK CHECK FAILED (${bad})` : `Must-still-work check passed (${now.size} routes and screens, journal v${ver}).`);
process.exit(bad ? 1 : 0);
