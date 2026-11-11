'use strict';
// PRODUCTION BUILD — turns the readable browser code into protected code in dist/.
// Only the browser files are processed (everything a visitor's browser receives). Server code never leaves the server.
// Run by the Dockerfile; never shipped to a customer.
const fs = require('fs'), path = require('path');
const { minify } = require('terser');
const Obf = require('javascript-obfuscator');
const R = __dirname, OUT = path.join(R, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
const copy = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
async function protect(src) {
  const t = await minify(src, { compress: { passes: 2, drop_debugger: true }, mangle: { toplevel: false }, format: { comments: false } });
  if (t.error || !t.code) throw new Error('minify failed');
  return Obf.obfuscate(t.code, {
    compact: true, renameGlobals: false, identifierNamesGenerator: 'hexadecimal', stringArray: true, stringArrayThreshold: 0.8, stringArrayEncoding: ['base64'], stringArrayWrappersCount: 2,
    splitStrings: true, splitStringsChunkLength: 8, transformObjectKeys: false, unicodeEscapeSequence: false, disableConsoleOutput: true, simplify: true, target: 'browser', seed: 0,
  }).getObfuscatedCode();
}
const PUBLIC_OK = new Set(['index.html', 'style.css', 'app.js', 'views-public.js', 'boot.js', 'chat.js', 'sw.js', 'icon.svg', 'manifest.webmanifest', 'privacy.html']);   // anything else left in public/ (old files) is ignored
(async () => {
  let n = 0;
  for (const f of fs.readdirSync(path.join(R, 'public')).filter((x) => PUBLIC_OK.has(x))) {
    const s = path.join(R, 'public', f), d = path.join(OUT, 'public', f);
    if (/\.js$/.test(f) && f !== 'sw.js') { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, await protect(fs.readFileSync(s, 'utf8'))); n++; } else copy(s, d);
  }
  for (const f of fs.readdirSync(path.join(R, 'private'))) {
    const s = path.join(R, 'private', f), d = path.join(OUT, 'private', f);
    if (/\.js$/.test(f)) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, await protect(fs.readFileSync(s, 'utf8'))); n++; } else copy(s, d);
  }
  console.log('protected', n, 'browser scripts into dist/');
})().catch((e) => { console.error('BUILD FAILED', e.message); process.exit(1); });
