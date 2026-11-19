import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
beforeEach(() => {
  Object.assign(process.env, {
    SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'me@example.com', MASSIVE_API_KEY: 'SECRETKEY123',
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', APP_URL: 'https://os.example.com',
  });
});

const { sign, verify, getSession, SESSION_COOKIE } = await import('../lib/session.js');
const { scrub, isAllowedPath, parseOptionTicker } = await import('../lib/massive.js');
const middleware = (await import('../middleware.js')).default;
const massiveApi = await import('../api/massive.js');
const tracked = await import('../api/tracked.js');
const login = await import('../api/auth/login.js');
const callback = await import('../api/auth/callback.js');

async function sessionCookie(email = 'me@example.com') {
  const t = await sign({ email, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return `${SESSION_COOKIE}=${encodeURIComponent(t)}`;
}
const req = (url, cookie) => new Request(url, { headers: cookie ? { cookie } : {} });

test('session sign/verify, tamper and expiry', async () => {
  const t = await sign({ email: 'a', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  assert.equal((await verify(t, SECRET)).email, 'a');
  assert.equal(await verify(t + 'x', SECRET), null);
  assert.equal(await verify(t, 'y'.repeat(40)), null);
  const old = await sign({ email: 'a', exp: 1 }, SECRET);
  assert.equal(await verify(old, SECRET), null);
});

test('allow-list enforced on every request', async () => {
  assert.ok(await getSession(req('https://x/', await sessionCookie())));
  assert.equal(await getSession(req('https://x/', await sessionCookie('other@example.com'))), null);
});

test('ALLOWED_EMAILS="*" lets any signed-in Google account in', async () => {
  process.env.ALLOWED_EMAILS = '*';
  assert.ok(await getSession(req('https://x/', await sessionCookie('anyone@gmail.com'))));
  process.env.ALLOWED_EMAILS = '';
  assert.equal(await getSession(req('https://x/', await sessionCookie('anyone@gmail.com'))), null);
});

test('middleware redirects pages, 401s APIs, passes signed-in users', async () => {
  const r0 = await middleware(req('https://os.example.com/'));
  assert.equal(new URL(r0.headers.get('location')).pathname + new URL(r0.headers.get('location')).search, '/login');
  const r1 = await middleware(req('https://os.example.com/?a=1'));
  assert.equal(r1.status, 302);
  assert.match(r1.headers.get('location'), /\/login\?next=%2F%3Fa%3D1$/);
  const r2 = await middleware(req('https://os.example.com/api/massive?path=x'));
  assert.equal(r2.status, 401);
  assert.equal(await middleware(req('https://os.example.com/', await sessionCookie())), undefined);
});

test('path allow-list', () => {
  assert.ok(isAllowedPath('v3/snapshot/options/SPY'));
  assert.ok(isAllowedPath('v3/snapshot/options/SPY/O:SPY261218C00600000'));
  assert.ok(isAllowedPath('v2/snapshot/locale/us/markets/stocks/tickers'));
  assert.ok(!isAllowedPath('v1/some/other'));
  assert.ok(!isAllowedPath('v3/snapshot/options/../../x'));
});

test('scrub removes key and rewrites next_url', () => {
  const body = JSON.stringify({ next_url: 'https://api.massive.com/v3/snapshot/options/SPY?cursor=abc&apiKey=SECRETKEY123', echo: 'SECRETKEY123' });
  const out = scrub(body, 'SECRETKEY123');
  assert.ok(!out.includes('SECRETKEY123'));
  assert.equal(JSON.parse(out).next_url, '/api/massive?path=v3%2Fsnapshot%2Foptions%2FSPY&cursor=abc');
});

test('parse option ticker', () => {
  assert.deepEqual(parseOptionTicker('O:SPY261218C00600000'), { underlying: 'SPY', date: '261218', type: 'C', strike: 600 });
  assert.equal(parseOptionTicker('SPY'), null);
});

test('massive proxy adds key server-side and never returns it', async () => {
  let called;
  globalThis.fetch = async (u) => { called = String(u); return new Response(JSON.stringify({ results: [], next_url: `https://api.massive.com/v3/snapshot/options/SPY?cursor=z&apiKey=SECRETKEY123` }), { status: 200 }); };
  const r = await massiveApi.GET(req('https://os.example.com/api/massive?path=v3/snapshot/options/SPY&limit=250&apiKey=evil', await sessionCookie()));
  assert.equal(r.status, 200);
  assert.match(called, /apiKey=SECRETKEY123/);
  assert.doesNotMatch(called, /evil/);
  const text = await r.text();
  assert.ok(!text.includes('SECRETKEY123'));
  const bad = await massiveApi.GET(req('https://os.example.com/api/massive?path=v1/x', await sessionCookie()));
  assert.equal(bad.status, 403);
  const anon = await massiveApi.GET(req('https://os.example.com/api/massive?path=v3/snapshot/options/SPY'));
  assert.equal(anon.status, 401);
});

test('tracked endpoint fans out per contract', async () => {
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(new URL(u).pathname); return new Response(JSON.stringify({ results: { details: { ticker: 'x' } } }), { status: 200 }); };
  const r = await tracked.GET(req('https://os.example.com/api/tracked?c=O:SPY261218C00600000,O:AAPL261218P00250000,bad', await sessionCookie()));
  const j = await r.json();
  assert.equal(j.results.length, 2);
  assert.equal(j.errors.length, 1);
  assert.ok(seen.includes('/v3/snapshot/options/AAPL/O:AAPL261218P00250000'));
});

test('google login → callback creates a session only for allowed emails', async () => {
  const l = await login.GET(req('https://os.example.com/api/auth/login?consent=2026-11-19.2&next=/x'));
  assert.equal(l.status, 302);
  const g = new URL(l.headers.get('location'));
  assert.equal(g.origin, 'https://accounts.google.com');
  assert.equal(g.searchParams.get('redirect_uri'), 'https://os.example.com/api/auth/callback');
  const state = g.searchParams.get('state');
  const stateCookie = l.headers.get('set-cookie').split(';')[0];

  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mkToken = email => `${b64({ alg: 'RS256' })}.${b64({ aud: 'cid', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 300, email, email_verified: true })}.sig`;

  globalThis.fetch = async () => new Response(JSON.stringify({ id_token: mkToken('Me@Example.com') }), { status: 200 });
  const ok = await callback.GET(req(`https://os.example.com/api/auth/callback?code=c&state=${state}`, stateCookie));
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/x');
  assert.match(ok.headers.get('set-cookie'), /os_session=/);

  globalThis.fetch = async () => new Response(JSON.stringify({ id_token: mkToken('stranger@example.com') }), { status: 200 });
  const no = await callback.GET(req(`https://os.example.com/api/auth/callback?code=c&state=${state}`, stateCookie));
  assert.equal(no.status, 403);

  const badState = await callback.GET(req(`https://os.example.com/api/auth/callback?code=c&state=wrong`, stateCookie));
  assert.equal(badState.status, 400);
});

test('open redirect is blocked', async () => {
  const l = await login.GET(req('https://os.example.com/api/auth/login?consent=2026-11-19.2&next=//evil.com'));
  assert.equal(l.status, 302);
  assert.equal(login.safeNext('//evil.com'), '/');
  assert.equal(login.safeNext('/ok'), '/ok');
});

test('cross-site POSTs to the API are blocked; same-site ones pass to the session check', async () => {
  const cross = new Request('https://os.example.com/api/userdata', { method: 'PUT', headers: { origin: 'https://evil.example', cookie: await sessionCookie() } });
  assert.equal((await middleware(cross)).status, 403);
  const fetchSite = new Request('https://os.example.com/api/track', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', cookie: await sessionCookie() } });
  assert.equal((await middleware(fetchSite)).status, 403);
  const same = new Request('https://os.example.com/api/track', { method: 'POST', headers: { origin: 'https://os.example.com', 'sec-fetch-site': 'same-origin', cookie: await sessionCookie() } });
  assert.equal(await middleware(same), undefined);
});

test('pages have no inline scripts (strict Content-Security-Policy)', async () => {
  const fs = await import('node:fs');
  for (const f of fs.readdirSync('public').filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync('public/' + f, 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${f} has an inline <script>`);
    assert.ok(!/\son[a-z]+\s*=\s*"/i.test(html), `${f} has an inline event handler`);
  }
  const csp = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src 'self' https:\/\/cdnjs/);
  assert.ok(!/script-src[^;]*unsafe/.test(csp));
});
