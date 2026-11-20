import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const disc = await import('../lib/discounts.js');
const billing = await import('../lib/billing.js');

let R, calls;
function redis([c, k, ...a]) { c = String(c).toUpperCase();
  if (c === 'GET') return R[k] ?? null; if (c === 'SET') { R[k] = a[0]; return 'OK'; } if (c === 'DEL') { delete R[k]; return 1; }
  if (c === 'HGETALL') return []; return null; }
beforeEach(() => {
  R = {}; calls = [];
  Object.assign(process.env, { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't', PADDLE_ENV: 'production', PADDLE_API_KEY_LIVE: 'pdl_live_apikey_k', PADDLE_PRICE_ID_LIVE: 'pri_live',
    PADDLE_CLIENT_TOKEN_LIVE: 'live_tok', PADDLE_CLIENT_TOKEN: 'test_tok', PADDLE_PRICE_ID: 'pri_sb', PAYWALL: 'true', ADMIN_EMAILS: 'admin@example.com', SESSION_SECRET: 'x'.repeat(40) });
  globalThis.fetch = async (u, init = {}) => { u = String(u);
    if (u.startsWith('https://kv.example')) { const b = JSON.parse(init.body); return new Response(JSON.stringify(u.endsWith('/pipeline') ? b.map(c => ({ result: redis(c) })) : { result: redis(b) })); }
    calls.push({ u, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers && init.headers.authorization });
    if (u.endsWith('/discounts') && init.method === 'POST') { if (!/^[A-Za-z0-9]{1,32}$/.test(JSON.parse(init.body).code)) return new Response(JSON.stringify({ error: { detail: 'Invalid request.', errors: [{ field: 'code', message: 'letters and numbers only' }] } }), { status: 400 }); return new Response(JSON.stringify({ data: { id: 'dsc_01abc', code: JSON.parse(init.body).code } }));}
    return new Response(JSON.stringify({ data: {} }));
  };
});

test('admin creates a single-use, price-restricted Paddle discount for one user; checkout gets it', async () => {
  const d = await disc.createDiscount('Ayse@Example.com', { type: 'percentage', amount: 20, months: 3, days: 30, note: 'early user', by: 'admin@example.com' });
  const c = calls.find(x => x.u === 'https://api.paddle.com/discounts');
  assert.equal(c.auth, 'Bearer pdl_live_apikey_k');
  assert.equal(c.body.type, 'percentage'); assert.equal(c.body.amount, '20'); assert.equal(c.body.usage_limit, 1);
  assert.deepEqual(c.body.restrict_to, ['pri_live']); assert.equal(c.body.recur, true); assert.equal(c.body.maximum_recurring_intervals, 3);
  assert.equal(c.body.enabled_for_checkout, true); assert.match(c.body.code, /^OS20[A-Z2-9]{6}$/); assert.ok(c.body.expires_at);
  assert.equal(disc.describe(d), '20% off the first 3 months');
  const info = await billing.billingInfo('ayse@example.com');
  assert.equal(info.paddle.discount.id, 'dsc_01abc'); assert.equal(info.paddle.discount.label, '20% off the first 3 months');
  assert.equal((await billing.billingInfo('someone@example.com')).paddle.discount, null);
});

test('flat discounts are sent in cents; bad input is refused', async () => {
  await disc.createDiscount('b@example.com', { type: 'flat', amount: 5, months: 0, days: null });
  const c = calls.find(x => x.u.endsWith('/discounts'));
  assert.equal(c.body.amount, '500'); assert.equal(c.body.currency_code, 'USD'); assert.equal(c.body.recur, false); assert.equal(c.body.expires_at, null);
  await assert.rejects(disc.createDiscount('b@example.com', { type: 'percentage', amount: 150 }), /between 1 and 92/);
  await assert.rejects(disc.createDiscount('b@example.com', { type: 'flat', amount: 9.98 }), /0.70/);
  await assert.rejects(disc.createDiscount('b@example.com', { type: 'flat', amount: 9.99 }), /below|between/);
});

test('used, removed, expired or other-environment discounts are not offered', async () => {
  await disc.createDiscount('u@example.com', { type: 'percentage', amount: 10, months: 0, days: 30 });
  assert.equal(await disc.markUsed('u@example.com', 'dsc_other'), false);
  assert.equal(await disc.markUsed('u@example.com', 'dsc_01abc'), true);
  assert.equal(await disc.getDiscount('u@example.com'), null);
  await disc.createDiscount('v@example.com', { type: 'percentage', amount: 10, months: 0, days: 30 });
  await disc.removeDiscount('v@example.com');
  assert.ok(calls.some(x => x.method === 'PATCH' && x.u.endsWith('/discounts/dsc_01abc') && x.body.status === 'archived'));
  assert.equal(await disc.getDiscount('v@example.com'), null);
  R['os:disc:w@example.com'] = JSON.stringify({ id: 'dsc_x', expiresAt: new Date(Date.now() - 1000).toISOString(), env: 'production' });
  assert.equal(await disc.getDiscount('w@example.com'), null);
  R['os:disc:s@example.com'] = JSON.stringify({ id: 'dsc_s', env: 'sandbox' });
  assert.equal(await disc.getDiscount('s@example.com'), null);
});
