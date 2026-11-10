'use strict';
// Public headline feed for the firm website (kclegal.us).
// Collects headlines (title + link only) from public news pages every 30 minutes,
// keeps the last good copy, and serves it as JSON. Nothing here needs a login.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db');

const PER_COLUMN = 8;
const EVERY_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 12000;
const CACHE_FILE = path.join(DATA_DIR, 'news-cache.json');
const ORIGINS = new Set(['https://www.kclegal.us', 'https://kclegal.us', ...String(process.env.NEWS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);

// Each column lists sources in priority order. A source is a page or feed URL;
// `re` picks which article links on an HTML page count as headlines.
const COLUMNS = [
  { key: 'sc', title: 'Supreme Court', sources: [
    { name: 'LiveLaw', url: 'https://www.livelaw.in/supreme-court', re: /livelaw\.in\/(?:supreme-court|top-stories)\/[^/?#]+-\d{5,}$/ },
    { name: 'Bar & Bench', url: 'https://www.barandbench.com/news/litigation', re: /barandbench\.com\/news\/(?:litigation\/)?[^/?#]*supreme-court[^/?#]*$/ },
  ] },
  { key: 'chc', title: 'Calcutta High Court', sources: [
    { name: 'LiveLaw', url: 'https://www.livelaw.in/high-court/calcutta-high-court', re: /livelaw\.in\/high-court\/calcutta-high-court\/[^/?#]+-\d{5,}$/ },
    { name: 'Bar & Bench', url: 'https://www.barandbench.com/news/litigation', re: /barandbench\.com\/news\/(?:litigation\/)?[^/?#]*calcutta-high-court[^/?#]*$/ },
  ] },
  { key: 'gov', title: 'Government of India', sources: [
    { name: 'AIR', url: 'https://newsonair.gov.in/category/national/', re: /newsonair\.gov\.in\/[a-z0-9]+(?:-[a-z0-9]+){3,}\/?$/ },
    { name: 'AIR', url: 'https://newsonair.gov.in/feed/' },
    { name: 'DD News', url: 'https://ddnews.gov.in/en/category/national/', re: /ddnews\.gov\.in\/en\/[a-z0-9]+(?:-[a-z0-9]+){3,}\/?$/ },
    { name: 'AIR', url: 'https://newsonair.gov.in/category/business/', re: /newsonair\.gov\.in\/[a-z0-9]+(?:-[a-z0-9]+){3,}\/?$/ },
    { name: 'PIB', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3' },
  ] },
  { key: 'wb', title: 'Government of West Bengal', sources: [
    { name: 'Millennium Post', url: 'https://www.millenniumpost.in/bengal', re: /millenniumpost\.in\/bengal\/[^/?#]+-\d{5,}$/ },
    { name: 'AIR', url: 'https://newsonair.gov.in/category/states/west-bengal/', re: /newsonair\.gov\.in\/[a-z0-9]+(?:-[a-z0-9]+){3,}\/?$/ },
    { name: 'AIR', url: 'https://newsonair.gov.in/category/regional/', re: /newsonair\.gov\.in\/[a-z0-9]*bengal[a-z0-9-]*\/?$/ },
  ] },
  { key: 'law', title: 'Law News (India)', sources: [
    { name: 'Bar & Bench', url: 'https://www.barandbench.com/news', re: /barandbench\.com\/news\/(?:[a-z-]+\/)?[^/?#]+-[^/?#]+$/ },
    { name: 'LiveLaw', url: 'https://www.livelaw.in/', re: /livelaw\.in\/(?:high-court|top-stories|supreme-court)\/[^?#]*-\d{5,}$/ },
  ] },
  { key: 'intl', title: 'Law News (International)', sources: [
    { name: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/topic/law-and-crime-prevention/feed/rss.xml' },
    { name: 'Jurist', url: 'https://www.jurist.org/news/feed/' },
    { name: 'ICJ', url: 'https://www.icj-cij.org/press-releases', re: /icj-cij\.org\/[^?#]*(?:press|case|node)[^?#]*\d[^?#]*$/ },
  ] },
];

const UA = 'Mozilla/5.0 (compatible; KCLegalNewsBot/1.0; +https://www.kclegal.us)';
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”', '&#8211;': '–', '&#8212;': '—' };
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#8217|#8216|#8220|#8221|#8211|#8212);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
const clean = (s) => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function fromFeed(xml) {
  const out = [];
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
  for (const it of items) {
    const t = (it.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
    let l = (it.match(/<link[^>]*>([^<]+)<\/link>/) || [])[1] || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    if (t && l) out.push({ title: clean(t), url: decode(l).trim() });
  }
  return out;
}

function fromHtml(html, base, re) {
  const out = []; const seen = new Set();
  const rx = /<a\b[^>]*?href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html))) {
    let href; try { href = new URL(decode(m[2]), base).href.split('#')[0].split('?')[0]; } catch (e) { continue; }
    if (re && !re.test(href)) continue;
    const title = clean(m[3]);
    if (title.length < 25 || title.length > 220 || seen.has(href)) continue;
    seen.add(href); out.push({ title, url: href });
  }
  return out;
}

async function pull(src) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(src.url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,application/rss+xml,*/*' }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) return [];
    const body = await r.text();
    const feedy = /^\s*(<\?xml|<rss|<feed)/i.test(body) || /<(rss|feed)[\s>]/i.test(body.slice(0, 600));
    return feedy ? fromFeed(body) : fromHtml(body, src.url, src.re);
  } catch (e) { return []; } finally { clearTimeout(to); }
}

let cache = { updated: null, columns: [] };
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}

async function refresh() {
  const cols = [];
  for (const c of COLUMNS) {
    const items = []; const seen = new Set();
    for (const s of c.sources) {
      if (items.length >= PER_COLUMN) break;
      for (const it of await pull(s)) {
        if (items.length >= PER_COLUMN) break;
        if (seen.has(it.url)) continue;
        // reject junk titles such as menu items and section labels
        if (!/\s/.test(it.title)) continue;
        seen.add(it.url); items.push({ title: it.title, url: it.url, source: s.name });
      }
    }
    const old = (cache.columns || []).find((x) => x.key === c.key);
    // never wipe a column because a source failed: keep the last good headlines
    cols.push({ key: c.key, title: c.title, items: items.length >= 4 ? items : (old && old.items) || items });
  }
  if (cols.some((c) => c.items.length)) {
    cache = { updated: new Date().toISOString(), columns: cols };
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) {}
  }
  return cache;
}

function startWorker() {
  const run = () => refresh().catch(() => {});
  setTimeout(run, 5000).unref();
  setInterval(run, EVERY_MS).unref();
}

module.exports = (app) => {
  app.use('/api/public/news', (req, res, next) => {
    const o = (req.headers.origin || '').replace(/\/$/, '');
    if (ORIGINS.has(o)) res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/api/public/news', (req, res) => {
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ updated: cache.updated, columns: (cache.columns || []).map((c) => ({ key: c.key, title: c.title, items: (c.items || []).map((i) => ({ title: i.title, url: i.url })) })) });
  });
};
module.exports.startWorker = startWorker;
module.exports.refresh = refresh;
module.exports._t = { fromFeed, fromHtml };
