// Payments for the admin portal, read live from Paddle's API (transactions, subscriptions, refunds).
// Amounts from Paddle are strings in the currency's smallest unit ("999" = $9.99); converted to numbers here.
import { paddleEnv } from './billing.js';

const apiBase = () => (paddleEnv() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com');
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX']);
const money = (v, cur) => (v == null || v === '' ? null : Number(v) / (ZERO_DECIMAL.has(cur) ? 1 : 100));

async function get(path) {
  const res = await fetch(`${apiBase()}${path}`, { headers: { authorization: `Bearer ${process.env.PADDLE_API_KEY}` } });
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
  if (!process.env.PADDLE_API_KEY) return { configured: false };
  const [txns, subs] = await Promise.all([
    list('/transactions?status=paid,completed,past_due,canceled&include=customer,adjustments&order_by=created_at[DESC]&per_page=100', 5),
    list('/subscriptions?per_page=200&order_by=created_at[DESC]', 3),
  ]);
  const t = txns.map(txnRow);
  const emails = new Map(t.filter(x => x.customerId && x.email).map(x => [x.customerId, x.email]));
  const s = subs.map(x => subRow(x, id => emails.get(id)));
  const paid = t.filter(x => ['paid', 'completed'].includes(x.status));
  const month = new Date(now); const m0 = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1);
  const sum = (arr, k) => Math.round(arr.reduce((a, x) => a + (x[k] || 0), 0) * 100) / 100;
  const thisMonth = paid.filter(x => Date.parse(x.at) >= m0);
  return {
    configured: true, env: paddleEnv(), currency: 'USD',
    totals: {
      mrr: sum(s, 'mrr'), active: s.filter(x => x.status === 'active').length, pastDue: s.filter(x => x.status === 'past_due').length,
      canceling: s.filter(x => x.status === 'active' && x.cancelAt).length, canceled: s.filter(x => x.status === 'canceled').length,
      monthRevenue: sum(thisMonth, 'total'), monthEarnings: sum(thisMonth, 'earnings'), monthTax: sum(thisMonth, 'tax'), monthFees: sum(thisMonth, 'fee'),
      monthCount: thisMonth.length, allRevenue: sum(paid, 'total'), allEarnings: sum(paid, 'earnings'), refunded: sum(t, 'refunded'), payments: paid.length,
    },
    transactions: t, subscriptions: s,
  };
}

// A short-lived link to the invoice PDF of a transaction.
export async function invoiceUrl(txnId) {
  if (!/^txn_[a-z0-9]{10,40}$/i.test(String(txnId || ''))) throw Object.assign(new Error('invalid transaction'), { status: 400 });
  const j = await get(`/transactions/${txnId}/invoice?disposition=inline`);
  return j.data && j.data.url;
}
