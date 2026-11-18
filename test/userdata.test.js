import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const { sanitizeUserData } = await import('../lib/store.js');
const api = await import('../api/userdata.js');

let db;
beforeEach(() => {
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'me@example.com,you@example.com',
    KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'tok' });
  db = new Map();
  globalThis.fetch = async (u, init) => {
    assert.equal(String(u), 'https://redis.example');
    assert.equal(init.headers.authorization, 'Bearer tok');
    const [cmd, key, val] = JSON.parse(init.body);
    if (cmd === 'GET') return new Response(JSON.stringify({ result: db.get(key) ?? null }));
    if (cmd === 'SET') { db.set(key, val); return new Response(JSON.stringify({ result: 'OK' })); }
    return new Response(JSON.stringify({ error: 'bad' }), { status: 400 });
  };
});

async function req(method, email, body) {
  const t = await sign({ email, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com/api/userdata', {
    method, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('save and load per user, users isolated', async () => {
  const body = { presets: [{ id: 'p1', name: 'Büyük call sweep', flow: { minPrem: '500000', cp: 'C' }, screener: {} }], tracked: ['O:SPY261218C00600000', 'junk'], watch: 'spy, qqq', defaultPreset: 'p1' };
  const put = await api.PUT(await req('PUT', 'me@example.com', body));
  assert.equal(put.status, 200);
  const mine = await (await api.GET(await req('GET', 'me@example.com'))).json();
  assert.equal(mine.configured, true);
  assert.equal(mine.data.presets[0].name, 'Büyük call sweep');
  assert.deepEqual(mine.data.tracked, ['O:SPY261218C00600000']);
  assert.equal(mine.data.watch, 'SPY, QQQ');
  assert.equal(mine.data.defaultPreset, 'p1');
  const yours = await (await api.GET(await req('GET', 'you@example.com'))).json();
  assert.equal(yours.data, null);
});

test('rejects bad input and unauthenticated calls', async () => {
  assert.equal((await api.PUT(await req('PUT', 'me@example.com', { presets: [{ id: 'bad id!', name: 'x' }] }))).status, 400);
  assert.equal((await api.PUT(await req('PUT', 'me@example.com', { presets: [{ id: 'a', name: '' }] }))).status, 400);
  assert.equal((await api.PUT(await req('PUT', 'stranger@example.com', { presets: [] }))).status, 401);
  assert.throws(() => sanitizeUserData({ presets: Array.from({ length: 51 }, (_, i) => ({ id: 'p' + i, name: 'n' })) }));
});

test('reports when database is not connected', async () => {
  delete process.env.KV_REST_API_URL;
  const r = await (await api.GET(await req('GET', 'me@example.com'))).json();
  assert.equal(r.configured, false);
  assert.equal((await api.PUT(await req('PUT', 'me@example.com', {}))).status, 503);
});
