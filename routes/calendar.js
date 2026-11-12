'use strict';
// Calendar: Central / West Bengal / Calcutta High Court / Supreme Court holidays (official lists shipped in assets/holidays.json,
// refreshed monthly from an optional online feed), manual entries, birthdays imported from a file with e-mail / WhatsApp greetings,
// and the next dates of the firm's cases.
const fs = require('fs'), path = require('path');
const multer = require('multer');
const L = require('../lib');
const AI = require('../aicore');
const WA = require('./whatsapp');
const { db, audit } = L;
const S = (t, k, d = '') => AI.getS(t, k, d);
const T = (req) => req.user.tenant_id;
const ALL = L.need('admin', 'advocate', 'staff', 'telecaller', 'accounts'), EDIT = L.need('admin', 'advocate', 'staff'), ADMIN = L.need('admin');
const CATS = { central: 'Central Govt', state: 'West Bengal Govt', hc: 'Calcutta High Court', sc: 'Supreme Court', firm: 'Firm / other' };
const FEED = () => process.env.HOLIDAY_FEED_URL || 'https://raw.githubusercontent.com/consultbanerjee/kcportal/main/assets/holidays.json';
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const key = (cat, date, title) => `${cat}|${date}|${title}`;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// ---------- holiday data ----------
let fetchImpl = (u, o) => fetch(u, o);
const bundled = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'holidays.json'), 'utf8'));
const validFeed = (j) => j && Array.isArray(j.items) && j.items.length > 20 && j.items.every((x) => CATS[x.cat] && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.title);

function provisional(items, y0, y1) {
  // fixed-date days only, for a category-year that has no official list yet
  const out = [], official = new Set(items.map((x) => x.cat + x.date.slice(0, 4)));
  const FIX = {
    central: [[1, 26, 'Republic Day'], [8, 15, 'Independence Day'], [10, 2, 'Mahatma Gandhi\'s Birthday'], [12, 25, 'Christmas Day']],
    sc: [[1, 26, 'Republic Day'], [8, 15, 'Independence Day'], [10, 2, 'Mahatma Gandhi\'s Birthday']],
    state: [[1, 1, 'New Year\'s Day'], [1, 12, 'Birthday of Swami Vivekananda'], [1, 23, 'Netaji\'s Birthday'], [1, 26, 'Republic Day'], [4, 14, 'Birthday of Dr. B. R. Ambedkar'], [4, 15, 'Bengali New Year (Nababarsha)'], [5, 1, 'May Day'], [5, 9, 'Birthday of Rabindranath Tagore'], [8, 15, 'Independence Day'], [10, 2, 'Birthday of Gandhiji'], [12, 25, 'Christmas Day']],
    hc: [[1, 1, 'New Year\'s Day'], [1, 12, 'Swami Vivekananda\'s Birthday'], [1, 23, 'Netaji\'s Birthday'], [1, 26, 'Republic Day'], [4, 14, 'Ambedkar\'s Birthday'], [4, 15, 'Bengali New Year\'s Day'], [8, 15, 'Independence Day'], [10, 2, 'Mahatma Gandhi\'s Birthday'], [12, 25, 'Christmas Day']],
  };
  for (let y = y0; y <= y1; y++) for (const cat of Object.keys(FIX)) if (!official.has(cat + y)) for (const [m, d, t] of FIX[cat]) out.push({ cat, date: ymd(y, m, d), title: t, prov: 1, src: 'Fixed-date day; official list for ' + y + ' not yet notified' });
  return out;
}
function saturdays(y0, y1) {   // 2nd and 4th Saturdays: Full Court Resolution dated 06.08.1992
  const out = [];
  for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) {
    let n = 0; const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6 && (++n === 2 || n === 4)) out.push({ cat: 'hc', date: ymd(y, m, d), title: (n === 2 ? 'Second' : 'Fourth') + ' Saturday', src: 'Full Court Resolution dated 06.08.1992' });
  }
  return out;
}
function sync(t, data, source) {
  const y0 = +todayIST().slice(0, 4), y1 = y0 + 2, hidden = new Set(db.prepare('SELECT key FROM cal_hide WHERE tenant_id=?').all(t).map((r) => r.key));
  const items = [...data.items, ...provisional(data.items, y0, y1), ...saturdays(y0, y1)].filter((x) => !hidden.has(key(x.cat, x.date, x.title)));
  const ins = db.prepare('INSERT INTO cal_holidays(tenant_id,cat,date,end_date,title,src,provisional,origin) VALUES (?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    db.prepare("DELETE FROM cal_holidays WHERE tenant_id=? AND origin='data'").run(t);
    for (const x of items) ins.run(t, x.cat, x.date, x.end || null, String(x.title).slice(0, 160), x.src ? String(x.src).slice(0, 160) : null, x.prov ? 1 : 0, 'data');
  })();
  AI.setS(t, 'cal_refreshed', new Date().toISOString()); AI.setS(t, 'cal_source', source); AI.setS(t, 'cal_version', String(data.version || ''));
  return { count: items.length, source, version: data.version || '' };
}
async function refresh(t, { online = true } = {}) {
  let data = bundled(), source = 'bundled list';
  if (online) {
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
      const r = await fetchImpl(FEED(), { signal: ctl.signal }); clearTimeout(to);
      if (r.ok) { const j = await r.json(); if (validFeed(j) && String(j.version || '') >= String(data.version || '')) { data = j; source = 'online list ' + (j.version || ''); } }
    } catch (e) { /* offline or feed not published: the bundled list is used */ }
  }
  return sync(t, data, source);
}
const ensure = (t) => { if (!S(t, 'cal_refreshed')) sync(t, bundled(), 'bundled list'); };

// ---------- birthdays ----------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDob(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim(), m;
  if (/^\d{4,6}(\.\d+)?$/.test(s) && +s > 1000 && +s < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), year: d.getUTCFullYear() }; }
  const ok = (d, mo, y) => (mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y || 2000, mo, 0)).getUTCDate() ? { month: mo, day: d, year: y && y > 1900 && y <= 2100 ? y : null } : null);
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ok(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})$/))) { let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return ok(+m[1], +m[2], y); }   // Indian order: day first
  if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3,9})[-,\/. ]*(\d{2,4})?$/)) && MON[m[2].slice(0, 3).toLowerCase()]) { let y = m[3] ? +m[3] : null; if (y && y < 100) y += y > 30 ? 1900 : 2000; return ok(+m[1], MON[m[2].slice(0, 3).toLowerCase()], y); }
  if ((m = s.match(/^([A-Za-z]{3,9})[-,\/. ]+(\d{1,2})(?:[-,\/. ]+(\d{2,4}))?$/)) && MON[m[1].slice(0, 3).toLowerCase()]) return ok(+m[2], MON[m[1].slice(0, 3).toLowerCase()], m[3] ? +m[3] : null);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})$/))) return ok(+m[1], +m[2], null);
  return null;
}
function parseCsv(text) {
  text = String(text).replace(/^﻿/, ''); const first = text.split(/\r?\n/)[0] || '', delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
async function parseXlsx(buf) {
  const JSZip = require('jszip'), z = await JSZip.loadAsync(buf);
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const ssf = z.file('xl/sharedStrings.xml'), ss = ssf ? [...(await ssf.async('string')).matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''))) : [];
  const name = Object.keys(z.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]))[0];
  if (!name) throw Object.assign(new Error('That does not look like an Excel file.'), { status: 400 });
  const xml = await z.file(name).async('string'), rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = cm[1], ref = (at.match(/r="([A-Z]+)\d+"/) || [])[1] || '', tp = (at.match(/t="(\w+)"/) || [])[1], body = cm[2] || '';
      let ci = 0; for (const ch of ref) ci = ci * 26 + ch.charCodeAt(0) - 64; ci--;
      let v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (tp === 's') v = ss[+v]; else if (tp === 'inlineStr') v = dec([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')); else if (v != null) v = dec(v);
      if (ci >= 0) row[ci] = v == null ? '' : v;
    }
    if (row.some((x) => x && String(x).trim())) rows.push(Array.from(row, (x) => x || ''));
  }
  return rows;
}
function readRows(rows) {
  if (!rows.length) return { items: [], bad: [] };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const h = rows[0].map(norm), find = (re) => h.findIndex((x) => re.test(x));
  let iN = find(/^(name|fullname|clientname|person|contact)$/), iD = find(/(birth|dob|bday|date)/), iE = find(/(mail)/), iP = find(/(phone|mobile|whatsapp|contact(no|number)|cell)/);
  const hasHead = iN >= 0 || iD >= 0; let data = rows;
  if (hasHead) { data = rows.slice(1); if (iN < 0) iN = 0; if (iD < 0) iD = 1; } else { iN = 0; iD = 1; iE = 2; iP = 3; }
  const items = [], bad = [];
  data.forEach((r, i) => {
    const name = String(r[iN] || '').trim(); if (!name && !String(r[iD] || '').trim()) return;
    const d = parseDob(r[iD]); if (!name || !d) { bad.push({ row: i + (hasHead ? 2 : 1), name, value: String(r[iD] || '') }); return; }
    items.push({ name: name.slice(0, 120), ...d, email: iE >= 0 ? String(r[iE] || '').trim().slice(0, 160) : '', phone: iP >= 0 ? String(r[iP] || '').trim().slice(0, 30) : '' });
  });
  return { items, bad };
}
function linkClient(t, b) {
  const ph = WA.normPhone(b.phone || '');
  if (ph) { const c = db.prepare('SELECT id,phone FROM clients WHERE tenant_id=?').all(t).find((x) => WA.normPhone(x.phone || '') === ph); if (c) return c.id; }
  if (b.email) { const c = db.prepare('SELECT id FROM clients WHERE tenant_id=? AND lower(email)=lower(?)').get(t, b.email); if (c) return c.id; }
  const n = db.prepare('SELECT id FROM clients WHERE tenant_id=? AND lower(name)=lower(?)').all(t, b.name); return n.length === 1 ? n[0].id : null;
}
function saveBday(t, b) {
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '') ? b.email : '', phone = L.str(b.phone, 30);
  const ex = db.prepare('SELECT id FROM cal_birthdays WHERE tenant_id=? AND lower(name)=lower(?) AND month=? AND day=?').get(t, b.name, b.month, b.day);
  const cid = linkClient(t, { name: b.name, email, phone });
  if (ex) { db.prepare('UPDATE cal_birthdays SET year=COALESCE(?,year), email=CASE WHEN ?<>\'\' THEN ? ELSE email END, phone=CASE WHEN ?<>\'\' THEN ? ELSE phone END, client_id=COALESCE(client_id,?) WHERE id=?').run(b.year || null, email, email, phone, phone, cid, ex.id); return { id: ex.id, added: false }; }
  const r = db.prepare('INSERT INTO cal_birthdays(tenant_id,name,month,day,year,email,phone,client_id) VALUES (?,?,?,?,?,?,?,?)').run(t, b.name, b.month, b.day, b.year || null, email, phone, cid);
  return { id: r.lastInsertRowid, added: true };
}
const bdayDate = (b, y) => ymd(y, b.month, b.month === 2 && b.day === 29 && !isLeap(y) ? 28 : b.day);

// ---------- greetings ----------
const firmName = (t) => (db.prepare('SELECT name FROM tenants WHERE id=?').get(t) || {}).name || 'our law firm';
const DEF_MSG = 'Dear {name},\n\nWarm birthday greetings from {firm}! Wishing you good health and happiness in the year ahead.\n\nWith regards,\n{firm}';
const fillMsg = (t, b) => (S(t, 'cal_bday_msg') || DEF_MSG).replace(/\{name\}/g, b.name).replace(/\{firm\}/g, firmName(t));
const logG = (t, id, year, channel, status, error, auto) => db.prepare('INSERT INTO cal_greet_log(tenant_id,bday_id,year,channel,status,error,auto) VALUES (?,?,?,?,?,?,?)').run(t, id, year, channel, status, error ? String(error).slice(0, 250) : null, auto ? 1 : 0);
const sentThisYear = (t, id, y, ch) => !!db.prepare("SELECT 1 FROM cal_greet_log WHERE tenant_id=? AND bday_id=? AND year=? AND channel=? AND status IN ('sent','opened')").get(t, id, y, ch);
async function greet(t, b, { email, wa }, auto) {
  const y = +todayIST().slice(0, 4), res = {}, text = fillMsg(t, b);
  if (email) {
    const M = require('./aimail');
    if (!b.email) res.email = { status: 'skipped', error: 'No e-mail address.' };
    else if (!M.mailReady(t)) res.email = { status: 'skipped', error: 'E-mail sending is not set up.' };
    else try { await M.sendMail(t, { to: b.email, subject: (S(t, 'cal_bday_subject') || 'Happy Birthday, {name}!').replace(/\{name\}/g, b.name), text }); logG(t, b.id, y, 'email', 'sent', null, auto); res.email = { status: 'sent' }; } catch (e) { logG(t, b.id, y, 'email', 'failed', e.message, auto); res.email = { status: 'failed', error: e.message }; }
  }
  if (wa) {
    const to = WA.normPhone(b.phone || '');
    if (!to) res.whatsapp = { status: 'skipped', error: 'No valid mobile number.' };
    else if (WA.configured(t) && b.client_id && !db.prepare('SELECT wa_optout FROM clients WHERE id=?').get(b.client_id).wa_optout) {
      try { await WA.sendToClient(t, b.client_id, { template: 'kc_birthday', vars: [b.name, firmName(t)] }, null); logG(t, b.id, y, 'whatsapp', 'sent', null, auto); res.whatsapp = { status: 'sent' }; } catch (e) { logG(t, b.id, y, 'whatsapp', 'failed', e.message, auto); res.whatsapp = { status: 'failed', error: e.message }; }
    } else if (!auto) { logG(t, b.id, y, 'whatsapp', 'opened', null, 0); res.whatsapp = { status: 'opened', link: `https://wa.me/${to}?text=${encodeURIComponent(text.replace(/\n{2,}/g, '\n\n'))}` }; }
  }
  return res;
}
async function runGreetings(t, day = todayIST()) {
  if (S(t, 'cal_bday_auto') !== '1') return 0;
  const y = +day.slice(0, 4); let n = 0;
  for (const b of db.prepare('SELECT * FROM cal_birthdays WHERE tenant_id=? AND active=1').all(t)) {
    if (bdayDate(b, y) !== day) continue;
    const em = S(t, 'cal_bday_email', '1') === '1' && b.email && !sentThisYear(t, b.id, y, 'email') && !db.prepare("SELECT 1 FROM cal_greet_log WHERE tenant_id=? AND bday_id=? AND year=? AND channel='email' AND status='failed'").get(t, b.id, y);
    const wa = S(t, 'cal_bday_wa', '1') === '1' && WA.configured(t) && b.client_id && !sentThisYear(t, b.id, y, 'whatsapp') && !db.prepare("SELECT 1 FROM cal_greet_log WHERE tenant_id=? AND bday_id=? AND year=? AND channel='whatsapp' AND status='failed'").get(t, b.id, y);
    if (!em && !wa) continue;
    const r = await greet(t, b, { email: em, wa }, true); n += Object.values(r).filter((x) => x.status === 'sent').length;
  }
  return n;
}

// ---------- calendar feed for the page ----------
function build(t, role, from, to, inc) {
  ensure(t);
  const holidays = db.prepare('SELECT id,cat,date,end_date,title,note,src,provisional,origin FROM cal_holidays WHERE tenant_id=? AND date<=? AND COALESCE(end_date,date)>=? ORDER BY date,cat').all(t, to, from);
  const out = { holidays, birthdays: [], cases: [] }, y0 = +from.slice(0, 4), y1 = +to.slice(0, 4), today = todayIST();
  if (inc.bday) for (const b of db.prepare('SELECT * FROM cal_birthdays WHERE tenant_id=? AND active=1 ORDER BY name').all(t))
    for (let y = y0; y <= y1; y++) { const d = bdayDate(b, y); if (d >= from && d <= to) out.birthdays.push({ id: b.id, name: b.name, date: d, age: b.year ? y - b.year : null, email: !!b.email, phone: !!WA.normPhone(b.phone || ''), sent: d === today ? ['email', 'whatsapp'].filter((c) => sentThisYear(t, b.id, y, c)) : [] }); }
  if (inc.cases && ['admin', 'advocate', 'staff'].includes(role)) {
    const sel = 'm.file_no, m.title, m.forum, m.case_no, c.name client FROM hearings h JOIN matters m ON m.id=h.matter_id AND m.status<>\'deleted\' JOIN clients c ON c.id=m.client_id';
    // next date = the next date recorded on the latest hearing of each open case; earlier hearings show as history
    const rows = db.prepare(`SELECT h.matter_id, h.next_date d, h.purpose, 'next' kind, ${sel} WHERE h.tenant_id=? AND m.status<>'closed' AND h.next_date BETWEEN ? AND ?
      AND h.id=(SELECT id FROM hearings h2 WHERE h2.matter_id=h.matter_id ORDER BY hearing_date DESC, id DESC LIMIT 1)
      UNION ALL SELECT h.matter_id, h.hearing_date, h.purpose, 'heard', ${sel} WHERE h.tenant_id=? AND h.hearing_date BETWEEN ? AND ? AND h.hearing_date<? ORDER BY 2`).all(t, from, to, t, from, to, today);
    const seen = new Set(); for (const r of rows) { const k = r.matter_id + r.d; if (!seen.has(k)) { seen.add(k); out.cases.push(r); } }
  }
  return out;
}

module.exports = (app) => {
  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  const settings = (t) => ({ auto: S(t, 'cal_bday_auto') === '1', email: S(t, 'cal_bday_email', '1') === '1', wa: S(t, 'cal_bday_wa', '1') === '1', msg: S(t, 'cal_bday_msg') || DEF_MSG, subject: S(t, 'cal_bday_subject') || 'Happy Birthday, {name}!',
    refreshed: S(t, 'cal_refreshed'), source: S(t, 'cal_source'), version: S(t, 'cal_version'), wa_api: WA.configured(t), cats: CATS });

  app.get('/api/calendar', ALL, (req, res) => {
    const t = T(req), from = L.isDate(req.query.from) ? req.query.from : todayIST().slice(0, 8) + '01', to = L.isDate(req.query.to) ? req.query.to : from;
    if (to < from || (new Date(to) - new Date(from)) > 400 * 86400000) return res.status(400).json({ error: 'Choose a shorter date range.' });
    const r = build(t, req.user.role, from, to, { bday: req.query.bday === '1', cases: req.query.cases === '1' });
    res.json({ ...r, settings: settings(t), today: todayIST(), can_edit: ['admin', 'advocate', 'staff'].includes(req.user.role) });
  });
  app.get('/api/calendar/settings', ALL, (req, res) => res.json(settings(T(req))));
  app.put('/api/calendar/settings', ADMIN, (req, res) => {
    const t = T(req), b = req.body;
    if (b.auto !== undefined) AI.setS(t, 'cal_bday_auto', b.auto ? '1' : '0');
    if (b.email !== undefined) AI.setS(t, 'cal_bday_email', b.email ? '1' : '0');
    if (b.wa !== undefined) AI.setS(t, 'cal_bday_wa', b.wa ? '1' : '0');
    if (b.msg !== undefined) AI.setS(t, 'cal_bday_msg', L.str(b.msg, 1000));
    if (b.subject !== undefined) AI.setS(t, 'cal_bday_subject', L.str(b.subject, 150));
    res.json(settings(t));
  });
  app.post('/api/calendar/refresh', ADMIN, async (req, res) => {
    try { const r = await refresh(T(req)); audit(T(req), req.user.id, 'calendar_refresh', 'calendar', 0, r.source, L.ip(req)); res.json({ ...r, settings: settings(T(req)) }); } catch (e) { console.error(e); res.status(500).json({ error: 'Could not refresh the holiday list.' }); }
  });

  // manual holidays / events
  const body = (b) => {
    const cat = CATS[b.cat] ? b.cat : 'firm', date = L.str(b.date, 10), end = L.str(b.end_date, 10), title = L.str(b.title, 160);
    if (!title) throw Object.assign(new Error('Enter a title.'), { status: 400 }); if (!L.isDate(date)) throw Object.assign(new Error('Choose a valid date.'), { status: 400 });
    if (end && (!L.isDate(end) || end < date)) throw Object.assign(new Error('The end date must be on or after the start date.'), { status: 400 });
    return { cat, date, end: end && end !== date ? end : null, title, note: L.str(b.note, 300) };
  };
  const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' }); if (!e.status) console.error(e); } };
  app.post('/api/calendar/holidays', EDIT, wrap((req, res) => { const t = T(req), v = body(req.body); const r = db.prepare("INSERT INTO cal_holidays(tenant_id,cat,date,end_date,title,note,origin) VALUES (?,?,?,?,?,?,'manual')").run(t, v.cat, v.date, v.end, v.title, v.note); audit(t, req.user.id, 'calendar_add', 'holiday', r.lastInsertRowid, v.title, L.ip(req)); res.status(201).json({ id: r.lastInsertRowid }); }));
  app.put('/api/calendar/holidays/:id', EDIT, wrap((req, res) => { const t = T(req), v = body(req.body); const r = db.prepare("UPDATE cal_holidays SET cat=?,date=?,end_date=?,title=?,note=? WHERE id=? AND tenant_id=? AND origin='manual'").run(v.cat, v.date, v.end, v.title, v.note, req.params.id, t); if (!r.changes) return res.status(404).json({ error: 'Only entries you added yourself can be edited. Delete an official entry and add your own instead.' }); res.json({ ok: true }); }));
  app.delete('/api/calendar/holidays/:id', EDIT, wrap((req, res) => {
    const t = T(req), h = db.prepare('SELECT * FROM cal_holidays WHERE id=? AND tenant_id=?').get(req.params.id, t); if (!h) return res.status(404).json({ error: 'Not found.' });
    if (h.origin === 'data') db.prepare('INSERT OR IGNORE INTO cal_hide(tenant_id,key) VALUES (?,?)').run(t, key(h.cat, h.date, h.title));   // stays removed after every monthly refresh
    db.prepare('DELETE FROM cal_holidays WHERE id=?').run(h.id); audit(t, req.user.id, 'calendar_delete', 'holiday', h.id, h.title, L.ip(req)); res.json({ ok: true });
  }));

  // birthdays
  app.get('/api/calendar/birthdays', EDIT, (req, res) => { const t = T(req), y = +todayIST().slice(0, 4); res.json(db.prepare('SELECT * FROM cal_birthdays WHERE tenant_id=? ORDER BY month,day,name').all(t).map((b) => ({ ...b, sent: ['email', 'whatsapp'].filter((c) => sentThisYear(t, b.id, y, c)) }))); });
  app.post('/api/calendar/birthdays', EDIT, wrap((req, res) => {
    const t = T(req), b = req.body, d = parseDob(b.date), name = L.str(b.name, 120); if (!name) return res.status(400).json({ error: 'Enter the name.' }); if (!d) return res.status(400).json({ error: 'Enter the birthday as DD/MM/YYYY (the year is optional).' });
    const r = saveBday(t, { name, ...d, email: L.str(b.email, 160), phone: L.str(b.phone, 30) }); res.status(201).json(r);
  }));
  app.put('/api/calendar/birthdays/:id', EDIT, wrap((req, res) => {
    const t = T(req), b = req.body, d = parseDob(b.date), name = L.str(b.name, 120); if (!name || !d) return res.status(400).json({ error: 'Enter the name and a valid birthday.' });
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '') ? b.email : '', phone = L.str(b.phone, 30);
    const r = db.prepare('UPDATE cal_birthdays SET name=?,month=?,day=?,year=?,email=?,phone=?,client_id=?,active=? WHERE id=? AND tenant_id=?').run(name, d.month, d.day, d.year, email, phone, linkClient(t, { name, email, phone }), b.active === false || b.active === 0 ? 0 : 1, req.params.id, t);
    if (!r.changes) return res.status(404).json({ error: 'Not found.' }); res.json({ ok: true });
  }));
  app.delete('/api/calendar/birthdays/:id', EDIT, (req, res) => { const t = T(req); db.prepare('DELETE FROM cal_greet_log WHERE bday_id=? AND tenant_id=?').run(req.params.id, t); const r = db.prepare('DELETE FROM cal_birthdays WHERE id=? AND tenant_id=?').run(req.params.id, t); if (!r.changes) return res.status(404).json({ error: 'Not found.' }); res.json({ ok: true }); });
  app.post('/api/calendar/birthdays/import', EDIT, up.single('file'), async (req, res) => {
    try {
      const t = T(req); let rows;
      if (req.file) {
        const n = (req.file.originalname || '').toLowerCase();
        if (/\.xlsx$/.test(n)) rows = await parseXlsx(req.file.buffer);
        else if (/\.xls$/.test(n)) return res.status(400).json({ error: 'Old .xls files cannot be read. Open it in Excel, choose Save As → .xlsx or .csv, and upload that.' });
        else rows = parseCsv(req.file.buffer.toString('utf8'));
      } else if (L.str(req.body.text, 200000)) rows = parseCsv(L.str(req.body.text, 200000));
      else return res.status(400).json({ error: 'Choose a file (.xlsx or .csv) or paste the list.' });
      const { items, bad } = readRows(rows); if (!items.length) return res.status(400).json({ error: 'No birthdays found. Use columns: Name, Birthday (DD/MM/YYYY), Email, Phone.', bad: bad.slice(0, 20) });
      let added = 0, updated = 0; db.transaction(() => { for (const it of items.slice(0, 5000)) (saveBday(t, it).added ? added++ : updated++); })();
      audit(t, req.user.id, 'birthdays_import', 'calendar', 0, `${added} added, ${updated} updated`, L.ip(req));
      res.json({ added, updated, skipped: bad.length, bad: bad.slice(0, 20) });
    } catch (e) { res.status(e.status || 400).json({ error: e.status ? e.message : 'Could not read that file. Save it as .xlsx or .csv and try again.' }); }
  });
  app.post('/api/calendar/birthdays/:id/greet', EDIT, async (req, res) => {
    try {
      const t = T(req), b = db.prepare('SELECT * FROM cal_birthdays WHERE id=? AND tenant_id=?').get(req.params.id, t); if (!b) return res.status(404).json({ error: 'Not found.' });
      const r = await greet(t, b, { email: !!req.body.email, wa: !!req.body.whatsapp }, false); audit(t, req.user.id, 'birthday_greeting', 'calendar', b.id, Object.keys(r).join(','), L.ip(req)); res.json(r);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Could not send.' }); }
  });
};

let timer;
function startWorker() {
  const tick = async () => {
    const h = new Date(Date.now() + 5.5 * 3600000).getUTCHours(); if (h < 8 || h >= 20) return;
    for (const r of db.prepare("SELECT id t FROM tenants WHERE kind='firm' AND active=1").all()) {
      try {
        const last = S(r.t, 'cal_refreshed');
        if (!last || Date.now() - Date.parse(last) > 30 * 86400000) await refresh(r.t);       // monthly
        if (h >= 9) await runGreetings(r.t);
      } catch (e) { console.error('calendar', e.message); }
    }
  };
  timer = setInterval(tick, 30 * 60 * 1000); if (timer.unref) timer.unref(); setTimeout(tick, 25000).unref();
}
Object.assign(module.exports, { startWorker, refresh, sync, ensure, parseDob, parseCsv, parseXlsx, readRows, runGreetings, greet, build, provisional, saturdays, setFetch: (f) => { fetchImpl = f; } });
