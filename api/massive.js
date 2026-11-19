import { getSession, json } from '../lib/session.js';
import { isAllowedPath, massiveGet } from '../lib/massive.js';
import { alpacaConfigured, alpacaRoute } from '../lib/alpaca.js';
import { GET as universeGET } from '../lib/handlers/universe.js';
import { checkQuota } from '../lib/quota.js';

// GET /api/massive?path=v3/snapshot/options/SPY&limit=250&...
export async function GET(request) {
  // /api/universe is rewritten here (vercel.json) to stay within the Hobby plan's function limit.
  if (new URL(request.url).searchParams.get('fn') === 'universe') return universeGET(request);
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!isAllowedPath(path)) return json({ error: 'This endpoint is not allowed' }, 403);
  // Free plan: opening an option chain uses one of the day's free symbols.
  const chainOf = (path.match(/^v3\/snapshot\/options\/([A-Za-z0-9.]{1,10})(?:\/|$)/) || [])[1];
  const over = await checkQuota(s.email, chainOf ? chainOf.toUpperCase() : null);
  if (over) return json(over, over.status || 402);
  const params = [...url.searchParams].filter(([k]) => k !== 'path');

  // Alpaca keys take precedence; the response is converted to the same shape.
  if (alpacaConfigured()) {
    try { return json(await alpacaRoute(path, Object.fromEntries(params))); }
    catch (e) { return json({ error: e.message || 'Alpaca request failed' }, e.status || 502); }
  }
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return json({ error: 'No market data key is set (ALPACA_KEY_ID / ALPACA_SECRET_KEY or MASSIVE_API_KEY)' }, 500);
  try {
    const { status, text } = await massiveGet(path, params, key);
    return new Response(text, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
  } catch {
    return json({ error: 'Massive API did not respond' }, 502);
  }
}
