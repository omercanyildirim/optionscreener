// Per-user discounts, created by the admin. Each one is a Paddle discount with a unique code, single use and limited
// to the Pro price. The site applies it automatically when that user opens checkout (the checkout has no code field),
// so a shared code is useless to anyone else. Once the user pays with it, it is cleared here.
// Needs the Paddle API key permissions discount.read and discount.write.
import { storeConfigured, cmd } from './store.js';
import { paddleEnv, paddleVar } from './billing.js';

const apiBase = () => (paddleEnv() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
const key = email => `os:disc:${String(email).trim().toLowerCase()}`;

async function paddle(method, path, body) {
  const res = await fetch(apiBase() + path, {
    method, headers: { authorization: `Bearer ${paddleVar('PADDLE_API_KEY')}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = j.error && j.error.code, detail = (j.error && j.error.detail) || `Paddle HTTP ${res.status}`;
    const e = new Error(res.status === 403 ? 'The Paddle API key has no permission to manage discounts (needs discount.read and discount.write).' : detail);
    e.status = res.status === 403 ? 403 : 502; e.code = code; throw e;
  }
  return j.data;
}

// "SAVE20" style, readable, unique enough: prefix from the amount + 6 random characters without look-alikes.
function newCode(type, amount) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = [...crypto.getRandomValues(new Uint8Array(6))].map(b => abc[b % abc.length]).join('');
  return `OS${type === 'percentage' ? Math.round(amount) : 'USD' + Math.round(amount)}-${rnd}`;
}

export function describe(d) {
  if (!d) return '';
  const off = d.type === 'percentage' ? `${d.amount}% off` : `$${Number(d.amount).toFixed(2)} off`;
  const when = d.months === 0 ? 'the first payment' : d.months ? `the first ${d.months} months` : 'every payment';
  return `${off} ${when}`;
}

// Active discount for a user (only one from the current Paddle environment, not expired).
export async function getDiscount(email, now = Date.now()) {
  if (!storeConfigured() || !email) return null;
  try {
    const v = await cmd(['GET', key(email)]); const d = v ? JSON.parse(v) : null;
    if (!d || (d.env || 'sandbox') !== paddleEnv()) return null;
    if (d.expiresAt && Date.parse(d.expiresAt) < now) return null;
    return d;
  } catch { return null; }
}

// type: 'percentage' (amount 1-100) or 'flat' (amount in USD, below the price)
// months: 0 = first payment only, 1-36 = that many monthly payments, null = every payment while subscribed
// days: the code expires after this many days if unused (1-365), or null for no expiry
export async function createDiscount(email, { type, amount, months = 0, days = 30, note = '', by = '' }, priceId = paddleVar('PADDLE_PRICE_ID')) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Invalid email'), { status: 400 });
  if (!['percentage', 'flat'].includes(type)) throw Object.assign(new Error('Type must be percentage or flat'), { status: 400 });
  amount = Number(amount);
  if (type === 'percentage' && !(amount >= 1 && amount <= 100)) throw Object.assign(new Error('Percentage must be between 1 and 100'), { status: 400 });
  if (type === 'flat' && !(amount >= 0.5 && amount < 9.99)) throw Object.assign(new Error('Amount must be between $0.50 and $9.98'), { status: 400 });
  if (months !== null && !(Number.isInteger(months) && months >= 0 && months <= 36)) throw Object.assign(new Error('Months must be 0 to 36, or empty for every payment'), { status: 400 });
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) throw Object.assign(new Error('Expiry must be 1 to 365 days'), { status: 400 });
  if (!paddleVar('PADDLE_API_KEY') || !priceId) throw Object.assign(new Error('Paddle is not configured'), { status: 503 });

  const old = await getDiscount(email); if (old) await removeDiscount(email);
  const code = newCode(type, amount);
  const expiresAt = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
  const d = await paddle('POST', '/discounts', {
    description: `Options Screener: ${email}${note ? ' - ' + String(note).slice(0, 80) : ''}`,
    type, amount: type === 'percentage' ? String(amount) : String(Math.round(amount * 100)), ...(type === 'flat' ? { currency_code: 'USD' } : {}),
    code, enabled_for_checkout: true, usage_limit: 1, restrict_to: [priceId],
    recur: months !== 0, maximum_recurring_intervals: months ? months : null,
    expires_at: expiresAt, custom_data: { email },
  });
  const rec = { id: d.id, code: d.code || code, type, amount, months, expiresAt, note: String(note || '').slice(0, 200), by, at: new Date().toISOString(), env: paddleEnv() };
  await cmd(['SET', key(email), JSON.stringify(rec)]);
  return rec;
}

// Archive in Paddle (so the code stops working) and forget it here.
export async function removeDiscount(email) {
  const v = storeConfigured() ? await cmd(['GET', key(email)]) : null; const d = v ? JSON.parse(v) : null;
  if (d && d.id && (d.env || 'sandbox') === paddleEnv()) { try { await paddle('PATCH', `/discounts/${d.id}`, { status: 'archived' }); } catch { /* already gone */ } }
  await cmd(['DEL', key(email)]);
  return d;
}

// Called for each completed payment: once the user's discount has been used, it is no longer offered.
export async function markUsed(email, discountId) {
  if (!email || !discountId || !storeConfigured()) return false;
  const d = await getDiscount(email);
  if (!d || d.id !== discountId) return false;
  await cmd(['DEL', key(email)]);
  return true;
}
