import { getSession, json } from '../lib/session.js';
import { massiveGet, parseOptionTicker } from '../lib/massive.js';

const MAX = 50;

// GET /api/tracked?c=O:SPY261218C00600000,O:AAPL...  -> snapshots for the tracked contracts
export async function GET(request) {
  if (!(await getSession(request))) return json({ error: 'unauthorized' }, 401);
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return json({ error: 'MASSIVE_API_KEY tanımlı değil' }, 500);

  const list = [...new Set((new URL(request.url).searchParams.get('c') || '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, MAX);
  const results = [];
  const errors = [];
  await Promise.all(list.map(async t => {
    const p = parseOptionTicker(t);
    if (!p) { errors.push({ ticker: t, error: 'geçersiz kontrat' }); return; }
    try {
      const { status, text } = await massiveGet(`v3/snapshot/options/${p.underlying}/${t}`, null, key);
      const j = JSON.parse(text);
      if (status === 200 && j.results) results.push(j.results);
      else errors.push({ ticker: t, error: j.message || j.error || `HTTP ${status}` });
    } catch {
      errors.push({ ticker: t, error: 'istek başarısız' });
    }
  }));
  return json({ results, errors });
}
