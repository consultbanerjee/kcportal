'use strict';
// Google Meet for online consultations: when a booking is confirmed a Google Calendar event with a Meet link is created for that date and time
// (Google e-mails the invitation to the client and to the booked advocate). The Admin is the host (owner of the Google account); the booked advocate is
// co-host where Google allows it. Inside the portal only the Admin and the booked advocate can obtain the link. Recordings are filed under
// KcLegalPortal › client › Recordings in Google Drive.
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const Drive = require('./drive');
const { db, audit } = L;
const { DATA_DIR } = require('../db');

const CAL = 'https://www.googleapis.com/calendar/v3', MEET = 'https://meet.googleapis.com/v2';
const REC_DIR = path.join(DATA_DIR, 'rec-tmp');
const MAX_REC = 600 * 1024 * 1024;
const jitsi = () => 'https://meet.jit.si/KCLEGAL-' + L.rand(8);

// May this user obtain / see the meeting link? Admin (host) and the advocate the client booked — nobody else in the office.
const mayJoin = (u, a) => !!u && (u.role === 'admin' || (u.role === 'advocate' && a.advocate_id === u.id));
function filterLinks(u, rows) { return rows.map((a) => (mayJoin(u, a) ? a : { ...a, meet_link: a.meet_link ? 'restricted' : null, meet_code: undefined, meet_event_id: undefined })); }

async function createFor(apptId) {
  const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(apptId); if (!a) return;
  const t = a.tenant_id;
  if (!Drive.canMeet(t)) { db.prepare('UPDATE appointments SET meet_link=? WHERE id=? AND meet_link IS NULL').run(jitsi(), a.id); return; }
  const adv = db.prepare('SELECT name,email FROM users WHERE id=?').get(a.advocate_id) || {}, ct = db.prepare('SELECT name FROM consult_types WHERE id=?').get(a.consult_type_id) || {};
  const firm = db.prepare('SELECT name FROM tenants WHERE id=?').get(t).name, notes = [];
  try {
    const attendees = [a.email && { email: a.email, displayName: a.name }, adv.email && { email: adv.email, displayName: adv.name }].filter(Boolean);
    const ev = await Drive.call(t, 'POST', `${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, { json: {
      summary: `${firm} — ${ct.name || 'Consultation'} with ${a.name}`, description: `Online consultation booked through the ${firm} portal.\nAdvocate: ${adv.name || ''}\nReference: ${a.pay_ref || ''}`,
      start: { dateTime: a.start_at, timeZone: 'Asia/Kolkata' }, end: { dateTime: a.end_at, timeZone: 'Asia/Kolkata' }, attendees,
      guestsCanModifyEvent: false, guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false,
      conferenceData: { createRequest: { requestId: 'kc-' + a.id + '-' + L.rand(4), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } });
    const link = ev.hangoutLink || ((ev.conferenceData && ev.conferenceData.entryPoints) || []).find((e) => e.entryPointType === 'video')?.uri;
    const code = ev.conferenceData && ev.conferenceData.conferenceId || (link && link.split('/').pop()) || null;
    if (!link) throw new Error('Google did not return a Meet link.');
    db.prepare('UPDATE appointments SET meet_link=?, meet_event_id=?, meet_code=? WHERE id=?').run(link, ev.id, code, a.id);
    // Tighten the room where Google allows it (Workspace accounts): invited people only, record automatically, advocate as co-host
    if (code) {
      try { await Drive.call(t, 'PATCH', `${MEET}/spaces/${code}?updateMask=config.accessType,config.artifactConfig.recordingConfig.autoRecordingGeneration`, { json: { config: { accessType: 'RESTRICTED', artifactConfig: { recordingConfig: { autoRecordingGeneration: 'ON' } } } } }); notes.push('Room restricted to invited people; automatic recording requested.'); }
      catch (e) { notes.push('Google did not apply room restrictions / automatic recording (' + e.message + '). Use the portal recorder.'); }
      if (adv.email) { try { await Drive.call(t, 'POST', `${MEET}/spaces/${code}/members`, { json: { email: adv.email, role: 'COHOST' } }); notes.push('Advocate added as co-host.'); } catch (e) { notes.push('Co-host not set (' + e.message + ').'); } }
    }
  } catch (e) {
    db.prepare('UPDATE appointments SET meet_link=? WHERE id=? AND meet_link IS NULL').run(jitsi(), a.id);
    notes.push('Google Meet could not be created (' + e.message + '); a backup link was used.');
  }
  db.prepare('UPDATE appointments SET meet_note=? WHERE id=?').run(notes.join(' ').slice(0, 500), a.id);
}
async function cancelFor(a) {
  if (a.meet_event_id && Drive.canMeet(a.tenant_id)) { try { await Drive.call(a.tenant_id, 'DELETE', `${CAL}/calendars/primary/events/${encodeURIComponent(a.meet_event_id)}?sendUpdates=all`, { raw: true }); } catch (e) { /* already gone */ } }
}

// Meet's own recordings (Workspace accounts) land in the host's Drive: move them into the client's Recordings folder
async function collectRecordings(t) {
  if (!Drive.canMeet(t)) return;
  const rows = db.prepare(`SELECT * FROM appointments WHERE tenant_id=? AND status='confirmed' AND meet_code IS NOT NULL AND client_id IS NOT NULL AND (rec_status IS NULL OR rec_status='waiting')
    AND end_at < ? AND end_at > ?`).all(t, new Date(Date.now() - 10 * 60000).toISOString(), new Date(Date.now() - 5 * 86400000).toISOString());
  const h = require('./files'); void h;
  for (const a of rows) {
    try {
      const recs = [];
      const cr = await Drive.call(t, 'GET', `${MEET}/conferenceRecords?` + new URLSearchParams({ filter: `space.meeting_code="${a.meet_code}"` }).toString());
      for (const c of cr.conferenceRecords || []) { const r = await Drive.call(t, 'GET', `${MEET}/${c.name}/recordings`); for (const x of r.recordings || []) if (x.driveDestination && x.driveDestination.file && (!x.state || x.state === 'FILE_GENERATED')) recs.push(x.driveDestination.file.replace(/^files\//, '')); }
      if (!recs.length) { db.prepare("UPDATE appointments SET rec_status=? WHERE id=?").run(a.end_at < new Date(Date.now() - 2 * 86400000).toISOString() ? 'none' : 'waiting', a.id); continue; }
      const folder = await Drive.ensureDriveFolder(t, collectRecordings.recFolder(t, a.client_id));
      for (const fid of recs) {
        const cur = await Drive.call(t, 'GET', `https://www.googleapis.com/drive/v3/files/${fid}?fields=parents`);
        await Drive.call(t, 'PATCH', `https://www.googleapis.com/drive/v3/files/${fid}?fields=id&addParents=${encodeURIComponent(folder)}&removeParents=${encodeURIComponent((cur.parents || []).join(','))}`, { json: {} });
      }
      db.prepare("UPDATE appointments SET rec_status='saved by Google Meet' WHERE id=?").run(a.id);
    } catch (e) { db.prepare("UPDATE appointments SET meet_note=? WHERE id=?").run(('Recording check: ' + e.message).slice(0, 300), a.id); }
  }
}

let timer = null;
function startWorker() {
  if (timer) return;
  timer = setInterval(async () => {
    for (const f of db.prepare("SELECT id FROM tenants WHERE kind='firm' AND active=1").all()) { try { await collectRecordings(f.id); } catch (e) {} }
    try { for (const n of fs.readdirSync(REC_DIR)) { const p = path.join(REC_DIR, n); if (Date.now() - fs.statSync(p).mtimeMs > 2 * 86400000) fs.unlinkSync(p); } } catch (e) {}
  }, 5 * 60000);
  timer.unref();
}

module.exports = (app) => {
  const T = (req) => req.user.tenant_id, host = L.need('admin', 'advocate');
  const load = (req, res) => {
    const a = db.prepare(`SELECT a.*, ct.name AS type_name, u.name AS advocate FROM appointments a JOIN consult_types ct ON ct.id=a.consult_type_id JOIN users u ON u.id=a.advocate_id WHERE a.id=? AND a.tenant_id=?`).get(req.params.id, T(req));
    if (!a) { res.status(404).json({ error: 'Not found.' }); return null; }
    if (!mayJoin(req.user, a)) { res.status(403).json({ error: 'Only the Admin and the advocate booked for this consultation can join or record it.' }); return null; }
    return a;
  };
  const recFolder = (t, cid) => app.locals.fsHelpers.recFolder(t, cid);
  collectRecordings.recFolder = recFolder;

  app.get('/api/appointments/:id/meeting', host, (req, res) => {
    const a = load(req, res); if (!a) return;
    let recs = [];
    if (a.client_id) { const f = recFolder(T(req), a.client_id); recs = db.prepare("SELECT id,name,size,created_at FROM fs_nodes WHERE parent_id=? AND kind='file' AND deleted_at IS NULL ORDER BY id DESC").all(f); }
    res.json({ ...a, can_record: Drive.connected(T(req)), recordings: recs });
  });
  // The only way the link is handed out: Admin or the booked advocate, and only for a confirmed booking
  app.get('/api/appointments/:id/join', host, (req, res) => {
    const a = load(req, res); if (!a) return;
    if (a.status !== 'confirmed' || !a.meet_link) return res.status(409).json({ error: 'The meeting link is not ready yet.' });
    audit(T(req), req.user.id, 'meeting_join', 'appointment', a.id, null, L.ip(req));
    res.json({ link: a.meet_link });
  });

  // ---- browser recorder: pieces arrive while the call runs, then go to Drive when it ends ----
  const part = (a, rid) => path.join(REC_DIR, `${a.id}-${/^[a-f0-9]{16}$/.test(rid) ? rid : 'x'}.part`);
  app.post('/api/appointments/:id/recording/start', host, (req, res) => {
    const a = load(req, res); if (!a) return;
    if (!Drive.connected(T(req))) return res.status(409).json({ error: 'The storage service is not active for your firm yet. Please contact the portal provider.' });
    if (!a.client_id) return res.status(409).json({ error: 'This booking has no client record yet.' });
    fs.mkdirSync(REC_DIR, { recursive: true }); const rid = L.rand(8);
    fs.writeFileSync(part(a, rid), ''); audit(T(req), req.user.id, 'recording_started', 'appointment', a.id, null, L.ip(req));
    res.json({ rid });
  });
  app.post('/api/appointments/:id/recording/chunk', host, require('express').raw({ type: () => true, limit: '40mb' }), (req, res) => {
    const a = load(req, res); if (!a) return;
    const p = part(a, String(req.query.rid || '')); if (!fs.existsSync(p)) return res.status(404).json({ error: 'Recording session not found.' });
    const size = fs.statSync(p).size, off = Number(req.query.off);
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty piece.' });
    if (off < size) return res.json({ size }); // piece already received (retry)
    if (off > size) return res.status(409).json({ error: 'A piece is missing.', size });
    if (size + req.body.length > MAX_REC) return res.status(413).json({ error: 'Recording is too large; stop and start a new one.' });
    fs.appendFileSync(p, req.body); res.json({ size: size + req.body.length });
  });
  app.post('/api/appointments/:id/recording/finish', host, async (req, res) => {
    try {
      const a = load(req, res); if (!a) return; const t = T(req);
      const p = part(a, String(req.body.rid || '')); if (!fs.existsSync(p) || fs.statSync(p).size === 0) return res.status(404).json({ error: 'Nothing was recorded.' });
      const parent = recFolder(t, a.client_id), when = new Date(a.start_at).toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour12: false }).replace(',', '').replace(/:/g, '.').slice(0, 16);
      const name = app.locals.fsHelpers.unique(t, a.client_id, parent, `Consultation ${when} - ${a.name}.webm`.replace(/[\\/:*?"<>|]/g, '-'));
      const r = db.prepare("INSERT INTO fs_nodes(tenant_id,client_id,parent_id,kind,name,mime,size,storage,client_visible,created_by,dirty) VALUES (?,?,?,?,?,?,?,?,0,?,0)").run(t, a.client_id, parent, 'file', name, 'video/webm', fs.statSync(p).size, 'gdrive', req.user.id);
      try { await Drive.pushFile(t, r.lastInsertRowid, p, 'video/webm'); }
      catch (e) { db.prepare('DELETE FROM fs_nodes WHERE id=?').run(r.lastInsertRowid); return res.status(502).json({ error: 'Could not save to Google Drive: ' + e.message + ' (the recording is kept; press Save again).' }); }
      fs.unlinkSync(p);
      db.prepare("UPDATE appointments SET rec_status='recorded in portal', rec_node_id=? WHERE id=?").run(r.lastInsertRowid, a.id);
      audit(t, req.user.id, 'recording_saved', 'appointment', a.id, name, L.ip(req));
      res.json({ id: r.lastInsertRowid, name });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Could not save the recording.' }); }
  });
};
Object.assign(module.exports, { createFor, cancelFor, filterLinks, mayJoin, collectRecordings, startWorker });
