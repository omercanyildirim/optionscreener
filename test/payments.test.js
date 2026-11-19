import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40), WH = 'pdl_ntfset_test';
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const totp = await import('../lib/totp.js');
const billing = await import('../lib/billing.js');
const mail = await import('../lib/mail.js');
const adminApi = await import('../api/admin.js');
const billingApi = await import('../api/billing.js');
const userdata = await import('../api/userdata.js');
const configApi = await import('../api/config.js');

let R, sent, paddle;
function redis(args) {
  const [c, k, ...a] = args.map(String); const C = c.toUpperCase();
  const h = () => (R[k] ||= {}); const l = () => (R[k] ||= []); const st = () => (R[k] ||= new Set());
  switch (C) {
    case 'GET': return R[k] ?? null;
    case 'SET': if (a.includes('NX') && R[k] != null) return null; R[k] = a[0]; return 'OK';
    case 'DEL': [k, ...a].forEach(x => delete R[x]); return 1;
    case 'INCR': R[k] = String((+R[k] || 0) + 1); return +R[k];
    case 'EXPIRE': return 1;
    case 'SADD': a.forEach(x => st().add(x)); return 1;
    case 'SREM': if (R[k] instanceof Set) a.forEach(x => R[k].delete(x)); return 1;
    case 'SISMEMBER': return R[k] instanceof Set && R[k].has(a[0]) ? 1 : 0;
    case 'SCARD': return R[k] instanceof Set ? R[k].size : 0;
    case 'SMEMBERS': return R[k] instanceof Set ? [...R[k]] : [];
    case 'LPUSH': l().unshift(...a.reverse()); return 1;
    case 'LTRIM': return 'OK';
    case 'LRANGE': return l().slice(0);
    case 'ZADD': h()[a[1]] = +a[0]; return 1;
    case 'ZREVRANGE': return Object.keys(h());
    case 'HSETNX': if (h()[a[0]] == null) h()[a[0]] = a[1]; return 1;
    case 'HSET': for (let i = 0; i < a.length; i += 2) h()[a[i]] = a[i + 1]; return 1;
    case 'HGET': return (R[k] || {})[a[0]] ?? null;
    case 'HINCRBY': h()[a[0]] = String((+h()[a[0]] || 0) + +a[1]); return 1;
    case 'HGETALL': return Object.entries(R[k] || {}).flat();
    default: throw new Error('unsupported ' + C);
  }
}
beforeEach(() => {
  R = {}; sent = []; paddle = {};
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ADMIN_EMAILS: 'admin@example.com', KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't',
    PADDLE_ENV: 'sandbox', PADDLE_CLIENT_TOKEN: 'tok', PADDLE_PRICE_ID: 'pri_1', PADDLE_API_KEY: 'key', PADDLE_WEBHOOK_SECRET: WH, PAYWALL: 'true',
    RESEND_API_KEY: 're_test', MAIL_FROM: 'Options Screener <billing@optionscreener.org>', APP_URL: 'https://optionscreener.org' });
  process.env.ADMIN_TOTP_SECRET = totp.newSecret();
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.startsWith('https://kv.example')) {
      const body = JSON.parse(init.body);
      if (u.endsWith('/pipeline')) return new Response(JSON.stringify(body.map(c => ({ result: redis(c) }))));
      return new Response(JSON.stringify({ result: redis(body) }));
    }
    if (u === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'em_' + sent.length })); }
    for (const [p, v] of Object.entries(paddle)) if (u.startsWith('https://sandbox-api.paddle.com' + p)) return new Response(JSON.stringify(v));
    return new Response('{}', { status: 404 });
  };
});
async function req(path, { email = 'user@example.com', method = 'GET', body, cookie = '' } = {}) {
  const t = await sign({ email, name: 'N', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}${cookie ? '; ' + cookie : ''}`, 'content-type': 'application/json' } });
}
async function adminCookie() {
  const code = await totp.totpAt(process.env.ADMIN_TOTP_SECRET, Math.floor(Date.now() / 30000));
  const r = await adminApi.POST(await req('/api/admin?a=verify', { email: 'admin@example.com', method: 'POST', body: { code } }));
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function hook(evt) {
  const raw = JSON.stringify(evt), ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WH), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const h1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${raw}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return billingApi.POST(new Request('https://os.example.com/api/billing?a=webhook', { method: 'POST', body: raw, headers: { 'paddle-signature': `ts=${ts};h1=${h1}` } }));
}

test('admin can give free Pro (with an end date) and remove it; only a verified admin', async () => {
  assert.equal((await adminApi.POST(await req('/api/admin?a=comp', { method: 'POST', body: { email: 'user@example.com', on: true } }))).status, 403);
  const c = await adminCookie();
  const until = new Date(Date.now() + 30 * 864e5).toISOString();
  const r = await adminApi.POST(await req('/api/admin?a=comp', { email: 'admin@example.com', method: 'POST', cookie: c, body: { email: 'User@Example.com', on: true, until, note: 'beta tester' } }));
  assert.equal(r.status, 200);
  let b = await (await configApi.GET(await req('/api/config'))).json();
  assert.equal(b.billing.plan, 'pro'); assert.equal(b.billing.status, 'comp'); assert.equal(b.free, null);
  const ov = await (await adminApi.GET(await req('/api/admin?a=overview', { email: 'admin@example.com', cookie: c }))).json();
  assert.equal(ov.users.find(u => u.email === 'user@example.com').plan, 'Pro (free)');
  await adminApi.POST(await req('/api/admin?a=comp', { email: 'admin@example.com', method: 'POST', cookie: c, body: { email: 'user@example.com', on: false } }));
  b = await (await configApi.GET(await req('/api/config'))).json();
  assert.equal(b.billing.plan, 'free');
  // an expired grant no longer counts
  R['os:comp:user@example.com'] = JSON.stringify({ until: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await billing.planFor('user@example.com')).plan, 'free');
});

test('email updates: opt in, opt out, signed one-click unsubscribe', async () => {
  await userdata.PUT(await req('/api/userdata?a=marketing&on=1', { method: 'PUT' }));
  assert.equal((await (await configApi.GET(await req('/api/config'))).json()).marketing, true);
  assert.equal(R['os:u:user@example.com'].marketingHow, 'account menu'); assert.ok(R['os:mkt'].has('user@example.com'));
  const bad = await userdata.GET(new Request('https://os.example.com/api/userdata?a=unsub&e=user@example.com&t=deadbeef'));
  assert.match(await bad.text(), /not valid/); assert.ok(R['os:mkt'].has('user@example.com'));
  const link = new URL(await mail.unsubscribeUrl('user@example.com'));
  const ok = await userdata.GET(new Request(`https://os.example.com/api/userdata?a=unsub&${link.searchParams}`));
  assert.match(await ok.text(), /unsubscribed/); assert.equal(R['os:u:user@example.com'].marketing, '0'); assert.ok(!R['os:mkt'].has('user@example.com'));
});

test('a completed payment emails the customer once (first payment and renewal)', async () => {
  const sig = await billing.signAccount('user@example.com');
  R['os:u:user@example.com'] = { givenName: 'Ada' };
  const txn = { id: 'txn_01aaaaaaaaaa', status: 'completed', origin: 'web', customer_id: 'ctm_1', currency_code: 'USD', billed_at: '2026-11-19T10:00:00Z', invoice_number: '325-10001',
    custom_data: { email: 'user@example.com', sig }, details: { totals: { subtotal: '833', tax: '166', grand_total: '999', fee: '100', earnings: '733', currency_code: 'USD' } },
    payments: [{ status: 'captured', method_details: { type: 'card', card: { type: 'visa', last4: '4242' } } }] };
  let r = await hook({ event_type: 'transaction.completed', data: txn });
  assert.equal(r.status, 200); assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], 'user@example.com'); assert.match(sent[0].subject, /Welcome to Options Screener Pro/);
  assert.match(sent[0].html, /\$9\.99/); assert.match(sent[0].html, /visa •••• 4242/); assert.match(sent[0].html, /Hi Ada/);
  await hook({ event_type: 'transaction.completed', data: txn }); // duplicate delivery
  assert.equal(sent.length, 1);
  // renewal without custom data: matched through the Paddle customer id
  R['os:cust:ctm_1'] = 'user@example.com';
  await hook({ event_type: 'transaction.completed', data: { ...txn, id: 'txn_01bbbbbbbbbb', origin: 'subscription_recurring', custom_data: null } });
  assert.equal(sent.length, 2); assert.match(sent[1].subject, /payment was received/);
  assert.ok(R['os:ev:user@example.com'].some(l => JSON.parse(l).type === 'payment'));
});

test('admin payments view: totals, transactions and subscriptions from Paddle', async () => {
  const now = new Date().toISOString();
  paddle['/transactions?'] = { data: [
    { id: 'txn_01x', status: 'completed', billed_at: now, currency_code: 'USD', customer_id: 'ctm_1', customer: { email: 'a@example.com', name: 'A' }, invoice_number: 'INV-1',
      details: { totals: { tax: '166', grand_total: '999', fee: '100', earnings: '733' } }, adjustments: [] },
    { id: 'txn_01y', status: 'completed', billed_at: now, currency_code: 'USD', customer_id: 'ctm_2', customer: { email: 'b@example.com' },
      details: { totals: { tax: '0', grand_total: '999', fee: '100', earnings: '899' } }, adjustments: [{ action: 'refund', status: 'approved', totals: { total: '999' } }] },
  ], meta: { pagination: { has_more: false } } };
  paddle['/subscriptions?'] = { data: [
    { id: 'sub_1', status: 'active', customer_id: 'ctm_1', items: [{ quantity: 1, price: { unit_price: { amount: '999', currency_code: 'USD' }, billing_cycle: { interval: 'month', frequency: 1 } } }], next_billed_at: now },
    { id: 'sub_2', status: 'canceled', customer_id: 'ctm_2', items: [{ quantity: 1, price: { unit_price: { amount: '999', currency_code: 'USD' }, billing_cycle: { interval: 'month', frequency: 1 } } }] },
  ], meta: { pagination: { has_more: false } } };
  const c = await adminCookie();
  assert.equal((await adminApi.GET(await req('/api/admin?a=payments'))).status, 403);
  const j = await (await adminApi.GET(await req('/api/admin?a=payments', { email: 'admin@example.com', cookie: c }))).json();
  assert.equal(j.totals.mrr, 9.99); assert.equal(j.totals.active, 1); assert.equal(j.totals.canceled, 1);
  assert.equal(j.totals.monthRevenue, 19.98); assert.equal(j.totals.monthEarnings, 16.32); assert.equal(j.totals.refunded, 9.99);
  assert.equal(j.subscriptions[0].email, 'a@example.com');
  paddle['/transactions/txn_01abcdefghij/invoice'] = { data: { url: 'https://invoice.example/x.pdf' } };
  const inv = await adminApi.GET(await req('/api/admin?a=invoice&txn=txn_01abcdefghij', { email: 'admin@example.com', cookie: c }));
  assert.equal(inv.status, 302); assert.equal(inv.headers.get('location'), 'https://invoice.example/x.pdf');
});
