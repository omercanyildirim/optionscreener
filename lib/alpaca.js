// Market data from Alpaca (https://alpaca.markets), returned in the same shapes the frontend already
// reads (Massive/Polygon style), so the app works with either provider. Keys never leave the server.
//
// Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY
//      ALPACA_STOCK_FEED   iex (free Basic plan, default) | sip (Algo Trader Plus)
//      ALPACA_OPTIONS_FEED indicative (free) | opra (paid) — left out by default, Alpaca picks per account
//      ALPACA_TRADING_URL  https://paper-api.alpaca.markets (default; paper keys) or https://api.alpaca.markets
const DATA = 'https://data.alpaca.markets';

export const alpacaConfigured = () => !!(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
const tradingBase = () => (process.env.ALPACA_TRADING_URL || 'https://paper-api.alpaca.markets').replace(/\/+$/, '');
const stockFeed = () => process.env.ALPACA_STOCK_FEED || 'iex';
const optionFeed = () => process.env.ALPACA_OPTIONS_FEED || '';
export const feedInfo = () => ({ stocks: stockFeed(), options: optionFeed() || 'auto' });

export class AlpacaError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function aGet(base, path, params) {
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  const key = process.env.ALPACA_KEY_ID, secret = process.env.ALPACA_SECRET_KEY;
  let res;
  try {
    res = await fetch(u, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, accept: 'application/json' } });
  } catch { throw new AlpacaError(502, 'Alpaca did not respond'); }
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    let msg = (j && (j.message || j.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
    for (const s of [key, secret]) if (s) msg = msg.split(s).join('');
    if (res.status === 429) msg = 'Alpaca rate limit reached (free plan: 200 requests/min). Data will refresh shortly.';
    throw new AlpacaError(res.status, msg);
  }
  return j ?? {};
}
const data = (path, params) => aGet(DATA, path, params);
const trading = (path, params) => aGet(tradingBase(), path, params);

// Small shared cache: de-duplicates parallel requests, serves the last good value when Alpaca fails
// (e.g. 429 on the free plan). Lives per server instance.
const CACHE = new Map();
export function _clearCache() { CACHE.clear(); }
async function cached(key, ttlMs, fn) {
  const now = Date.now(), e = CACHE.get(key);
  if (e && e.val !== undefined && now - e.at < ttlMs) return e.val;
  if (e && e.p) return e.p;
  const p = (async () => fn())();
  CACHE.set(key, { ...(e || {}), p });
  try {
    const val = await p;
    CACHE.set(key, { at: Date.now(), val });
    if (CACHE.size > 2000) for (const k of [...CACHE.keys()].slice(0, 500)) CACHE.delete(k);
    return val;
  } catch (err) {
    if (e && e.val !== undefined && now - e.at < 10 * 60e3) { CACHE.set(key, { at: e.at, val: e.val }); return e.val; }
    CACHE.delete(key);
    throw err;
  }
}

/* ---------- symbols ---------- */
// Alpaca: SPY261218C00600000   app: O:SPY261218C00600000
export const toOcc = t => String(t || '').replace(/^O:/, '');
export function parseOcc(sym) {
  const m = /^([A-Z.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(toOcc(sym));
  return m ? { und: m[1], exp: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5], strike: +m[6] / 1000 } : null;
}
const n = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* ---------- stocks ---------- */
async function stockSnapshots(symbols) {
  const syms = [...new Set(symbols.map(s => String(s).trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9.]{0,9}$/.test(s)))];
  const out = {};
  for (let i = 0; i < syms.length; i += 400) {
    const chunk = syms.slice(i, i + 400);
    const j = await cached(`ss:${chunk.join(',')}`, 2500, () => data('/v2/stocks/snapshots', { symbols: chunk.join(','), feed: stockFeed() }));
    Object.assign(out, j.snapshots || j);
  }
  return out;
}
function toMassiveStock(sym, s) {
  const lt = s.latestTrade || {}, lq = s.latestQuote || {}, d = s.dailyBar || {}, pd = s.prevDailyBar || {}, m = s.minuteBar || {};
  const price = n(lt.p) ?? n(m.c) ?? n(d.c);
  return {
    ticker: sym,
    lastTrade: { p: price, s: n(lt.s), t: lt.t },
    lastQuote: { p: n(lq.bp), P: n(lq.ap) },
    min: { c: n(m.c) },
    day: { o: n(d.o), h: n(d.h), l: n(d.l), c: n(d.c), v: n(d.v), vw: n(d.vw) },
    prevDay: { c: n(pd.c) },
    todaysChangePerc: price != null && n(pd.c) ? (price - pd.c) / pd.c * 100 : null,
  };
}
export async function stocksMassive(tickers) {
  const snaps = await stockSnapshots(String(tickers || '').split(','));
  return { status: 'OK', tickers: Object.entries(snaps).filter(([, s]) => s).map(([sym, s]) => toMassiveStock(sym, s)) };
}
export async function prevMassive(sym) {
  const snaps = await stockSnapshots([sym]); const s = snaps[sym] || {};
  const pd = s.prevDailyBar || s.dailyBar;
  return { status: 'OK', results: pd ? [{ T: sym, o: pd.o, h: pd.h, l: pd.l, c: pd.c, v: pd.v }] : [] };
}
async function underlyingPrice(sym) {
  try { const s = (await stockSnapshots([sym]))[sym] || {}; return n((s.latestTrade || {}).p) ?? n((s.dailyBar || {}).c) ?? n((s.prevDailyBar || {}).c); }
  catch { return null; }
}

/* ---------- options ---------- */
// Open interest is not in the market-data snapshots; it comes from the trading API's contract list
// (updated once a day), so it is cached for 15 minutes.
async function openInterest(und, q) {
  const params = {
    underlying_symbols: und, status: 'active', limit: 10000,
    expiration_date: q.expiration_date, expiration_date_gte: q.expiration_date_gte, expiration_date_lte: q.expiration_date_lte,
    strike_price_gte: q.strike_price_gte, strike_price_lte: q.strike_price_lte,
  };
  if (!params.expiration_date && !params.expiration_date_gte) params.expiration_date_gte = new Date().toISOString().slice(0, 10);
  return cached(`oi:${JSON.stringify(params)}`, 15 * 60e3, async () => {
    const map = {}; let page = null, i = 0;
    do {
      const j = await trading('/v2/options/contracts', { ...params, page_token: page });
      for (const c of j.option_contracts || []) map[c.symbol] = { oi: n(+c.open_interest), close: n(+c.close_price) };
      page = j.next_page_token; i++;
    } while (page && i < 10);
    return map;
  });
}
function toMassiveOption(sym, s, oi, uPrice) {
  const p = parseOcc(sym); if (!p) return null;
  const q = s.latestQuote || {}, tr = s.latestTrade || {}, d = s.dailyBar || {}, pd = s.prevDailyBar || {}, g = s.greeks || {};
  const bid = n(q.bp), ask = n(q.ap) > 0 ? q.ap : null, last = n(tr.p) ?? n(d.c); // ask 0 = no offer
  const o = oi || {};
  const prevClose = n(pd.c) ?? o.close;
  return {
    details: { ticker: 'O:' + sym, contract_type: p.type === 'C' ? 'call' : 'put', strike_price: p.strike, expiration_date: p.exp },
    last_quote: { bid, ask, midpoint: bid != null && ask != null ? (bid + ask) / 2 : null, bid_size: n(q.bs), ask_size: n(q.as), sip_timestamp: q.t ? Date.parse(q.t) * 1e6 : null, timeframe: optionFeed() === 'opra' ? 'REAL-TIME' : 'INDICATIVE' },
    last_trade: { price: last, size: n(tr.s), sip_timestamp: tr.t ? Date.parse(tr.t) * 1e6 : null, exchange: tr.x || null, conditions: tr.c ? [tr.c] : [] },
    greeks: { delta: n(g.delta), gamma: n(g.gamma), theta: n(g.theta), vega: n(g.vega) },
    implied_volatility: n(s.impliedVolatility),
    open_interest: o.oi ?? null,
    day: { volume: n(d.v) ?? 0, close: n(d.c), open: n(d.o), high: n(d.h), low: n(d.l), vwap: n(d.vw),
      change_percent: last != null && prevClose ? (last - prevClose) / prevClose * 100 : null },
    break_even_price: last != null ? (p.type === 'C' ? p.strike + last : p.strike - last) : null,
    underlying_asset: { ticker: p.und, price: uPrice },
  };
}
const MAX_PAGES = 30;
// Massive-style query (expiration_date, expiration_date.gte, strike_price.lte, ...) -> whole chain in one response
export async function chainMassive(und, params) {
  und = String(und).toUpperCase();
  const q = {};
  for (const [k, v] of Object.entries(params || {})) {
    const kk = k.replace('.', '_');
    if (['expiration_date', 'expiration_date_gte', 'expiration_date_lte', 'strike_price_gte', 'strike_price_lte', 'type'].includes(kk)) q[kk] = v;
    if (kk === 'contract_type') q.type = v;
  }
  const key = `ch:${und}:${JSON.stringify(q)}`;
  const snaps = await cached(key, 2500, async () => {
    const all = {}; let page = null, i = 0;
    do {
      const j = await data(`/v1beta1/options/snapshots/${encodeURIComponent(und)}`, { ...q, feed: optionFeed(), limit: 1000, page_token: page });
      Object.assign(all, j.snapshots || {});
      page = j.next_page_token; i++;
    } while (page && i < MAX_PAGES);
    return all;
  });
  const [oi, uPrice] = await Promise.all([openInterest(und, q).catch(() => ({})), underlyingPrice(und)]);
  const results = Object.entries(snaps).map(([sym, s]) => toMassiveOption(sym, s, oi[sym], uPrice)).filter(Boolean);
  return { status: 'OK', results };
}
// Snapshots for specific contracts (the watchlist), in batches of 100.
export async function contractsMassive(tickers) {
  const syms = [...new Set(tickers.map(toOcc).filter(s => parseOcc(s)))];
  const snaps = {};
  for (let i = 0; i < syms.length; i += 100) {
    const chunk = syms.slice(i, i + 100);
    const j = await cached(`cs:${chunk.join(',')}`, 2500, () => data('/v1beta1/options/snapshots', { symbols: chunk.join(','), feed: optionFeed() }));
    Object.assign(snaps, j.snapshots || {});
  }
  const unds = [...new Set(Object.keys(snaps).map(s => parseOcc(s).und))];
  const prices = Object.fromEntries(await Promise.all(unds.map(async u => [u, await underlyingPrice(u)])));
  const ois = {};
  await Promise.all(unds.map(async u => { try { Object.assign(ois, await openInterest(u, {})); } catch { /* optional */ } }));
  const results = Object.entries(snaps).map(([sym, s]) => toMassiveOption(sym, s, ois[sym], prices[parseOcc(sym).und])).filter(Boolean);
  const missing = syms.filter(s => !snaps[s]).map(s => ({ ticker: 'O:' + s, error: 'no data' }));
  return { results, errors: missing };
}

/* ---------- whole market ---------- */
const EXCH = new Set(['NYSE', 'NASDAQ', 'ARCA', 'AMEX', 'BATS']);
async function assets() {
  return cached('assets', 6 * 3600e3, async () => {
    const list = await trading('/v2/assets', { status: 'active', asset_class: 'us_equity' });
    return (Array.isArray(list) ? list : [])
      .filter(a => a.tradable && EXCH.has(a.exchange) && /^[A-Z][A-Z0-9.]{0,9}$/.test(a.symbol))
      .map(a => ({ s: a.symbol, n: a.name || '', x: a.exchange, o: (a.attributes || []).includes('has_options') ? 1 : 0 }));
  });
}
// Every listed US stock/ETF with price, change and volume. Refreshed at most every 90 s and shared by all users.
export async function universe() {
  return cached('universe', 90e3, async () => {
    const list = await assets();
    const snaps = {};
    const chunks = []; for (let i = 0; i < list.length; i += 400) chunks.push(list.slice(i, i + 400).map(a => a.s));
    for (let i = 0; i < chunks.length; i += 4) {
      const res = await Promise.allSettled(chunks.slice(i, i + 4).map(c => data('/v2/stocks/snapshots', { symbols: c.join(','), feed: stockFeed() })));
      for (const r of res) if (r.status === 'fulfilled') Object.assign(snaps, r.value.snapshots || r.value);
    }
    const rows = list.map(a => {
      const s = snaps[a.s] || {}, lt = s.latestTrade || {}, d = s.dailyBar || {}, pd = s.prevDailyBar || {};
      const p = n(lt.p) ?? n(d.c) ?? n(pd.c), pc = n(pd.c);
      return { ...a, p, c: p != null && pc ? +((p - pc) / pc * 100).toFixed(2) : null, v: n(d.v) ?? 0, dv: p != null && n(d.v) ? Math.round(p * d.v) : 0 };
    });
    return { at: Date.now(), feed: stockFeed(), count: rows.length, rows };
  });
}
export async function mostActive(top = 20) {
  return cached(`ma:${top}`, 5 * 60e3, async () => {
    const j = await data('/v1beta1/screener/stocks/most-actives', { by: 'volume', top });
    return (j.most_actives || []).map(x => x.symbol).filter(Boolean);
  });
}

/* ---------- router for /api/massive?path=... ---------- */
export async function alpacaRoute(path, params) {
  let m;
  if ((m = /^v3\/snapshot\/options\/([A-Za-z0-9.]+)$/.exec(path))) return chainMassive(m[1], params);
  if ((m = /^v3\/snapshot\/options\/[A-Za-z0-9.]+\/(O:[A-Z0-9.]+)$/.exec(path))) {
    const r = await contractsMassive([m[1]]); return { status: 'OK', results: r.results[0] || null };
  }
  if (path === 'v2/snapshot/locale/us/markets/stocks/tickers') return stocksMassive(params.tickers);
  if ((m = /^v2\/snapshot\/locale\/us\/markets\/stocks\/tickers\/([A-Za-z0-9.]+)$/.exec(path))) {
    const r = await stocksMassive(m[1]); return { status: 'OK', ticker: r.tickers[0] || null };
  }
  if ((m = /^v2\/aggs\/ticker\/([A-Za-z0-9.]+)\/prev$/.exec(path))) return prevMassive(m[1].toUpperCase());
  throw new AlpacaError(403, 'This endpoint is not available with Alpaca');
}
