// Free plan metering. A free user can open FREE_LOOKS different symbols (option chains) per day, New York time.
// Opening a further symbol locks all market data for that user until the next day; the app then blurs the
// data and shows the upgrade screen. Pro users and admins are never metered. Only active when PAYWALL=true.
import { storeConfigured, pipe } from './store.js';
import { paywallOn, planFor } from './billing.js';

export const freeLimit = () => Math.max(1, Math.floor(+process.env.FREE_LOOKS || 3));
export const quotaDay = (now = Date.now()) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const keys = (email, now) => { const b = `os:q:${quotaDay(now)}:${String(email).toLowerCase()}`; return { set: b, wall: b + ':x' }; };

async function metered(email) {
  if (!paywallOn() || !storeConfigured() || !email) return false;
  return (await planFor(email)).plan !== 'pro';
}

// State for the UI: which symbols were opened today, how many are left, whether the wall is up.
export async function quotaState(email, now = Date.now()) {
  if (!(await metered(email))) return null;
  const k = keys(email, now);
  const [syms, wall] = await pipe([['SMEMBERS', k.set], ['GET', k.wall]]);
  const used = syms || [];
  return { limit: freeLimit(), used, left: Math.max(0, freeLimit() - used.length), walled: !!wall };
}

// Called for every market-data request. sym = the underlying whose chain is being opened, or null for other data.
// Returns null when allowed, or a 402 payload when the free plan is used up.
export async function checkQuota(email, sym, now = Date.now()) {
  let isMetered; try { isMetered = await metered(email); } catch { return null; } // never break the site on a Redis hiccup
  if (!isMetered) return null;
  const k = keys(email, now), limit = freeLimit();
  try {
    const [wall, member, count] = await pipe([['GET', k.wall], ['SISMEMBER', k.set, sym || ''], ['SCARD', k.set]]);
    const blocked = { error: 'free_limit', limit, message: `The free plan includes ${limit} symbols a day. Upgrade to Pro for unlimited access.` };
    if (wall) return blocked;
    if (!sym || +member) return null;
    if (+count < limit) { await pipe([['SADD', k.set, sym], ['EXPIRE', k.set, '172800']]); return null; }
    await pipe([['SET', k.wall, '1', 'EX', '172800']]);
    return blocked;
  } catch { return null; }
}
