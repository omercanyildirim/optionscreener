import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const quota = await import('../lib/quota.js');
const massiveApi = await import('../api/massive.js');
const trackedApi = await import('../api/tracked.js');
const configApi = await import('../api/config.js');
const callback = await import('../api/auth/callback.js');
const activity = await import('../lib/activity.js');

// Tiny in-memory Redis behind Upstash's REST shape (only what these tests use).
let R;
function redis(args) {
  const [c, k, ...a] = args.map(String); const C = c.toUpperCase();
  const h = () => (R[k] ||= {}); const st = () => (R[k] ||= new Set());
  switch (C) {
    case 'GET': return R[k] ?? null;
    case 'SET': R[k] = a[0]; return 'OK';
    case 'EXPIRE': return 1;
    case 'SADD': a.forEach(x => st().add(x)); return 1;
    case 'SISMEMBER': return R[k] instanceof Set && R[k].has(a[0]) ? 1 : 0;
    case 'SCARD': return R[k] instanceof Set ? R[k].size : 0;
    case 'SMEMBERS': return R[k] instanceof Set ? [...R[k]] : [];
    case 'ZADD': h()[a[1]] = +a[0]; return 1;
    case 'ZREVRANGE': return Object.entries(h()).sort((x, y) => y[1] - x[1]).map(x => x[0]);
    case 'HSETNX': if (h()[a[0]] == null) h()[a[0]] = a[1]; return 1;
    case 'HSET': for (let i = 0; i < a.length; i += 2) h()[a[i]] = a[i + 1]; return 1;
    case 'HINCRBY': h()[a[0]] = String((+h()[a[0]] || 0) + +a[1]); return 1;
    case 'HGETALL': return Object.entries(R[k] || {}).flat();
    case 'LPUSH': (R[k] ||= []).unshift(...a); return 1;
    case 'LTRIM': case 'LRANGE': return [];
    default: throw new Error('unsupported ' + C);
  }
}

beforeEach(() => {
  R = {};
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't',
    PADDLE_CLIENT_TOKEN: 'tok', PADDLE_PRICE_ID: 'pri_1', PAYWALL: 'true', MASSIVE_API_KEY: 'k', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' });
  delete process.env.FREE_LOOKS; delete process.env.ALPACA_KEY_ID; delete process.env.ALPACA_SECRET_KEY;
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.startsWith('https://kv.example')) {
      const body = JSON.parse(init.body);
      if (u.endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
      return new Response(JSON.stringify({ result: redis(body) }));
    }
    return new Response(JSON.stringify({ results: [], tickers: [] }), { status: 200 }); // market data
  };
});

async function req(path, email = 'user@example.com') {
  const t = await sign({ email, name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}` } });
}

test('free users get 3 symbols a day, then all data is locked', async () => {
  for (const s of ['SPY', 'NVDA', 'TSLA']) assert.equal((await massiveApi.GET(await req(`/api/massive?path=v3/snapshot/options/${s}`))).status, 200);
  // re-opening a symbol already used today is free
  assert.equal((await massiveApi.GET(await req('/api/massive?path=v3/snapshot/options/SPY'))).status, 200);
  const c = await (await configApi.GET(await req('/api/config'))).json();
  assert.deepEqual(c.free.used.sort(), ['NVDA', 'SPY', 'TSLA']); assert.equal(c.free.left, 0); assert.equal(c.free.walled, false);
  // a fourth symbol hits the wall
  const r = await massiveApi.GET(await req('/api/massive?path=v3/snapshot/options/AAPL'));
  assert.equal(r.status, 402); assert.equal((await r.json()).error, 'free_limit');
  // after that, every data endpoint is locked for the day, including symbols already opened
  assert.equal((await massiveApi.GET(await req('/api/massive?path=v3/snapshot/options/SPY'))).status, 402);
  assert.equal((await massiveApi.GET(await req('/api/massive?path=v2/snapshot/locale/us/markets/stocks/tickers&tickers=SPY'))).status, 402);
  assert.equal((await trackedApi.GET(await req('/api/tracked?c=O:SPY261218C00600000'))).status, 402);
  assert.equal((await (await configApi.GET(await req('/api/config'))).json()).free.walled, true);
  // the next New York day starts fresh
  assert.equal(await quota.checkQuota('user@example.com', 'AAPL', Date.now() + 86400e3 * 1.5), null);
});

test('Pro subscribers, admins and a switched-off paywall are never metered', async () => {
  R['os:sub:pro@example.com'] = JSON.stringify({ status: 'active' });
  for (const email of ['pro@example.com', 'admin@example.com'])
    for (const s of ['A', 'B', 'C', 'D', 'E']) assert.equal((await massiveApi.GET(await req(`/api/massive?path=v3/snapshot/options/${s}`, email))).status, 200);
  process.env.PAYWALL = 'false';
  for (const s of ['A', 'B', 'C', 'D', 'E']) assert.equal((await massiveApi.GET(await req(`/api/massive?path=v3/snapshot/options/${s}`))).status, 200);
  assert.equal((await (await configApi.GET(await req('/api/config'))).json()).free, null);
});

test('FREE_LOOKS changes the daily allowance', async () => {
  process.env.FREE_LOOKS = '1';
  assert.equal((await massiveApi.GET(await req('/api/massive?path=v3/snapshot/options/SPY'))).status, 200);
  assert.equal((await massiveApi.GET(await req('/api/massive?path=v3/snapshot/options/QQQ'))).status, 402);
});

test('Google sign-in saves the profile for the admin portal', async () => {
  const { sign: s2, STATE_COOKIE } = await import('../lib/session.js');
  const state = await s2({ state: 'st1', next: '/', exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
  const claims = { aud: 'cid', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email: 'New@Example.com',
    name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace', picture: 'https://lh3.googleusercontent.com/a/x', locale: 'en', sub: '1234567890' };
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).startsWith('https://oauth2.googleapis.com')
    ? new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig` })) : realFetch(u, init);
  const r = await callback.GET(new Request('https://os.example.com/api/auth/callback?state=st1&code=c', { headers: {
    cookie: `${STATE_COOKIE}=${encodeURIComponent(state)}`, 'x-vercel-ip-country': 'TR', 'x-vercel-ip-city': 'Istanbul', 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'Mozilla/5.0 Test' } }));
  assert.equal(r.status, 302);
  const h = R['os:u:new@example.com'];
  assert.equal(h.givenName, 'Ada'); assert.equal(h.familyName, 'Lovelace'); assert.equal(h.googleId, '1234567890');
  assert.equal(h.picture, 'https://lh3.googleusercontent.com/a/x'); assert.equal(h.city, 'Istanbul'); assert.equal(h.country, 'TR');
  assert.equal(h.ip, '203.0.113.9'); assert.equal(h.device, 'Mozilla/5.0 Test'); assert.ok(h.lastLogin);
  const ov = await activity.overview();
  assert.equal(ov.users[0].profile.givenName, 'Ada');
});
