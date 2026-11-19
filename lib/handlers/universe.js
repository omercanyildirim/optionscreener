import { getSession, json } from '../session.js';
import { alpacaConfigured, universe, mostActive } from '../alpaca.js';
import { checkQuota } from '../quota.js';

// GET /api/universe            -> every listed US stock/ETF: symbol, name, price, % change, volume, has options
// GET /api/universe?active=20  -> most active symbols by volume
export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  const over = await checkQuota(s.email, null);
  if (over) return json(over, over.status || 402);
  if (!alpacaConfigured()) return json({ configured: false, rows: [] });
  const q = new URL(request.url).searchParams;
  try {
    if (q.has('active')) return json({ symbols: await mostActive(Math.min(100, Math.max(1, +q.get('active') || 20))) });
    return json(await universe());
  } catch (e) {
    return json({ error: e.message || 'Alpaca request failed' }, e.status || 502);
  }
}
