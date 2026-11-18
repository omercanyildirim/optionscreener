import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const api = await import('../api/news.js');

let calls;
beforeEach(() => {
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', EXA_API_KEY: 'exa-key' });
  delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL;
  calls = [];
  globalThis.fetch = async (u, init) => {
    calls.push({ url: String(u), body: JSON.parse(init.body), key: init.headers['x-api-key'] });
    if (String(u).endsWith('/search')) return new Response(JSON.stringify({ results: [
      { title: 'Nvidia beats estimates', url: 'https://www.example.com/a', publishedDate: '2026-11-17T10:00:00Z', summary: 'Strong data center demand.', highlights: ['Revenue rose 60%.'] },
      { title: '', url: 'https://bad.example' },
    ] }));
    if (String(u).endsWith('/answer')) return new Response(JSON.stringify({ answer: '- Development 1', citations: [{ title: 'Source', url: 'https://example.com/b' }] }));
    return new Response('{}', { status: 404 });
  };
});

async function req(qs, email = 'any@gmail.com') {
  const t = await sign({ email, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com/api/news' + qs, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}` } });
}

test('returns cleaned news and brief, key only sent to Exa', async () => {
  const r = await api.GET(await req('?sym=NVDA&brief=1'));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.articles.length, 1);
  assert.equal(j.articles[0].source, 'example.com');
  assert.equal(j.brief.text, '- Development 1');
  assert.ok(calls.every(c => c.key === 'exa-key'));
  assert.match(calls[0].body.query, /Nvidia \(NVDA\)/);
  assert.equal(calls[0].body.category, 'news');
  assert.ok(!JSON.stringify(j).includes('exa-key'));
});

test('caches per symbol', async () => {
  await api.GET(await req('?sym=AAPL'));
  const n = calls.length;
  const j = await (await api.GET(await req('?sym=AAPL'))).json();
  assert.equal(calls.length, n);
  assert.equal(j.cached, true);
});

test('validates input, auth and configuration', async () => {
  assert.equal((await api.GET(await req('?sym=../x'))).status, 400);
  assert.equal((await api.GET(new Request('https://os.example.com/api/news?sym=NVDA'))).status, 401);
  delete process.env.EXA_API_KEY;
  assert.equal((await (await api.GET(await req('?sym=NVDA'))).json()).configured, false);
});
