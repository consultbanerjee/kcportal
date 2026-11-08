'use strict';
// Shared AI plumbing: per-firm settings, encrypted secrets, Anthropic API calls, usage metering.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

// ---- settings (key/value per firm) ----
const getS = (tid, key, def = '') => { const r = db.prepare('SELECT value FROM firm_settings WHERE tenant_id=? AND key=?').get(tid, key); return r && r.value != null ? r.value : def; };
const setS = (tid, key, value) => db.prepare('INSERT INTO firm_settings(tenant_id,key,value) VALUES (?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value').run(tid, key, value == null ? '' : String(value));
const on = (tid, feature) => getS(tid, 'ai_' + feature, '0') === '1';

// ---- secrets: AES-256-GCM, key from SECRET_KEY env or an auto-generated file in the data dir ----
function masterKey() {
  if (process.env.SECRET_KEY) return crypto.createHash('sha256').update(process.env.SECRET_KEY).digest();
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8')).digest();
}
function enc(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(blob) {
  if (!blob || !blob.startsWith('v1:')) return '';
  try {
    const b = Buffer.from(blob.slice(3), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', masterKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}
const secret = (tid, key) => dec(getS(tid, key));
const setSecret = (tid, key, v) => setS(tid, key, v ? enc(v) : '');

// ---- Anthropic Messages API ----
let transport = null; // tests replace this
const setTransport = (fn) => { transport = fn; };
const apiKey = (tid) => secret(tid, 'ai_key') || process.env.ANTHROPIC_API_KEY || '';
const model = (tid) => getS(tid, 'ai_model') || process.env.AI_MODEL || 'claude-sonnet-5-5';
const configured = (tid) => !!transport || !!apiKey(tid);

async function call(tid, feature, { system, messages, tools, tool_choice, max_tokens = 4000 }) {
  const body = { model: model(tid), max_tokens, system, messages };
  if (tools) { body.tools = tools; if (tool_choice) body.tool_choice = tool_choice; }
  let res;
  if (transport) res = await transport(body, { tid, feature });
  else {
    const key = apiKey(tid);
    if (!key) throw Object.assign(new Error('AI is not set up yet. The administrator must add the API key in AI Control.'), { status: 503 });
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 170000);
    let r;
    try {
      r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (e) { throw Object.assign(new Error('Could not reach the AI service. Please try again.'), { status: 502 }); }
    finally { clearTimeout(timer); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('AI error', r.status, j && j.error && j.error.message);
      const msg = r.status === 401 ? 'The AI API key is not valid. The administrator should check it in AI Control.' : r.status === 429 ? 'The AI service is busy or the usage limit is reached. Please try again shortly.' : 'The AI service could not complete this request.';
      throw Object.assign(new Error(msg), { status: 502 });
    }
    res = j;
  }
  try { db.prepare('INSERT INTO ai_usage(tenant_id,feature,in_tok,out_tok) VALUES (?,?,?,?)').run(tid, feature, (res.usage && res.usage.input_tokens) || 0, (res.usage && res.usage.output_tokens) || 0); } catch (e) {}
  return res;
}
const textOf = (res) => (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

function firmInfo(tid) {
  const t = db.prepare('SELECT name FROM tenants WHERE id=?').get(tid) || {};
  let s = {}; try { s = JSON.parse((db.prepare('SELECT settings FROM tenant_templates WHERE tenant_id=?').get(tid) || {}).settings || '{}'); } catch (e) {}
  return { name: t.name || 'the firm', phone: s.phone || '', email: s.email || '', address: s.address || '', website: s.website || '', signatory: [s.signatory_name, s.signatory_title].filter(Boolean).join(', ') };
}

module.exports = { getS, setS, on, enc, dec, secret, setSecret, setTransport, call, textOf, configured, apiKey, model, firmInfo };
