import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
const { sign, SESSION_COOKIE, isAllowed } = await import('../lib/session.js');
const totp = await import('../lib/totp.js');
const status = await import('../api/admin/status.js');
const setup = await import('../api/admin/setup.js');
const verifyApi = await import('../api/admin/verify.js');
const overviewApi = await import('../api/admin/overview.js');
const trackApi = await import('../api/track.js');

// Tiny in-memory Redis behind Upstash's REST shape.
let R;
function redis(args) {
  const [c, k, ...a] = args.map(String); const C = c.toUpperCase();
  const h = () => (R[k] ||= {}); const l = () => (R[k] ||= []);
  switch (C) {
    case 'GET': return R[k] ?? null;
    case 'SET': if (a.includes('NX') && R[k] != null) return null; R[k] = a[0]; return 'OK';
    case 'DEL': delete R[k]; return 1;
    case 'INCR': R[k] = String((+R[k] || 0) + 1); return +R[k];
    case 'INCRBY': R[k] = String((+R[k] || 0) + +a[0]); return +R[k];
    case 'EXPIRE': return 1;
    case 'LPUSH': l().unshift(...a.reverse()); return R[k].length;
    case 'LTRIM': R[k] = l().slice(+a[0], +a[1] + 1); return 'OK';
    case 'LRANGE': return l().slice(+a[0], +a[1] + 1);
    case 'ZADD': h()[a[1]] = +a[0]; return 1;
    case 'ZREVRANGE': return Object.entries(h()).sort((x, y) => y[1] - x[1]).map(x => x[0]);
    case 'HSETNX': if (h()[a[0]] == null) h()[a[0]] = a[1]; return 1;
    case 'HSET': for (let i = 0; i < a.length; i += 2) h()[a[i]] = a[i + 1]; return 1;
    case 'HINCRBY': h()[a[0]] = String((+h()[a[0]] || 0) + +a[1]); return 1;
    case 'HGETALL': return Object.entries(R[k] || {}).flat();
    default: throw new Error('unsupported ' + C);
  }
}

beforeEach(() => {
  R = {};
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't' });
  delete process.env.ADMIN_TOTP_SECRET;
  globalThis.fetch = async (u, init) => {
    const body = JSON.parse(init.body);
    if (String(u).endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
    return new Response(JSON.stringify({ result: redis(body) }));
  };
});

async function req(path, { email = 'admin@example.com', method = 'GET', body, extraCookie = '' } = {}) {
  const t = await sign({ email, name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}${extraCookie ? '; ' + extraCookie : ''}`, 'content-type': 'application/json' },
  });
}
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];

test('TOTP matches the RFC 6238 test vector and base32 round-trips', async () => {
  const sec = totp.base32Encode(new TextEncoder().encode('12345678901234567890'));
  assert.equal(sec, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(await totp.totpAt(sec, 1), '287082');
  assert.equal(await totp.verifyTotp(sec, '287082', 59000), 1);
  assert.equal(await totp.verifyTotp(sec, '000000', 59000), null);
  assert.equal(totp.newSecret().length, 32);
});

test('admins can always sign in; others see no admin access', async () => {
  process.env.ALLOWED_EMAILS = 'someone@example.com';
  assert.ok(isAllowed('admin@example.com'));
  process.env.ALLOWED_EMAILS = '*';
  const j = await (await status.GET(await req('/api/admin/status', { email: 'user@example.com' }))).json();
  assert.equal(j.admin, false);
  assert.equal((await setup.POST(await req('/api/admin/setup', { email: 'user@example.com', method: 'POST', body: {} }))).status, 403);
  assert.equal((await overviewApi.GET(await req('/api/admin/overview', { email: 'user@example.com' }))).status, 403);
});

test('setup -> code -> dashboard; wrong and reused codes are refused', async () => {
  let st = await (await status.GET(await req('/api/admin/status'))).json();
  assert.equal(st.admin, true); assert.equal(st.totpConfigured, false);
  const s = await (await setup.POST(await req('/api/admin/setup', { method: 'POST', body: {} }))).json();
  assert.match(s.uri, /^otpauth:\/\/totp\//);
  assert.equal((await setup.POST(await req('/api/admin/setup', { method: 'POST', body: { secret: s.secret, code: '000000' } }))).status, 400);
  const code = await totp.totpAt(s.secret, Math.floor(Date.now() / 30000));
  const ok = await setup.POST(await req('/api/admin/setup', { method: 'POST', body: { secret: s.secret, code } }));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).stored, true);
  const adminC = cookieOf(ok);
  // a second setup cannot replace the authenticator
  assert.equal((await setup.POST(await req('/api/admin/setup', { method: 'POST', body: {} }))).status, 409);
  // dashboard needs the admin cookie
  assert.equal((await overviewApi.GET(await req('/api/admin/overview'))).status, 403);
  const ov = await overviewApi.GET(await req('/api/admin/overview', { extraCookie: adminC }));
  assert.equal(ov.status, 200);
  // the same code cannot be used again
  assert.equal((await verifyApi.POST(await req('/api/admin/verify', { method: 'POST', body: { code } }))).status, 400);
  st = await (await status.GET(await req('/api/admin/status', { extraCookie: adminC }))).json();
  assert.equal(st.verified, true);
});

test('too many wrong codes lock verification for a while', async () => {
  process.env.ADMIN_TOTP_SECRET = totp.newSecret();
  for (let i = 0; i < 5; i++) assert.equal((await verifyApi.POST(await req('/api/admin/verify', { method: 'POST', body: { code: '123456' } }))).status, 400);
  const good = await totp.totpAt(process.env.ADMIN_TOTP_SECRET, Math.floor(Date.now() / 30000));
  assert.equal((await verifyApi.POST(await req('/api/admin/verify', { method: 'POST', body: { code: good } }))).status, 429);
});

test('activity is recorded and shown per user', async () => {
  await trackApi.POST(await req('/api/track', { email: 'user@example.com', method: 'POST', body: { events: [{ type: 'search', detail: 'NVDA' }, { type: 'hack', detail: 'x' }, { type: 'watch_add', detail: 'SPY261218C00600000' }] } }));
  process.env.ADMIN_TOTP_SECRET = totp.newSecret();
  const code = await totp.totpAt(process.env.ADMIN_TOTP_SECRET, Math.floor(Date.now() / 30000));
  const v = await verifyApi.POST(await req('/api/admin/verify', { method: 'POST', body: { code } }));
  const c = cookieOf(v);
  const j = await (await overviewApi.GET(await req('/api/admin/overview', { extraCookie: c }))).json();
  assert.equal(j.users.length, 1);
  assert.equal(j.users[0].email, 'user@example.com');
  assert.equal(j.users[0].events, 2);
  assert.deepEqual(j.events.map(e => e.type).sort(), ['search', 'watch_add']);
  const d = await (await overviewApi.GET(await req('/api/admin/overview?email=user@example.com', { extraCookie: c }))).json();
  assert.equal(d.events.length, 2);
});
