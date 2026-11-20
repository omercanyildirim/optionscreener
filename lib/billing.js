// Paid plan (Pro) through Paddle Billing. Card on file: Paddle stores the card at the first payment and
// renews the subscription automatically every month; Paddle's webhooks tell us the subscription state.
//
// Env: PADDLE_ENV            sandbox | production
//      PADDLE_CLIENT_TOKEN   client-side token (public, used by Paddle.js in the browser)
//      PADDLE_PRICE_ID       the Pro price (pri_...)
//      PADDLE_API_KEY        server-side API key (secret) - customer portal links
//      PADDLE_WEBHOOK_SECRET webhook destination secret (secret) - verifies webhooks
//      PAYWALL               true = lock Pro features for users without an active subscription
//      PADDLE_TEST_EMAILS    sandbox only: extra accounts (besides admins) that may use the test checkout
import { storeConfigured, cmd } from './store.js';
import { adminEmails } from './session.js';

const enc = new TextEncoder();
export const paddleEnv = () => (process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox');
// In production, *_LIVE variables (live Paddle account) take precedence, so going live is one switch: PADDLE_ENV=production.
export const paddleVar = name => (paddleEnv() === 'production' && process.env[name + '_LIVE']) || process.env[name] || '';
const apiBase = () => (paddleEnv() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
export const billingConfigured = () => !!(paddleVar('PADDLE_CLIENT_TOKEN') && paddleVar('PADDLE_PRICE_ID'));
export const paywallOn = () => process.env.PAYWALL === 'true' && billingConfigured();

// While Paddle runs in sandbox (test cards, no real money) the checkout is only for admins and listed testers,
// and a sandbox subscription unlocks Pro only for them. Otherwise anyone could get Pro with a public test card.
const lc = e => String(e || '').trim().toLowerCase();
export const sandboxTesters = () => [...adminEmails(), ...String(process.env.PADDLE_TEST_EMAILS || '').split(',').map(lc).filter(Boolean)];
export const checkoutAllowed = email => paddleEnv() === 'production' || sandboxTesters().includes(lc(email));

const subKey = email => `os:sub:${String(email).toLowerCase()}`;
const ACTIVE = new Set(['active', 'trialing', 'past_due']); // past_due: Paddle is retrying the card

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// The account a checkout belongs to travels in custom_data, signed so nobody can attach a payment to someone else.
export async function signAccount(email) {
  return hmacHex((process.env.SESSION_SECRET || '') + ':paddle', String(email).toLowerCase());
}
export async function accountFrom(customData) {
  const email = String((customData && customData.email) || '').toLowerCase();
  const sig = String((customData && customData.sig) || '');
  return email && safeEqual(sig, await signAccount(email)) ? email : null;
}

// Paddle-Signature: ts=1671552777;h1=<hex HMAC-SHA256(secret, ts + ":" + raw body)>
export async function verifyWebhook(raw, header, secret = paddleVar('PADDLE_WEBHOOK_SECRET'), now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(';').map(p => p.split('=')).filter(p => p.length === 2));
  const ts = +parts.ts;
  if (!ts || Math.abs(now / 1000 - ts) > 300) return false; // 5-minute window against replays
  return safeEqual(await hmacHex(secret, `${parts.ts}:${raw}`), parts.h1 || '');
}

// Subscriptions are tagged with the Paddle environment they came from. Only ones from the current environment count,
// so test-card (sandbox) subscriptions never unlock Pro once the site runs on live Paddle. Untagged = sandbox (pre-launch).
export async function getSubscription(email, anyEnv = false) {
  if (!storeConfigured() || !email) return null;
  try {
    const v = await cmd(['GET', subKey(email)]); const s = v ? JSON.parse(v) : null;
    if (s && !anyEnv && (s.env || 'sandbox') !== paddleEnv()) return null;
    return s;
  } catch { return null; }
}
// Free Pro granted by the admin (complimentary access), optionally until a date.
const compKey = email => `os:comp:${String(email).toLowerCase()}`;
export async function getComp(email, now = Date.now()) {
  if (!storeConfigured() || !email) return null;
  try { const v = await cmd(['GET', compKey(email)]); const c = v ? JSON.parse(v) : null; return c && (!c.until || Date.parse(c.until) > now) ? c : null; } catch { return null; }
}
export async function setComp(email, on, { by = '', note = '', until = null } = {}) {
  if (!on) { await cmd(['DEL', compKey(email)]); return null; }
  const c = { by, note: String(note || '').slice(0, 200), until: until ? new Date(until).toISOString() : null, at: new Date().toISOString() };
  await cmd(['SET', compKey(email), JSON.stringify(c)]);
  return c;
}
export async function planFor(email) {
  if (adminEmails().includes(String(email).toLowerCase())) { const s = await getSubscription(email); return { ...(s || {}), plan: 'pro', status: 'admin' }; }
  const s = await getSubscription(email);
  if (s && ACTIVE.has(s.status) && checkoutAllowed(email)) return { plan: 'pro', ...s };
  const c = await getComp(email);
  if (c) return { ...(s || {}), plan: 'pro', status: 'comp', compUntil: c.until };
  return { plan: 'free', ...(s || {}) };
}
// Paddle customer -> account, so renewal payments can be matched to a user even without custom data.
export async function emailForCustomer(customerId) {
  if (!storeConfigured() || !customerId) return null;
  try { return await cmd(['GET', `os:cust:${customerId}`]); } catch { return null; }
}

// Webhook events we act on: subscription.* (created, updated, activated, canceled, past_due, paused, resumed, trialing).
export async function handleEvent(evt) {
  const type = String(evt && evt.event_type || '');
  if (!type.startsWith('subscription.')) return { ignored: type };
  const d = evt.data || {};
  const email = await accountFrom(d.custom_data);
  if (!email) return { error: 'unknown account' };
  const prev = await getSubscription(email);
  // Paddle may deliver events out of order: keep the newest by updated_at.
  if (prev && prev.updatedAt && d.updated_at && Date.parse(d.updated_at) < Date.parse(prev.updatedAt)) return { stale: true };
  const sub = {
    id: d.id, status: d.status, customerId: d.customer_id,
    priceId: d.items && d.items[0] && d.items[0].price ? d.items[0].price.id : null,
    nextBill: d.next_billed_at || null,
    cancelAt: d.scheduled_change && d.scheduled_change.action === 'cancel' ? d.scheduled_change.effective_at : null,
    startedAt: d.started_at || null, updatedAt: d.updated_at || new Date().toISOString(), env: paddleEnv(),
  };
  await cmd(['SET', subKey(email), JSON.stringify(sub)]);
  if (sub.customerId) await cmd(['SET', `os:cust:${sub.customerId}`, email]);
  return { email, status: sub.status };
}

// Payment check right after checkout, straight from Paddle's API (does not wait for the webhook).
// The transaction must belong to this signed-in account (signed custom_data) and be paid.
async function paddleGet(path) {
  const res = await fetch(`${apiBase()}${path}`, { headers: { authorization: `Bearer ${paddleVar('PADDLE_API_KEY')}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.detail) || `Paddle HTTP ${res.status}`);
  return j.data;
}
export async function syncTransaction(email, txnId) {
  if (!paddleVar('PADDLE_API_KEY')) return { error: 'not configured', status: 503 };
  if (!/^txn_[a-z0-9]{10,40}$/i.test(String(txnId || ''))) return { error: 'invalid transaction', status: 400 };
  const t = await paddleGet(`/transactions/${txnId}`);
  const owner = await accountFrom(t.custom_data);
  if (!owner || owner !== String(email).toLowerCase()) return { error: 'transaction does not belong to this account', status: 403 };
  if (!['paid', 'completed'].includes(t.status)) return { pending: true, status: t.status };
  if (!t.subscription_id) return { pending: true, status: 'no subscription yet' };
  const sub = await paddleGet(`/subscriptions/${t.subscription_id}`);
  return handleEvent({ event_type: 'subscription.updated', data: { ...sub, custom_data: t.custom_data } });
}

// Paddle's customer portal: update the card, see invoices, cancel.
export async function portalUrl(customerId, subscriptionId) {
  const res = await fetch(`${apiBase()}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${paddleVar('PADDLE_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify(subscriptionId ? { subscription_ids: [subscriptionId] } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.detail) || `Paddle HTTP ${res.status}`);
  return j.data && j.data.urls && j.data.urls.general && j.data.urls.general.overview;
}

// What the app needs to show the plan and open checkout.
export async function billingInfo(email, country = '') {
  const p = await planFor(email);
  return {
    configured: billingConfigured(), paywall: paywallOn(), plan: p.plan, status: p.status || null, compUntil: p.compUntil || null,
    nextBill: p.nextBill || null, cancelAt: p.cancelAt || null, canManage: !!(p.customerId && paddleVar('PADDLE_API_KEY')),
    checkout: !billingConfigured() ? null : checkoutAllowed(email) ? 'open' : 'soon',
    paddle: billingConfigured() && checkoutAllowed(email) ? {
      env: paddleEnv(), token: paddleVar('PADDLE_CLIENT_TOKEN'), priceId: paddleVar('PADDLE_PRICE_ID'),
      customData: { email: String(email).toLowerCase(), sig: await signAccount(email) },
      country: country || null,
    } : null,
  };
}
