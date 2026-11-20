import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40), WH = 'pdl_ntfset_test_secret';
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const billing = await import('../lib/billing.js');
const api = await import('../api/billing.js');
const config = await import('../api/config.js');
const news = await import('../api/news.js');
const middleware = (await import('../middleware.js')).default;

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
  Object.assign(process.env, { PADDLE_TEST_EMAILS: 'user@example.com,other@example.com', SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't',
    PADDLE_ENV: 'sandbox', PADDLE_CLIENT_TOKEN: 'test_client_token', PADDLE_PRICE_ID: 'pri_123', PADDLE_WEBHOOK_SECRET: WH, PAYWALL: 'true', EXA_API_KEY: 'exa' });
  delete process.env.PADDLE_API_KEY;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://kv.example')) {
      const body = JSON.parse(init.body);
      if (String(u).endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
      return new Response(JSON.stringify({ result: redis(body) }));
    }
    return new Response('{}', { status: 404 });
  };
});

async function req(path, email = 'user@example.com') {
  const t = await sign({ email, name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}` } });
}
async function hook(evt, secret = WH, tsOffset = 0) {
  const raw = JSON.stringify(evt), ts = Math.floor(Date.now() / 1000) + tsOffset;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const h1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${raw}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://os.example.com/api/billing?a=webhook', { method: 'POST', body: raw, headers: { 'paddle-signature': `ts=${ts};h1=${h1}` } });
}
const subEvt = async (email, status, extra = {}) => ({ event_type: 'subscription.updated', data: {
  id: 'sub_1', status, customer_id: 'ctm_1', items: [{ price: { id: 'pri_123' } }], next_billed_at: '2026-12-19T00:00:00Z',
  updated_at: new Date().toISOString(), custom_data: { email, sig: await billing.signAccount(email) }, ...extra } });

test('free user: paywall on, checkout data signed, insights locked', async () => {
  const c = await (await config.GET(await req('/api/config'))).json();
  assert.equal(c.billing.plan, 'free');
  assert.equal(c.billing.paywall, true);
  assert.equal(c.billing.paddle.priceId, 'pri_123');
  assert.equal(c.billing.paddle.customData.sig, await billing.signAccount('user@example.com'));
  assert.equal((await news.GET(await req('/api/news?sym=NVDA'))).status, 402);
});

test('valid webhook activates Pro; cancel ends it', async () => {
  assert.equal((await api.POST(await hook(await subEvt('user@example.com', 'active')))).status, 200);
  let b = await (await api.GET(await req('/api/billing?a=status'))).json();
  assert.equal(b.plan, 'pro');
  assert.equal(b.nextBill, '2026-12-19T00:00:00Z');
  await new Promise(r => setTimeout(r, 5));
  await api.POST(await hook(await subEvt('user@example.com', 'canceled')));
  b = await (await api.GET(await req('/api/billing?a=status'))).json();
  assert.equal(b.plan, 'free');
});

test('webhooks with a bad signature, old timestamp or unsigned account are rejected', async () => {
  assert.equal((await api.POST(await hook(await subEvt('user@example.com', 'active'), 'wrong'))).status, 401);
  assert.equal((await api.POST(await hook(await subEvt('user@example.com', 'active'), WH, -3600))).status, 401);
  const forged = await subEvt('user@example.com', 'active'); forged.data.custom_data.sig = 'deadbeef';
  const j = await (await api.POST(await hook(forged))).json();
  assert.equal(j.error, 'unknown account');
  assert.equal((await (await api.GET(await req('/api/billing?a=status'))).json()).plan, 'free');
});

test('admins are always Pro; the webhook path skips the session check', async () => {
  assert.equal((await billing.planFor('admin@example.com')).plan, 'pro');
  const r = await middleware(new Request('https://os.example.com/api/paddle-webhook', { method: 'POST', headers: { origin: 'https://paddle.com' } }));
  assert.equal(r, undefined);
});

test('checkout sync: Pro only after Paddle confirms a paid transaction for this account', async () => {
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_test';
  const sig = await billing.signAccount('user@example.com');
  let txnStatus = 'paid', owner = { email: 'user@example.com', sig };
  const kvFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.startsWith('https://sandbox-api.paddle.com/transactions/txn_01abcdefghijk'))
      return new Response(JSON.stringify({ data: { id: 'txn_01abcdefghijk', status: txnStatus, subscription_id: txnStatus === 'paid' ? 'sub_01xyz' : null, custom_data: owner } }));
    if (u.startsWith('https://sandbox-api.paddle.com/subscriptions/sub_01xyz'))
      return new Response(JSON.stringify({ data: { id: 'sub_01xyz', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: 'pri_123' } }], next_billed_at: '2026-12-19T00:00:00Z', updated_at: new Date().toISOString() } }));
    return kvFetch(u, init);
  };
  // someone else's transaction is refused
  owner = { email: 'other@example.com', sig: await billing.signAccount('other@example.com') };
  assert.equal((await api.GET(await req('/api/billing?a=sync&txn=txn_01abcdefghijk'))).status, 403);
  // not paid yet: still free
  owner = { email: 'user@example.com', sig }; txnStatus = 'ready';
  let j = await (await api.GET(await req('/api/billing?a=sync&txn=txn_01abcdefghijk'))).json();
  assert.equal(j.pending, true); assert.equal(j.billing.plan, 'free');
  // paid: Pro
  txnStatus = 'paid';
  j = await (await api.GET(await req('/api/billing?a=sync&txn=txn_01abcdefghijk'))).json();
  assert.equal(j.billing.plan, 'pro'); assert.equal(j.billing.nextBill, '2026-12-19T00:00:00Z');
  assert.equal((await api.GET(await req('/api/billing?a=sync&txn=bad'))).status, 400);
});

test('sandbox: test checkout and test-card Pro only for admins and listed testers; production for everyone', async () => {
  const b = await import('../lib/billing.js');
  process.env.PADDLE_ENV = 'sandbox'; process.env.PAYWALL = 'true'; process.env.PADDLE_TEST_EMAILS = 'tester@example.com';
  R['os:sub:stranger@example.com'] = JSON.stringify({ status: 'active' });
  R['os:sub:tester@example.com'] = JSON.stringify({ status: 'active' });
  let i = await b.billingInfo('stranger@example.com');
  assert.equal(i.paddle, null); assert.equal(i.checkout, 'soon'); assert.equal(i.plan, 'free');
  i = await b.billingInfo('tester@example.com'); assert.equal(i.checkout, 'open'); assert.ok(i.paddle.token); assert.equal(i.plan, 'pro');
  i = await b.billingInfo('admin@example.com'); assert.equal(i.checkout, 'open');
  process.env.PADDLE_ENV = 'production';
  R['os:sub:stranger@example.com'] = JSON.stringify({ status: 'active', env: 'production' });
  i = await b.billingInfo('stranger@example.com'); assert.equal(i.checkout, 'open'); assert.equal(i.plan, 'pro');
  process.env.PADDLE_ENV = 'sandbox';
});

test('after go-live, test-card (sandbox) subscriptions no longer unlock Pro; live ones do', async () => {
  const b = await import('../lib/billing.js');
  process.env.PAYWALL = 'true';
  R['os:sub:old@example.com'] = JSON.stringify({ status: 'active' });                    // stored before launch, untagged = sandbox
  R['os:sub:tagged@example.com'] = JSON.stringify({ status: 'active', env: 'sandbox' });
  R['os:sub:paid@example.com'] = JSON.stringify({ status: 'active', env: 'production' });
  process.env.PADDLE_ENV = 'production';
  assert.equal((await b.planFor('old@example.com')).plan, 'free');
  assert.equal((await b.planFor('tagged@example.com')).plan, 'free');
  assert.equal((await b.planFor('paid@example.com')).plan, 'pro');
  process.env.PADDLE_ENV = 'sandbox';
});
