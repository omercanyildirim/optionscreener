// /api/billing?a=portal          (GET, signed in)  -> redirect to Paddle's customer portal (card, invoices, cancel)
// /api/billing?a=status          (GET, signed in)  -> current plan
// /api/paddle-webhook            (POST, from Paddle; rewritten here with a=webhook) -> subscription updates
import { getSession, json } from '../lib/session.js';
import { verifyWebhook, handleEvent, getSubscription, portalUrl, billingInfo } from '../lib/billing.js';
import { storeConfigured } from '../lib/store.js';
import { logEvent } from '../lib/activity.js';

const action = request => new URL(request.url).searchParams.get('a') || '';

export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  const a = action(request);
  if (a === 'status') return json(await billingInfo(s.email));
  if (a === 'portal') {
    const sub = await getSubscription(s.email);
    if (!sub || !sub.customerId) return json({ error: 'No subscription yet.' }, 404);
    if (!process.env.PADDLE_API_KEY) return json({ error: 'Billing portal is not configured.' }, 503);
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
  const r = await handleEvent(evt);
  if (r.email) await logEvent(r.email, 'settings_saved', `subscription ${r.status}`);
  return json({ ok: true, ...r });
}
