// What users do on the site, for the admin portal. Stored in Redis when it is connected; otherwise a no-op.
import { storeConfigured, pipe } from './store.js';

export const EVENT_TYPES = new Set([
  'login', 'logout', 'session', 'view', 'search', 'chain', 'insight', 'all_stocks',
  'filter_save', 'filter_load', 'filter_delete', 'filter_default', 'watch_add', 'watch_remove', 'settings_saved', 'consent', 'data_export', 'payment', 'marketing', 'comp',
]);
const MAX_ALL = 10000, MAX_USER = 1000;
const clean = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);

export async function logEvents(email, events, meta = {}) {
  if (!storeConfigured() || !email) return;
  email = String(email).toLowerCase();
  const now = Date.now();
  const ok = events.filter(e => e && EVENT_TYPES.has(e.type)).slice(0, 30);
  const list = ok.map(e => JSON.stringify({ t: now, e: email, type: e.type, d: clean(e.detail) }));
  if (!list.length) return;
  const u = `os:u:${email}`;
  const cmds = [
    ['LPUSH', 'os:events', ...list], ['LTRIM', 'os:events', '0', String(MAX_ALL - 1)],
    ['LPUSH', `os:ev:${email}`, ...list], ['LTRIM', `os:ev:${email}`, '0', String(MAX_USER - 1)],
    ['ZADD', 'os:users', String(now), email],
    ['HSETNX', u, 'first', String(now)],
    ['HSET', u, 'last', String(now), 'lastType', ok[ok.length - 1].type,
      ...(meta.name ? ['name', clean(meta.name, 80)] : []), ...(meta.country ? ['country', clean(meta.country, 4)] : [])],
    ['HINCRBY', u, 'events', String(list.length)],
  ];
  if (ok.some(e => e.type === 'login')) cmds.push(['HINCRBY', u, 'logins', '1']);
  try { await pipe(cmds); } catch { /* logging must never break the site */ }
}
// Google profile and sign-in details, saved on every Google sign-in (os:u:<email> hash, shown in the admin portal).
export const PROFILE_FIELDS = ['name', 'givenName', 'familyName', 'picture', 'locale', 'googleId', 'domain', 'country', 'region', 'city', 'ip', 'device', 'lastLogin'];
export async function saveProfile(email, p) {
  if (!storeConfigured() || !email) return;
  email = String(email).toLowerCase();
  const kv = [];
  for (const f of PROFILE_FIELDS) if (p[f] != null && p[f] !== '') kv.push(f, clean(p[f], f === 'picture' || f === 'device' ? 300 : 120));
  const cmds = [['ZADD', 'os:users', String(Date.now()), email], ['HSETNX', `os:u:${email}`, 'first', String(Date.now())]];
  if (kv.length) cmds.push(['HSET', `os:u:${email}`, 'email', email, ...kv]);
  try { await pipe(cmds); } catch { /* never block sign-in */ }
}
export const logEvent = (email, type, detail, meta) => logEvents(email, [{ type, detail }], meta);

const parse = s => { try { return JSON.parse(s); } catch { return null; } };

export async function overview() {
  const [users, events] = await pipe([['ZREVRANGE', 'os:users', '0', '499'], ['LRANGE', 'os:events', '0', '499']]);
  const emails = users || [];
  const res = emails.length ? await pipe(emails.flatMap(e => [['HGETALL', `os:u:${e}`], ['GET', `os:user:${e}`], ['GET', `os:sub:${e}`], ['GET', `os:comp:${e}`]])) : [];
  const rows = emails.map((email, i) => {
    const h = res[i * 4] || [], data = parse(res[i * 4 + 1]) || {}, sub = parse(res[i * 4 + 2]), compRaw = parse(res[i * 4 + 3]);
    const comp = compRaw && (!compRaw.until || Date.parse(compRaw.until) > Date.now()) ? compRaw : null;
    const o = {}; for (let k = 0; k < h.length; k += 2) o[h[k]] = h[k + 1];
    return {
      email, name: o.name || '', country: o.country || '', city: o.city || '', picture: o.picture || '', locale: o.locale || '',
      consent: o.consentVersion ? { version: o.consentVersion, at: o.consentAt || null, how: o.consentHow || '' } : null,
      profile: Object.fromEntries(PROFILE_FIELDS.filter(f => o[f]).map(f => [f, o[f]])), first: +o.first || null, last: +o.last || null,
      logins: +o.logins || 0, events: +o.events || 0, lastType: o.lastType || '',
      presets: (data.presets || []).length, tracked: (data.tracked || []).length, watch: data.watch || '',
      plan: sub && ['active', 'trialing', 'past_due'].includes(sub.status) ? 'Pro' : comp ? 'Pro (free)' : sub ? `Free (${sub.status})` : 'Free',
      sub: sub || null, comp,
      marketing: o.marketing === '1', marketingAt: o.marketingAt || null, marketingHow: o.marketingHow || '',
    };
  });
  return { users: rows, events: (events || []).map(parse).filter(Boolean) };
}

export async function userDetail(email) {
  email = String(email).toLowerCase();
  const [events, data] = await pipe([['LRANGE', `os:ev:${email}`, '0', '499'], ['GET', `os:user:${email}`]]);
  const d = parse(data) || {};
  return {
    email, events: (events || []).map(parse).filter(Boolean),
    presets: (d.presets || []).map(p => ({ name: p.name, updatedAt: p.updatedAt })),
    tracked: d.tracked || [], watch: d.watch || '',
  };
}
