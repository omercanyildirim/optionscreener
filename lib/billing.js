// Paid plan (Pro) through Paddle Billing. Card on file: Paddle stores the card at the first payment and
// renews the subscription automatically every month; Paddle's webhooks tell us the subscription state.
//
// Env: PADDLE_ENV            sandbox | production
//      PADDLE_CLIENT_TOKEN   client-side token (public, used by Paddle.js in the browser)
//      PADDLE_PRICE_ID       the Pro price (pri_...)
//      PADDLE_API_KEY        server-side API key (secret) - customer portal links
//      PADDLE_WEBHOOK_SECRET webhook destination secret (secret) - verifies webhooks
//      PAYWALL               true = lock Pro features for users without an active subscription
import { storeConfigured, cmd } from './store.js';
import { adminEmails } from './session.js';

const enc = new TextEncoder();
export const paddleEnv = () => (process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox');
const apiBase = () => (paddleEnv() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
export const billingConfigured = () => !!(process.env.PADDLE_CLIENT_TOKEN && process.env.PADDLE_PRICE_ID);
export const paywallOn = () => process.env.PAYWALL === 'true' && billingConfigured();

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
async function accountFrom(customData) {
  const email = String((customData && customData.email) || '').toLowerCase();
  const sig = String((customData && customData.sig) || '');
  return email && safeEqual(sig, await signAccount(email)) ? email : null;
}

// Paddle-Signature: ts=1671552777;h1=<hex HMAC-SHA256(secret, ts + ":" + raw body)>
export async function verifyWebhook(raw, header, secret = process.env.PADDLE_WEBHOOK_SECRET, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(';').map(p => p.split('=')).filter(p => p.length === 2));
  const ts = +parts.ts;
  if (!ts || Math.abs(now / 1000 - ts) > 300) return false; // 5-minute window against replays
  return safeEqual(await hmacHex(secret, `${parts.ts}:${raw}`), parts.h1 || '');
}

export async function getSubscription(email) {
  if (!storeConfigured() || !email) return null;
  try { const v = await cmd(['GET', subKey(email)]); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function planFor(email) {
  if (adminEmails().includes(String(email).toLowerCase())) return { plan: 'pro', status: 'admin' };
  const s = await getSubscription(email);
  return s && ACTIVE.has(s.status) ? { plan: 'pro', ...s } : { plan: 'free', ...(s || {}) };
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
    startedAt: d.started_at || null, updatedAt: d.updated_at || new Date().toISOString(),
  };
  await cmd(['SET', subKey(email), JSON.stringify(sub)]);
  return { email, status: sub.status };
}

// Paddle's customer portal: update the card, see invoices, cancel.
export async function portalUrl(customerId, subscriptionId) {
  const res = await fetch(`${apiBase()}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.PADDLE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(subscriptionId ? { subscription_ids: [subscriptionId] } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.detail) || `Paddle HTTP ${res.status}`);
  return j.data && j.data.urls && j.data.urls.general && j.data.urls.general.overview;
}

// What the app needs to show the plan and open checkout.
export async function billingInfo(email) {
  const p = await planFor(email);
  return {
    configured: billingConfigured(), paywall: paywallOn(), plan: p.plan, status: p.status || null,
    nextBill: p.nextBill || null, cancelAt: p.cancelAt || null, canManage: !!(p.customerId && process.env.PADDLE_API_KEY),
    paddle: billingConfigured() ? {
      env: paddleEnv(), token: process.env.PADDLE_CLIENT_TOKEN, priceId: process.env.PADDLE_PRICE_ID,
      customData: { email: String(email).toLowerCase(), sig: await signAccount(email) },
    } : null,
  };
}
