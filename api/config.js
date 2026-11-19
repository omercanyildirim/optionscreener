import { getSession, json } from '../lib/session.js';
import { alpacaConfigured, feedInfo } from '../lib/alpaca.js';
import { billingInfo } from '../lib/billing.js';
import { quotaState } from '../lib/quota.js';

export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  return json({
    email: s.email,
    name: s.name,
    // The free Alpaca plan allows 200 requests/min, so poll a little slower there.
    pollMs: Math.max(alpacaConfigured() ? 3000 : 1000, +(process.env.POLL_MS || 2000)),
    keyConfigured: alpacaConfigured() || !!process.env.MASSIVE_API_KEY,
    provider: alpacaConfigured() ? 'alpaca' : process.env.MASSIVE_API_KEY ? 'massive' : null,
    feed: alpacaConfigured() ? feedInfo() : null,
    // DEMO_DATA=true shows simulated data (for previewing before a paid Massive plan).
    // Sample mode switches off by itself once Alpaca keys are added.
    demo: process.env.DEMO_DATA === 'true' && !alpacaConfigured(),
    billing: await billingInfo(s.email),
    free: await quotaState(s.email).catch(() => null),
  });
}
