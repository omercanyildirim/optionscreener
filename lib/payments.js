// Payments for the admin portal, read live from Paddle's API (transactions, subscriptions, refunds).
// Amounts from Paddle are strings in the currency's smallest unit ("999" = $9.99); converted to numbers here.
import { paddleEnv, paddleVar } from './billing.js';

const apiBase = () => (paddleEnv() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX']);
const money = (v, cur) => (v == null || v === '' ? null : Number(v) / (ZERO_DECIMAL.has(cur) ? 1 : 100));

async function get(path) {
  const res = await fetch(`${apiBase()}${path}`, { headers: { authorization: `Bearer ${paddleVar('PADDLE_API_KEY')}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error((j.error && j.error.detail) || `Paddle HTTP ${res.status}`); e.status = res.status; throw e; }
  return j;
}
// Follows Paddle's cursor pagination, up to `pages` pages.
async function list(path, pages = 5) {
  const out = []; let next = `${apiBase()}${path}`;
  for (let i = 0; i < pages && next; i++) {
    const j = await get(next.replace(apiBase(), ''));
    out.push(...(j.data || []));
    next = j.meta && j.meta.pagination && j.meta.pagination.has_more ? j.meta.pagination.next : null;
  }
  return out;
}

function method(t) {
  const p = (t.payments || []).find(x => x.status === 'captured') || (t.payments || [])[0];
  const d = p && p.method_details; if (!d) return '';
  if (d.type === 'card' && d.card) return `${(d.card.type || 'card').replace(/_/g, ' ')} •••• ${d.card.last4 || ''}`.trim();
  return String(d.type || '').replace(/_/g, ' ');
}

export function txnRow(t) {
  const cur = t.currency_code || (t.details && t.details.totals && t.details.totals.currency_code) || 'USD';
  const tot = (t.details && t.details.totals) || {};
  const refunded = (t.adjustments || []).filter(a => a.action === 'refund' && ['approved', 'pending_approval'].includes(a.status))
    .reduce((s, a) => s + (money(a.totals && a.totals.total, cur) || 0), 0);
  return {
    id: t.id, status: t.status, origin: t.origin || '', at: t.billed_at || t.created_at, currency: cur,
    email: (t.customer && t.customer.email) || (t.custom_data && t.custom_data.email) || '',
    name: (t.customer && t.customer.name) || '',
    customerId: t.customer_id || '', subscriptionId: t.subscription_id || '', invoice: t.invoice_number || '',
    subtotal: money(tot.subtotal, cur), tax: money(tot.tax, cur), total: money(tot.grand_total ?? tot.total, cur),
    fee: money(tot.fee, cur), earnings: money(tot.earnings, cur), refunded: refunded || 0, method: method(t),
  };
}

function subRow(s, emailOf) {
  const it = (s.items || [])[0] || {}, pr = it.price || {}, cur = s.currency_code || (pr.unit_price && pr.unit_price.currency_code) || 'USD';
  const unit = money(pr.unit_price && pr.unit_price.amount, cur) || 0, qty = it.quantity || 1;
  const cyc = pr.billing_cycle || s.billing_cycle || { interval: 'month', frequency: 1 };
  const perMonth = cyc.interval === 'year' ? 1 / (12 * cyc.frequency) : cyc.interval === 'week' ? 52 / (12 * cyc.frequency) : cyc.interval === 'day' ? 365 / (12 * cyc.frequency) : 1 / cyc.frequency;
  return {
    id: s.id, status: s.status, customerId: s.customer_id, email: (s.custom_data && s.custom_data.email) || emailOf(s.customer_id) || '',
    currency: cur, amount: unit * qty, interval: `${cyc.frequency > 1 ? cyc.frequency + ' ' : ''}${cyc.interval}`,
    mrr: ['active', 'past_due'].includes(s.status) ? unit * qty * perMonth : 0,
    startedAt: s.started_at || s.created_at, nextBill: s.next_billed_at || null,
    cancelAt: s.scheduled_change && s.scheduled_change.action === 'cancel' ? s.scheduled_change.effective_at : null,
    canceledAt: s.canceled_at || null,
  };
}

export async function paymentsOverview(now = Date.now()) {
  if (!paddleVar('PADDLE_API_KEY')) return { configured: false };
  const [txns, subs] = await Promise.all([
    list('/transactions?status=paid,completed,past_due,canceled&include=customer,adjustments&order_by=created_at[DESC]&per_page=100', 5),
    list('/subscriptions?per_page=200&order_by=id[DESC]', 3),
  ]);
  const t = txns.map(txnRow);
  const emails = new Map(t.filter(x => x.customerId && x.email).map(x => [x.customerId, x.email]));
  const s = subs.map(x => subRow(x, id => emails.get(id)));
  const paid = t.filter(x => ['paid', 'completed'].includes(x.status));
  const month = new Date(now); const m0 = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1);
  const sum = (arr, k) => Math.round(arr.reduce((a, x) => a + (x[k] || 0), 0) * 100) / 100;
  const thisMonth = paid.filter(x => Date.parse(x.at) >= m0);
  // Payments Paddle will collect next: every active subscription that is not set to end renews on its next billing date.
  // Past-due subscriptions are listed too (Paddle keeps retrying the card). Subscriptions set to cancel are not.
  const DAY = 864e5;
  const upcoming = s.filter(x => ['active', 'past_due'].includes(x.status) && !x.cancelAt && x.nextBill)
    .map(x => ({ subscriptionId: x.id, email: x.email, customerId: x.customerId, at: x.nextBill, amount: x.amount, currency: x.currency, interval: x.interval, retry: x.status === 'past_due' }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const within = d => upcoming.filter(x => Date.parse(x.at) <= now + d * DAY);
  const ending = s.filter(x => x.status === 'active' && x.cancelAt).sort((a, b) => Date.parse(a.cancelAt) - Date.parse(b.cancelAt))
    .map(x => ({ subscriptionId: x.id, email: x.email, at: x.cancelAt, amount: x.amount, currency: x.currency }));
  return {
    configured: true, env: paddleEnv(), currency: 'USD',
    totals: {
      mrr: sum(s, 'mrr'), active: s.filter(x => x.status === 'active').length, pastDue: s.filter(x => x.status === 'past_due').length,
      canceling: s.filter(x => x.status === 'active' && x.cancelAt).length, canceled: s.filter(x => x.status === 'canceled').length,
      monthRevenue: sum(thisMonth, 'total'), monthEarnings: sum(thisMonth, 'earnings'), monthTax: sum(thisMonth, 'tax'), monthFees: sum(thisMonth, 'fee'),
      monthCount: thisMonth.length, allRevenue: sum(paid, 'total'), allEarnings: sum(paid, 'earnings'), refunded: sum(t, 'refunded'), payments: paid.length,
      next7: sum(within(7), 'amount'), next7Count: within(7).length, next30: sum(within(30), 'amount'), next30Count: within(30).length,
      upcomingCount: upcoming.length, endingCount: ending.length, endingLost: sum(ending, 'amount'),
    },
    transactions: t, subscriptions: s, upcoming, ending,
  };
}

// A short-lived link to the invoice PDF of a transaction.
export async function invoiceUrl(txnId) {
  if (!/^txn_[a-z0-9]{10,40}$/i.test(String(txnId || ''))) throw Object.assign(new Error('invalid transaction'), { status: 400 });
  const j = await get(`/transactions/${txnId}/invoice?disposition=inline`);
  return j.data && j.data.url;
}

// The invoice PDF of a paid transaction, ready to attach to an email (base64). Null when Paddle has none yet.
export async function invoicePdf(txnId, invoiceNumber) {
  if (!paddleVar('PADDLE_API_KEY')) return null;
  let url = null;
  for (let i = 0; i < 2 && !url; i++) {           // the PDF can take a moment; stay well inside Paddle's webhook timeout
    try { url = await invoiceUrl(txnId); } catch (e) { if (e.status === 400) return null; }
    if (!url && i === 0) await new Promise(r => setTimeout(r, 1000));
  }
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length || buf.length > 5 * 1024 * 1024) return null;
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { filename: `Options-Screener-invoice-${String(invoiceNumber || txnId).replace(/[^A-Za-z0-9-]/g, '')}.pdf`, content: btoa(bin) };
}

// Admin check of the live Paddle setup before switching: calls the live API with PADDLE_API_KEY_LIVE for each
// permission the site needs and reports only ok / missing, never any secret value.
export async function liveCheck() {
  const key = process.env.PADDLE_API_KEY_LIVE || '', secret = process.env.PADDLE_WEBHOOK_SECRET_LIVE || '';
  const out = {
    apiKey: { set: !!key, looksLive: key.startsWith('pdl_live_apikey_') },
    webhookSecret: { set: !!secret, looksRight: /^pdl_ntfset_/.test(secret) },
    clientToken: { set: !!process.env.PADDLE_CLIENT_TOKEN_LIVE, looksLive: String(process.env.PADDLE_CLIENT_TOKEN_LIVE || '').startsWith('live_') },
    priceId: process.env.PADDLE_PRICE_ID_LIVE || null,
    permissions: {},
  };
  if (!key) return out;
  const probe = async (name, path) => {
    try {
      const r = await fetch('https://api.paddle.com' + path, { headers: { authorization: `Bearer ${key}` } });
      const j = await r.json().catch(() => ({}));
      out.permissions[name] = r.ok ? 'ok' : `${r.status}: ${(j.error && (j.error.code || j.error.detail)) || 'error'}`;
    } catch { out.permissions[name] = 'no response'; }
  };
  await Promise.all([
    probe('transaction.read', '/transactions?per_page=1'),
    probe('subscription.read', '/subscriptions?per_page=1'),
    probe('customer.read', '/customers?per_page=1'),
    probe('adjustment.read', '/adjustments?per_page=1'),
  ]);
  return out;
}
