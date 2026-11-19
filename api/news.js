import { getSession, json } from '../lib/session.js';
import { cacheGet, cacheSet } from '../lib/store.js';
import { exaConfigured, newsFor, briefFor } from '../lib/exa.js';
import { paywallOn, planFor } from '../lib/billing.js';

const TTL = 15 * 60; // seconds; news per symbol is shared between users
const hits = new Map(); // best-effort per-user rate limit (per function instance)

function limited(email) {
  const now = Date.now(), w = hits.get(email) || [];
  const recent = w.filter(t => now - t < 60000);
  recent.push(now); hits.set(email, recent);
  return recent.length > 30;
}

// GET /api/news?sym=NVDA[&brief=1]
export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (paywallOn() && (await planFor(s.email)).plan !== 'pro') return json({ error: 'Insights are part of Pro.' }, 402);
  if (!exaConfigured()) return json({ configured: false });
  const url = new URL(request.url);
  const sym = (url.searchParams.get('sym') || '').toUpperCase();
  if (!/^[A-Z][A-Z.]{0,5}$/.test(sym)) return json({ error: 'Invalid symbol' }, 400);
  const wantBrief = url.searchParams.get('brief') === '1';
  if (limited(s.email)) return json({ error: 'Too many requests, try again in a minute' }, 429);

  const out = { configured: true, sym };
  try {
    let news = await cacheGet(`news:${sym}`);
    out.cached = !!news;
    if (!news) { news = await newsFor(sym); news.at = Date.now(); await cacheSet(`news:${sym}`, news, TTL); }
    Object.assign(out, news);
  } catch (e) {
    out.error = 'Could not load news: ' + e.message;
  }
  if (wantBrief) {
    try {
      let brief = await cacheGet(`brief:${sym}`);
      if (!brief) { brief = await briefFor(sym); brief.at = Date.now(); await cacheSet(`brief:${sym}`, brief, TTL * 2); }
      out.brief = brief;
    } catch (e) {
      out.briefError = 'Could not load summary: ' + e.message;
    }
  }
  return json(out, out.error && !out.articles ? 502 : 200);
}
