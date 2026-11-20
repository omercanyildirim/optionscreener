// /api/billing?a=portal          (GET, signed in)  -> redirect to Paddle's customer portal (card, invoices, cancel)
// /api/billing?a=status          (GET, signed in)  -> current plan
// /api/paddle-webhook            (POST, from Paddle; rewritten here with a=webhook) -> subscription updates
import { getSession, json } from '../lib/session.js';
import { verifyWebhook, handleEvent, getSubscription, portalUrl, billingInfo, syncTransaction, accountFrom, emailForCustomer, paddleVar } from '../lib/billing.js';
import { txnRow, invoicePdf } from '../lib/payments.js';
import { sendPaymentEmailOnce } from '../lib/mail.js';
import { storeConfigured, cmd } from '../lib/store.js';
import { logEvent } from '../lib/activity.js';
import { markUsed } from '../lib/discounts.js';

const action = request => new URL(request.url).searchParams.get('a') || '';

export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  const a = action(request);
  if (a === 'status') return json(await billingInfo(s.email, request.headers.get('x-vercel-ip-country') || ''));
  // ?a=sync&txn=txn_...: confirm a just-finished checkout with Paddle, then return the plan.
  if (a === 'sync') {
    if (!storeConfigured()) return json({ error: 'database not connected' }, 503);
    try {
      const r = await syncTransaction(s.email, new URL(request.url).searchParams.get('txn'));
      if (r.error) return json({ error: r.error }, r.status || 400);
      if (r.email) await logEvent(r.email, 'settings_saved', `subscription ${r.status} (checkout)`);
      return json({ ...r, billing: await billingInfo(s.email) });
    } catch (e) { return json({ error: e.message }, 502); }
  }
  if (a === 'portal') {
    const sub = await getSubscription(s.email);
    if (!sub || !sub.customerId) return json({ error: 'No subscription yet.' }, 404);
    if (!paddleVar('PADDLE_API_KEY')) return json({ error: 'Billing portal is not configured.' }, 503);
    try {
      const url = await portalUrl(sub.customerId, sub.id);
      return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  return json({ error: 'not found' }, 404);
}

export async function POST(request) {
  if (action(request) !== 'webhook') return json({ error: 'not found' }, 404);
  const raw = await request.text();
  if (raw.length > 200000) return json({ error: 'too large' }, 413);
  if (!(await verifyWebhook(raw, request.headers.get('paddle-signature')))) return json({ error: 'invalid signature' }, 401);
  if (!storeConfigured()) return json({ error: 'database not connected' }, 503); // Paddle retries later
  let evt; try { evt = JSON.parse(raw); } catch { return json({ error: 'invalid JSON' }, 400); }
  if (evt.event_type === 'transaction.completed') {
    try { return json({ ok: true, ...(await onPayment(evt.data || {})) }); }
    catch (e) { return json({ error: 'email failed: ' + e.message }, 500); } // Paddle retries the webhook
  }
  const r = await handleEvent(evt);
  if (r.email) await logEvent(r.email, 'settings_saved', `subscription ${r.status}`);
  return json({ ok: true, ...r });
}

// A payment went through (first payment or monthly renewal): note it and email the customer.
async function onPayment(d) {
  const email = (await accountFrom(d.custom_data)) || (await emailForCustomer(d.customer_id));
  if (!email) return { payment: d.id, error: 'unknown account' };
  const t = txnRow(d), sub = await getSubscription(email);
  let name = ''; try { name = (await cmd(['HGET', `os:u:${email}`, 'givenName'])) || (await cmd(['HGET', `os:u:${email}`, 'name'])) || ''; } catch {}
  await logEvent(email, 'payment', `${t.total != null ? t.total.toFixed(2) : '?'} ${t.currency} ${t.invoice || d.id}`);
  if (d.discount_id && await markUsed(email, d.discount_id)) await logEvent(email, 'discount', 'Discount used on ' + (t.invoice || d.id));
  const m = await sendPaymentEmailOnce(d.id, email, {
      name, amount: t.total, tax: t.tax, currency: t.currency, paidAt: t.at || new Date().toISOString(),
      nextBill: sub && sub.nextBill, invoice: t.invoice, method: t.method, renewal: d.origin === 'subscription_recurring',
    }, () => invoicePdf(d.id, t.invoice));
  return { payment: d.id, email, mail: m.id ? 'sent' : m.skipped || 'skipped', invoice: !!m.invoice };
}
