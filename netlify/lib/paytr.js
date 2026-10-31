// Shared helpers for PayTR + Supabase (server side only; secrets come from Netlify env vars)
const crypto = require('crypto');
const SB = 'https://sqvwgghdksxmstmucxdm.supabase.co';
const ANON = 'sb_publishable_JNL2rwjFyL4F7C5iK2xmfQ_fIaWla5h';
const TIERS = [{ min: 25000, pct: 30 }, { min: 10000, pct: 25 }, { min: 0, pct: 20 }];

function svcHeaders(extra) {
  const k = process.env.SUPABASE_SERVICE_KEY || '';
  const h = { apikey: k, 'Content-Type': 'application/json' };
  if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k; // legacy JWT service_role key
  return Object.assign(h, extra || {});
}
async function sb(path, opt = {}) {
  const r = await fetch(SB + path, Object.assign({}, opt, { headers: svcHeaders(opt.headers) }));
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 200));
  return d;
}
async function userFromToken(token) {
  if (!token) return null;
  const r = await fetch(SB + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
  return r.ok ? r.json() : null;
}
const hmac = (str) => crypto.createHmac('sha256', process.env.PAYTR_MERCHANT_KEY).update(str).digest('base64');
const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
module.exports = { sb, userFromToken, hmac, json, TIERS };
