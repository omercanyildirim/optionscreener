import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
const { sign, SESSION_COOKIE, STATE_COOKIE } = await import('../lib/session.js');
const legal = await import('../lib/legal.js');
const loginApi = await import('../api/auth/login.js');
const callback = await import('../api/auth/callback.js');
const userdata = await import('../api/userdata.js');
const configApi = await import('../api/config.js');
const middleware = (await import('../middleware.js')).default;

let R;
function redis(args) {
  const [c, k, ...a] = args.map(String); const C = c.toUpperCase();
  const h = () => (R[k] ||= {}); const l = () => (R[k] ||= []);
  const range = (arr, s, e) => arr.slice(+s, +e === -1 ? undefined : +e + 1);
  switch (C) {
    case 'GET': return R[k] ?? null;
    case 'SET': R[k] = a[0]; return 'OK';
    case 'DEL': [k, ...a].forEach(x => delete R[x]); return 1;
    case 'EXPIRE': return 1;
    case 'LPUSH': l().unshift(...a.reverse()); return R[k].length;
    case 'RPUSH': l().push(...a); return R[k].length;
    case 'LTRIM': R[k] = range(l(), a[0], a[1]); return 'OK';
    case 'LRANGE': return range(l(), a[0], a[1]);
    case 'ZADD': h()[a[1]] = +a[0]; return 1;
    case 'ZREM': delete h()[a[0]]; return 1;
    case 'ZREVRANGE': return Object.entries(h()).sort((x, y) => y[1] - x[1]).map(x => x[0]);
    case 'HSETNX': if (h()[a[0]] == null) h()[a[0]] = a[1]; return 1;
    case 'HSET': for (let i = 0; i < a.length; i += 2) h()[a[i]] = a[i + 1]; return 1;
    case 'SADD': (R[k] ||= new Set()); a.forEach(x => R[k].add(x)); return 1;
    case 'SREM': if (R[k] instanceof Set) a.forEach(x => R[k].delete(x)); return 1;
    case 'HGET': return (R[k] || {})[a[0]] ?? null;
    case 'HINCRBY': h()[a[0]] = String((+h()[a[0]] || 0) + +a[1]); return 1;
    case 'HGETALL': return Object.entries(R[k] || {}).flat();
    default: throw new Error('unsupported ' + C);
  }
}

beforeEach(() => {
  R = {};
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't',
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' });
  delete process.env.PAYWALL;
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.startsWith('https://kv.example')) {
      const body = JSON.parse(init.body);
      if (u.endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
      return new Response(JSON.stringify({ result: redis(body) }));
    }
    return new Response('{}', { status: 404 });
  };
});

async function req(path, { email = 'user@example.com', method = 'GET' } = {}) {
  const t = await sign({ email, name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, { method, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}`, origin: 'https://os.example.com' } });
}

test('sign-in requires accepting the current terms', async () => {
  let r = await loginApi.GET(new Request('https://os.example.com/api/auth/login?next=/x'));
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^\/login\?consent=required/);
  r = await loginApi.GET(new Request('https://os.example.com/api/auth/login?consent=2020-01-01'));
  assert.match(r.headers.get('location'), /consent=required/);
  r = await loginApi.GET(new Request(`https://os.example.com/api/auth/login?consent=${legal.LEGAL_VERSION}`));
  assert.match(r.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
});

test('acceptance is recorded at sign-in, with version, time and IP', async () => {
  const state = await sign({ state: 's1', next: '/', consent: legal.LEGAL_VERSION, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = { aud: 'cid', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email: 'u@example.com', name: 'U', sub: '1' };
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).startsWith('https://oauth2') ? new Response(JSON.stringify({ id_token: `${b64({})}.${b64(claims)}.x` })) : real(u, i);
  const r = await callback.GET(new Request('https://os.example.com/api/auth/callback?state=s1&code=c', { headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(state)}`, 'x-forwarded-for': '198.51.100.7' } }));
  assert.equal(r.status, 302);
  const u = R['os:u:u@example.com'];
  assert.equal(u.consentVersion, legal.LEGAL_VERSION); assert.equal(u.consentIp, '198.51.100.7'); assert.equal(u.consentHow, 'sign-in'); assert.ok(u.consentAt);
  assert.ok(R['os:ev:u@example.com'].some(l => JSON.parse(l).type === 'consent'));
});

test('existing users are asked once in the app', async () => {
  let c = await (await configApi.GET(await req('/api/config'))).json();
  assert.equal(c.legal.accepted, false);
  assert.equal((await userdata.PUT(await req('/api/userdata?a=consent', { method: 'PUT' }))).status, 200);
  c = await (await configApi.GET(await req('/api/config'))).json();
  assert.equal(c.legal.accepted, true);
  assert.equal(R['os:u:user@example.com'].consentHow, 'in-app');
});

test('download my data returns everything stored about the user', async () => {
  R['os:u:user@example.com'] = { name: 'N', city: 'Istanbul' };
  R['os:user:user@example.com'] = JSON.stringify({ presets: [{ name: 'p' }] });
  R['os:ev:user@example.com'] = [JSON.stringify({ t: 1, e: 'user@example.com', type: 'search', d: 'SPY' })];
  const r = await userdata.GET(await req('/api/userdata?a=export'));
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const j = await r.json();
  assert.equal(j.profile.city, 'Istanbul'); assert.equal(j.settings.presets[0].name, 'p'); assert.equal(j.activity[0].d, 'SPY');
});

test('delete account erases the user everywhere and signs out', async () => {
  const mine = JSON.stringify({ t: 1, e: 'user@example.com', type: 'search' }), other = JSON.stringify({ t: 2, e: 'b@example.com', type: 'search' });
  Object.assign(R, { 'os:u:user@example.com': { a: 1 }, 'os:user:user@example.com': '{}', 'os:ev:user@example.com': [mine], 'os:events': [mine, other], 'os:users': { 'user@example.com': 1, 'b@example.com': 2 } });
  const r = await userdata.DELETE(await req('/api/userdata', { method: 'DELETE' }));
  assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /os_session=;/);
  for (const k of ['os:u:user@example.com', 'os:user:user@example.com', 'os:ev:user@example.com']) assert.equal(R[k], undefined);
  assert.deepEqual(R['os:events'], [other]); assert.deepEqual(Object.keys(R['os:users']), ['b@example.com']);
});

test('an active subscription must be cancelled before deleting', async () => {
  R['os:sub:user@example.com'] = JSON.stringify({ status: 'active' });
  assert.equal((await userdata.DELETE(await req('/api/userdata', { method: 'DELETE' }))).status, 409);
  R['os:sub:user@example.com'] = JSON.stringify({ status: 'active', cancelAt: '2026-12-19T00:00:00Z' });
  assert.equal((await userdata.DELETE(await req('/api/userdata', { method: 'DELETE' }))).status, 200);
});

test('legal pages are public (outside the sign-in middleware)', async () => {
  const { config } = await import('../middleware.js');
  const re = new RegExp('^' + config.matcher[0].replace(/\(\?!/, '(?!') + '$');
  for (const p of ['/terms', '/privacy', '/refund']) assert.equal(re.test(p), false, p);
  for (const p of ['/', '/admin', '/api/config']) assert.equal(re.test(p), true, p);
});

test('SEO: public pages, sitemap and robots are open to crawlers; the app is not indexed', async () => {
  const fs = await import('node:fs');
  const { config } = await import('../middleware.js');
  const re = new RegExp('^' + config.matcher[0] + '$');
  for (const p of ['/home', '/options-flow', '/options-screener', '/option-chain', '/unusual-options-activity', '/sitemap.xml', '/robots.txt', '/og.png', '/css/site.css', '/favicon.svg', '/apple-touch-icon.png'])
    assert.equal(re.test(p), false, p);
  const robots = fs.readFileSync('public/robots.txt', 'utf8');
  assert.match(robots, /Allow: \//); assert.doesNotMatch(robots, /Disallow: \/\s*$/m); assert.match(robots, /Sitemap: https:\/\/optionscreener\.org\/sitemap\.xml/);
  const sm = fs.readFileSync('public/sitemap.xml', 'utf8');
  for (const p of ['/', '/options-flow', '/unusual-options-activity']) assert.ok(sm.includes(`<loc>https://optionscreener.org${p}</loc>`), p);
  for (const f of ['home', 'options-flow', 'options-screener', 'option-chain', 'unusual-options-activity']) {
    const h = fs.readFileSync(`public/${f}.html`, 'utf8');
    assert.match(h, /<link rel="canonical" href="https:\/\/optionscreener\.org\//, f);
    assert.equal((h.match(/<h1>/g) || []).length, 1, f + ' has one h1');
    const d = h.match(/<meta name="description" content="([^"]+)"/)[1]; assert.ok(d.length >= 110 && d.length <= 170, `${f} description length ${d.length}`);
    JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  }
  assert.match(fs.readFileSync('public/index.html', 'utf8'), /<meta name="robots" content="noindex">/);
});

test('scanner probes get a plain 404 before any other work', async () => {
  for (const p of ['/.env', '/wp-login.php', '/.git/config', '/phpmyadmin/', '/api/x.php', '/cgi-bin/x']) {
    const r = await middleware(new Request('https://os.example.com' + p)); assert.equal(r.status, 404, p);
  }
  const r = await middleware(new Request('https://os.example.com/admin')); assert.equal(r.status, 302);
});
