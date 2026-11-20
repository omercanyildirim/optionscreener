import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as shim from './support/neon-shim.js';

const SECRET = 'x'.repeat(40);
const skip = !shim.available() && 'Postgres 16 is not installed here';
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const billing = await import('../lib/billing.js');
const S = await import('../lib/social.js');
const db = await import('../lib/db.js');
const api = await import('../api/social.js');

let R = {}, SQL;
function redis([c, k, ...a]) {
  const C = String(c).toUpperCase(), h = () => (R[k] ||= {});
  if (C === 'GET') return R[k] ?? null;
  if (C === 'SET') { R[k] = a[0]; return 'OK'; }
  if (C === 'DEL') { delete R[k]; return 1; }
  if (C === 'HGET') return (R[k] || {})[a[0]] ?? null;
  if (C === 'HSET') { for (let i = 0; i < a.length; i += 2) h()[a[i]] = a[i + 1]; return 1; }
  if (C === 'LPUSH' || C === 'LTRIM' || C === 'EXPIRE' || C === 'ZADD' || C === 'HINCRBY' || C === 'HSETNX' || C === 'INCR') return 1;
  return null;
}
const realFetch = globalThis.fetch;

before(async () => { if (!skip) SQL = await shim.start(); });
after(() => shim.stop());
beforeEach(async () => {
  R = {};
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't',
    PADDLE_ENV: 'sandbox', PADDLE_CLIENT_TOKEN: 'tok', PADDLE_PRICE_ID: 'pri_1', PAYWALL: 'true', DATABASE_URL: 'postgresql://u:p@ep-test-pooler.example.neon.tech/db' });
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://kv.example')) {
      const body = JSON.parse(init.body);
      if (String(u).endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
      return new Response(JSON.stringify({ result: redis(body) }));
    }
    return realFetch(u, init);
  };
  if (!skip) { process.env.DB_HTTP_URL = await shim.start(); S._resetSchema(); db._resetEndpoint(); }
});

async function req(path, email, body) {
  const t = await sign({ email, name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}`, 'content-type': 'application/json' } });
}
const call = async (path, email, body) => { const r = await (body ? api.POST : api.GET)(await req(path, email, body)); return { status: r.status, j: await r.json() }; };
const pro = email => billing.setComp(email, true, { by: 'test' });

test('usernames and $tickers are parsed and validated', () => {
  assert.equal(S.checkUsername('Trader_1').username, 'trader_1');
  assert.equal(S.checkUsername('ab').ok, false);
  assert.equal(S.checkUsername('admin').ok, false);
  assert.equal(S.checkUsername('has space').ok, false);
  assert.deepEqual(S.tickersIn('Long $nvda and $BRK.B, not a$AMD or $TOOLONGX. $SPY!'), ['NVDA', 'BRK.B', 'SPY']);
  assert.match(db.wrap('select 1 as a'), /^select coalesce\(json_agg\(t\)/);
  assert.match(db.wrap('insert into x values (1) returning *'), /^with t as \(insert/);
});

test('free members are turned away; Pro members get in', { skip }, async () => {
  assert.equal((await call('/api/social?a=me', 'free@example.com')).status, 402);
  await pro('pro@example.com');
  const r = await call('/api/social?a=me', 'pro@example.com');
  assert.equal(r.status, 200); assert.equal(r.j.me, null);
});

test('profiles: pick a username, uniqueness, posting needs a username', { skip }, async () => {
  await pro('a@example.com'); await pro('b@example.com');
  assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'hi' })).status, 409);
  const r = await call('/api/social?a=profile', 'a@example.com', { username: 'Alice', displayName: 'Alice A', bio: 'Options nerd' });
  assert.equal(r.status, 200); assert.equal(r.j.me.username, 'alice'); assert.equal(r.j.me.display_name, 'Alice A');
  assert.equal((await call('/api/social?a=check&u=alice', 'b@example.com')).j.ok, false);
  assert.equal((await call('/api/social?a=profile', 'b@example.com', { username: 'alice' })).status, 409);
  assert.equal((await call('/api/social?a=profile', 'b@example.com', { username: 'bob' })).status, 200);
  // renaming keeps the same member
  assert.equal((await call('/api/social?a=profile', 'a@example.com', { username: 'alice2', displayName: 'Alice A' })).j.me.username, 'alice2');
  assert.equal((await call('/api/social?a=check&u=alice', 'b@example.com')).j.ok, true);
});

test('posts, feed scopes, likes, replies, follows, delete; no emails in responses', { skip }, async () => {
  for (const [e, u] of [['a@example.com', 'alice'], ['b@example.com', 'bob'], ['c@example.com', 'carol']]) { await pro(e); await call('/api/social?a=profile', e, { username: u }); }
  const p1 = (await call('/api/social?a=post', 'a@example.com', { body: 'Big call sweeps in $NVDA today' })).j.post;
  assert.deepEqual(p1.tickers, ['NVDA']); assert.equal(p1.username, 'alice'); assert.equal(p1.mine, true);
  const p2 = (await call('/api/social?a=post', 'b@example.com', { body: 'Puts stacking on $AMD' })).j.post;
  await call('/api/social?a=post', 'c@example.com', { body: "Carol's thoughts" });

  let f = (await call('/api/social?a=feed', 'a@example.com')).j;
  assert.deepEqual(f.posts.map(p => p.username), ['carol', 'bob', 'alice']);
  assert.ok(!JSON.stringify(f).includes('@example.com'), 'no emails leak');

  // following: own posts + followed members only
  await call('/api/social?a=follow', 'a@example.com', { username: 'bob', on: true });
  f = (await call('/api/social?a=feed&scope=following', 'a@example.com')).j;
  assert.deepEqual(f.posts.map(p => p.username), ['bob', 'alice']);
  const prof = (await call('/api/social?a=user&u=bob', 'a@example.com')).j;
  assert.equal(prof.profile.followers, 1); assert.equal(prof.profile.followed, true); assert.equal(prof.posts.length, 1);
  assert.equal((await call('/api/social?a=follow', 'a@example.com', { username: 'alice', on: true })).status, 400);

  // ticker
  f = (await call('/api/social?a=feed&scope=ticker&arg=nvda', 'b@example.com')).j;
  assert.deepEqual(f.posts.map(p => p.id), [p1.id]);

  // likes
  let l = (await call('/api/social?a=like', 'b@example.com', { id: p1.id, on: true })).j;
  assert.deepEqual(l, { likes: 1, liked: true });
  await call('/api/social?a=like', 'b@example.com', { id: p1.id, on: true });
  l = (await call('/api/social?a=like', 'c@example.com', { id: p1.id, on: true })).j; assert.equal(l.likes, 2);
  l = (await call('/api/social?a=like', 'c@example.com', { id: p1.id, on: false })).j; assert.deepEqual(l, { likes: 1, liked: false });

  // replies: in the thread, counted on the post, not in the main feed
  const r1 = (await call('/api/social?a=post', 'b@example.com', { body: 'Agreed', parentId: p1.id })).j.post;
  assert.equal(r1.reply_to, 'alice');
  const t = (await call(`/api/social?a=post&id=${p1.id}`, 'c@example.com')).j;
  assert.equal(t.post.replies, 1); assert.equal(t.post.likes, 1); assert.deepEqual(t.replies.map(x => x.body), ['Agreed']);
  assert.ok(!(await call('/api/social?a=feed', 'c@example.com')).j.posts.some(p => p.id === r1.id));

  // only the author can delete
  assert.equal((await call('/api/social?a=delete', 'c@example.com', { id: p2.id })).status, 404);
  assert.equal((await call('/api/social?a=delete', 'b@example.com', { id: p2.id })).status, 200);
  assert.equal((await call(`/api/social?a=post&id=${p2.id}`, 'a@example.com')).status, 404);

  // validation
  assert.equal((await call('/api/social?a=post', 'a@example.com', { body: '   ' })).status, 400);
  assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'x'.repeat(501) })).status, 400);
});

test('reports, admin moderation and muting', { skip }, async () => {
  for (const [e, u] of [['a@example.com', 'alice'], ['b@example.com', 'bob']]) { await pro(e); await call('/api/social?a=profile', e, { username: u }); }
  const p = (await call('/api/social?a=post', 'b@example.com', { body: 'spam spam' })).j.post;
  assert.equal((await call('/api/social?a=report', 'a@example.com', { id: p.id, reason: 'Spam' })).status, 200);
  let o = await S.adminOverview();
  assert.equal(o.stats.open_reports, 1); assert.equal(o.reports[0].post_id, p.id); assert.equal(o.reports[0].reasons, 'Spam');
  await S.resolveReports('admin@example.com', p.id, 'delete');
  o = await S.adminOverview();
  assert.equal(o.stats.open_reports, 0); assert.equal(o.stats.posts, 0);

  await call('/api/social?a=post', 'b@example.com', { body: 'still here' });
  await S.setMuted('bob', true);
  assert.equal((await call('/api/social?a=feed', 'a@example.com')).j.posts.length, 0, 'muted posts are hidden from others');
  assert.equal((await call('/api/social?a=feed', 'b@example.com')).j.posts.length, 1, 'but the author still sees them');
  assert.equal((await call('/api/social?a=post', 'b@example.com', { body: 'more' })).status, 403);
  await S.setMuted('bob', false);
  assert.equal((await call('/api/social?a=feed', 'a@example.com')).j.posts.length, 1);
});

test('posting rate limit', { skip }, async () => {
  await pro('a@example.com'); await call('/api/social?a=profile', 'a@example.com', { username: 'alice' });
  const old = S.LIMITS.postsPerHour; S.LIMITS.postsPerHour = 2;
  try {
    assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'one' })).status, 200);
    assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'two' })).status, 200);
    assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'three' })).status, 429);
  } finally { S.LIMITS.postsPerHour = old; }
});

test('photos: upload, attach to a post, who can see them, limits', { skip }, async () => {
  for (const [e, u] of [['a@example.com', 'alice'], ['b@example.com', 'bob']]) { await pro(e); await call('/api/social?a=profile', e, { username: u }); }
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg body '.repeat(20))]).toString('base64');
  const up = async (email, extra = {}) => call('/api/social?a=upload', email, { data: jpeg, mime: 'image/jpeg', width: 800, height: 600, ...extra });
  const m1 = (await up('a@example.com')).j, m2 = (await up('a@example.com')).j;
  assert.match(m1.id, /^[a-f0-9]{24}$/);
  assert.equal((await up('a@example.com', { mime: 'image/png' })).status, 400, 'content must match the type');
  assert.equal((await up('a@example.com', { data: Buffer.from('<svg/>').toString('base64'), mime: 'image/svg+xml' })).status, 400);
  // before posting only the owner can load it
  const media = async (email, id) => (await api.GET(await req(`/api/social?a=media&id=${id}`, email)));
  let r = await media('a@example.com', m1.id); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()).toString('base64'), jpeg);
  assert.equal((await media('b@example.com', m1.id)).status, 404);
  // someone else cannot attach my photo
  assert.equal((await call('/api/social?a=post', 'b@example.com', { body: 'mine now', mediaIds: [m1.id] })).status, 400);
  // photo-only post with two photos
  const p = (await call('/api/social?a=post', 'a@example.com', { body: '', mediaIds: [m1.id, m2.id] })).j.post;
  assert.deepEqual(p.media.map(x => x.id), [m1.id, m2.id]); assert.equal(p.media[0].w, 800);
  assert.equal((await media('b@example.com', m1.id)).status, 200, 'visible once posted');
  assert.equal((await call('/api/social?a=feed', 'b@example.com')).j.posts[0].media.length, 2);
  assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'again', mediaIds: [m1.id] })).status, 400, 'a photo is used once');
  assert.equal((await call('/api/social?a=post', 'a@example.com', { body: '' })).status, 400);
  assert.equal((await call('/api/social?a=post', 'a@example.com', { body: 'x', mediaIds: ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24), 'd'.repeat(24), 'e'.repeat(24)] })).status, 400);
  // deleted post hides its photos
  await call('/api/social?a=delete', 'a@example.com', { id: p.id });
  assert.equal((await media('b@example.com', m1.id)).status, 404);
});

test('search: words (any order, prefix while typing), $tickers, @members, hidden posts excluded', { skip }, async () => {
  for (const [e, u, n] of [['a@example.com', 'alice', 'Alice Gamma'], ['b@example.com', 'bob', 'Bob'], ['c@example.com', 'alicia', 'Al']]) { await pro(e); await call('/api/social?a=profile', e, { username: u, displayName: n }); }
  await call('/api/social?a=post', 'a@example.com', { body: 'Gamma squeeze building in $NVDA calls' });
  await call('/api/social?a=post', 'b@example.com', { body: 'Puts on $AMD after the short report' });
  const gone = (await call('/api/social?a=post', 'b@example.com', { body: 'Gamma gamma deleted' })).j.post;
  await call('/api/social?a=delete', 'b@example.com', { id: gone.id });
  const s = async q => (await call('/api/social?a=search&q=' + encodeURIComponent(q), 'c@example.com')).j;
  assert.deepEqual((await s('squeeze gamma')).posts.map(p => p.username), ['alice']);
  assert.deepEqual((await s('squ')).posts.map(p => p.username), ['alice'], 'prefix on the last word');
  assert.deepEqual((await s('nvda')).posts.length, 1, 'ticker text is searchable as a word');
  assert.deepEqual((await s('$AMD')).posts.map(p => p.username), ['bob']);
  assert.deepEqual((await s('$AMD')).tickers, ['AMD']);
  assert.equal((await s('gamma')).posts.length, 1, 'deleted posts are not found');
  assert.deepEqual((await s('@ali')).members.map(m => m.username).sort(), ['alice', 'alicia']);
  assert.deepEqual((await s('gamma')).members.map(m => m.username), ['alice'], 'display names match too');
  assert.deepEqual(await s('   '), { members: [], tickers: [], posts: [] });
  assert.equal((await s("x' & | ! ( ) :*")).posts.length, 0, 'odd characters are safe');
  assert.ok(!JSON.stringify(await s('gamma')).includes('@example.com'));
});
