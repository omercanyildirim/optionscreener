import { test } from 'node:test';
import assert from 'node:assert/strict';
const billing = await import('../lib/billing.js');
const payments = await import('../lib/payments.js');

test('production reads *_LIVE Paddle values; sandbox keeps the test ones', () => {
  Object.assign(process.env, { PADDLE_API_KEY: 'sandbox_key', PADDLE_API_KEY_LIVE: 'pdl_live_apikey_x', PADDLE_PRICE_ID: 'pri_sb' });
  delete process.env.PADDLE_PRICE_ID_LIVE;
  process.env.PADDLE_ENV = 'sandbox';
  assert.equal(billing.paddleVar('PADDLE_API_KEY'), 'sandbox_key');
  process.env.PADDLE_ENV = 'production';
  assert.equal(billing.paddleVar('PADDLE_API_KEY'), 'pdl_live_apikey_x');
  assert.equal(billing.paddleVar('PADDLE_PRICE_ID'), 'pri_sb'); // falls back when no _LIVE value
  process.env.PADDLE_ENV = 'sandbox';
});

test('live check reports permissions and formats, never the secret values', async () => {
  Object.assign(process.env, { PADDLE_API_KEY_LIVE: 'pdl_live_apikey_secret123', PADDLE_WEBHOOK_SECRET_LIVE: 'pdl_ntfset_secret456', PADDLE_CLIENT_TOKEN_LIVE: 'live_tok', PADDLE_PRICE_ID_LIVE: 'pri_live' });
  const seen = [];
  globalThis.fetch = async (u, init) => { seen.push([String(u), init.headers.authorization]);
    return String(u).includes('/adjustments') ? new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }) : new Response('{"data":[]}'); };
  const r = await payments.liveCheck();
  assert.ok(seen.every(([u, a]) => u.startsWith('https://api.paddle.com/') && a === 'Bearer pdl_live_apikey_secret123'));
  assert.deepEqual(r.permissions, { 'transaction.read': 'ok', 'subscription.read': 'ok', 'customer.read': 'ok', 'adjustment.read': '403: forbidden' });
  assert.equal(r.apiKey.looksLive, true); assert.equal(r.webhookSecret.looksRight, true); assert.equal(r.clientToken.looksLive, true);
  const txt = JSON.stringify(r); assert.ok(!txt.includes('secret123') && !txt.includes('secret456'));
});
