// What users do on the site, for the admin portal. Stored in Redis when it is connected; otherwise a no-op.
import { storeConfigured, pipe } from './store.js';

export const EVENT_TYPES = new Set([
  'login', 'logout', 'session', 'view', 'search', 'chain', 'insight', 'all_stocks',
  'filter_save', 'filter_load', 'filter_delete', 'filter_default', 'watch_add', 'watch_remove', 'settings_saved',
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
export const logEvent = (email, type, detail, meta) => logEvents(email, [{ type, detail }], meta);

const parse = s => { try { return JSON.parse(s); } catch { return null; } };

export async function overview() {
  const [users, events] = await pipe([['ZREVRANGE', 'os:users', '0', '499'], ['LRANGE', 'os:events', '0', '499']]);
  const emails = users || [];
  const res = emails.length ? await pipe(emails.flatMap(e => [['HGETALL', `os:u:${e}`], ['GET', `os:user:${e}`]])) : [];
  const rows = emails.map((email, i) => {
    const h = res[i * 2] || [], data = parse(res[i * 2 + 1]) || {};
    const o = {}; for (let k = 0; k < h.length; k += 2) o[h[k]] = h[k + 1];
    return {
      email, name: o.name || '', country: o.country || '', first: +o.first || null, last: +o.last || null,
      logins: +o.logins || 0, events: +o.events || 0, lastType: o.lastType || '',
      presets: (data.presets || []).length, tracked: (data.tracked || []).length, watch: data.watch || '',
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
