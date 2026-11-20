import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(40);
const { sign, SESSION_COOKIE } = await import('../lib/session.js');
const alp = await import('../lib/alpaca.js');
const massiveApi = await import('../api/massive.js');
const trackedApi = await import('../api/tracked.js');
const uniApi = await import('../lib/handlers/universe.js');
const configApi = await import('../api/config.js');

const SNAP = {
  latestTrade: { t: '2026-11-19T15:00:00Z', x: 'C', p: 5.1, s: 20, c: 'S' },
  latestQuote: { bp: 5.0, ap: 5.2, bs: 10, as: 12 },
  dailyBar: { o: 4.5, h: 5.3, l: 4.4, c: 5.1, v: 1234 },
  prevDailyBar: { c: 4.25 },
  greeks: { delta: 0.52, gamma: 0.03, theta: -0.2, vega: 0.4 },
  impliedVolatility: 0.21,
};
const STOCK = { latestTrade: { p: 600 }, latestQuote: { bp: 599.9, ap: 600.1, bs: 3, as: 7, t: '2026-11-19T15:00:00Z' }, dailyBar: { o: 595, h: 602, l: 594, c: 600, v: 5e7, vw: 598 }, prevDailyBar: { c: 590 } };

let calls;
beforeEach(() => {
  Object.assign(process.env, { SESSION_SECRET: SECRET, ALLOWED_EMAILS: '*', ALPACA_KEY_ID: 'AKID123', ALPACA_SECRET_KEY: 'SSHH456' });
  delete process.env.ALPACA_STOCK_FEED; delete process.env.ALPACA_OPTIONS_FEED; delete process.env.POLL_MS;
  alp._clearCache();
  calls = [];
  globalThis.fetch = async (u, init) => {
    const url = new URL(String(u)); calls.push({ url, h: init.headers });
    const p = url.pathname;
    const ok = b => new Response(JSON.stringify(b), { status: 200 });
    if (p === '/v1beta1/options/snapshots/SPY') {
      if (!url.searchParams.get('page_token')) return ok({ snapshots: { SPY261218C00600000: SNAP }, next_page_token: 'p2' });
      return ok({ snapshots: { SPY261218P00590000: { ...SNAP, greeks: { delta: -0.4 } } }, next_page_token: null });
    }
    if (p === '/v1beta1/options/snapshots') return ok({ snapshots: { SPY261218C00600000: SNAP } });
    if (p === '/v2/stocks/snapshots') {
      const syms = url.searchParams.get('symbols').split(',');
      if (syms.includes('RATE')) return new Response('{"message":"too many requests"}', { status: 429 });
      return ok(Object.fromEntries(syms.map(s => [s, STOCK])));
    }
    if (p === '/v2/stocks/NVDA/bars') {
      if (!url.searchParams.get('page_token')) return ok({ bars: [{ t: '2026-11-19T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }], next_page_token: 'b2' });
      return ok({ bars: [{ t: '2026-11-19T14:35:00Z', o: 1.5, h: 2.5, l: 1.4, c: 2, v: 80 }], next_page_token: null });
    }
    if (p === '/v2/options/contracts') return ok({ option_contracts: [{ symbol: 'SPY261218C00600000', open_interest: '4321', close_price: '4.25' }], next_page_token: null });
    if (p === '/v2/assets') return ok([
      { symbol: 'SPY', name: 'SPDR S&P 500', exchange: 'ARCA', tradable: true, attributes: ['has_options'] },
      { symbol: 'ABCD', name: 'Otc Co', exchange: 'OTC', tradable: true, attributes: [] },
      { symbol: 'XYZ', name: 'Xyz Inc', exchange: 'NYSE', tradable: true, attributes: [] },
    ]);
    if (p === '/v1beta1/screener/stocks/most-actives') return ok({ most_actives: [{ symbol: 'NVDA' }, { symbol: 'TSLA' }] });
    return new Response('{}', { status: 404 });
  };
});

async function req(path) {
  const t = await sign({ email: 'a@b.com', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return new Request('https://os.example.com' + path, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(t)}` } });
}

test('OCC symbols parse', () => {
  assert.deepEqual(alp.parseOcc('O:SPY261218C00600000'), { und: 'SPY', exp: '2026-12-18', type: 'C', strike: 600 });
  assert.deepEqual(alp.parseOcc('BRK.B270115P00450500'), { und: 'BRK.B', exp: '2027-01-15', type: 'P', strike: 450.5 });
  assert.equal(alp.parseOcc('nope'), null);
});

test('option chain: all pages, Massive shape, open interest, keys only in headers', async () => {
  const r = await massiveApi.GET(await req('/api/massive?path=v3/snapshot/options/SPY&expiration_date=2026-12-18&strike_price.gte=500'));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.results.length, 2);
  const c = j.results.find(x => x.details.ticker === 'O:SPY261218C00600000');
  assert.equal(c.details.contract_type, 'call');
  assert.equal(c.details.strike_price, 600);
  assert.equal(c.last_quote.bid, 5.0);
  assert.equal(c.last_quote.midpoint, 5.1);
  assert.equal(c.last_quote.bid_size, 10); assert.equal(c.last_quote.ask_size, 12);
  assert.equal(c.open_interest, 4321);
  assert.equal(c.day.volume, 1234);
  assert.equal(c.implied_volatility, 0.21);
  assert.equal(c.underlying_asset.price, 600);
  assert.equal(Math.round(c.day.change_percent), 20);
  const chainCall = calls.find(x => x.url.pathname === '/v1beta1/options/snapshots/SPY');
  assert.equal(chainCall.url.searchParams.get('strike_price_gte'), '500');
  assert.equal(chainCall.url.searchParams.get('expiration_date'), '2026-12-18');
  assert.equal(chainCall.h['APCA-API-KEY-ID'], 'AKID123');
  assert.ok(calls.every(x => !x.url.search.includes('AKID123') && !x.url.search.includes('SSHH456')));
  assert.ok(!JSON.stringify(j).includes('SSHH456'));
});

test('stocks snapshot in Massive shape, IEX feed by default', async () => {
  const j = await (await massiveApi.GET(await req('/api/massive?path=v2/snapshot/locale/us/markets/stocks/tickers&tickers=SPY,QQQ'))).json();
  assert.equal(j.tickers.length, 2);
  assert.equal(j.tickers[0].lastTrade.p, 600);
  assert.equal(j.tickers[0].prevDay.c, 590);
  assert.equal(j.tickers[0].lastQuote.s, 3); assert.equal(j.tickers[0].lastQuote.S, 7); // bid/ask sizes for the drawer
  assert.equal(calls[0].url.searchParams.get('feed'), 'iex');
  const prev = await (await massiveApi.GET(await req('/api/massive?path=v2/aggs/ticker/SPY/prev'))).json();
  assert.equal(prev.results[0].c, 590);
});

test('rate limit errors are passed on clearly', async () => {
  const r = await massiveApi.GET(await req('/api/massive?path=v2/snapshot/locale/us/markets/stocks/tickers&tickers=RATE'));
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /rate limit/);
});

test('tracked contracts', async () => {
  const j = await (await trackedApi.GET(await req('/api/tracked?c=O:SPY261218C00600000'))).json();
  assert.equal(j.results.length, 1);
  assert.equal(j.results[0].open_interest, 4321);
});

test('universe lists listed stocks only, with options flag', async () => {
  const j = await (await uniApi.GET(await req('/api/universe'))).json();
  assert.deepEqual(j.rows.map(r => r.s), ['SPY', 'XYZ']);
  assert.equal(j.rows[0].o, 1);
  assert.equal(j.rows[0].p, 600);
  const a = await (await uniApi.GET(await req('/api/universe?active=2'))).json();
  assert.deepEqual(a.symbols, ['NVDA', 'TSLA']);
});

test('config reports provider and slower polling on Alpaca', async () => {
  const j = await (await configApi.GET(await req('/api/config'))).json();
  assert.equal(j.provider, 'alpaca');
  assert.equal(j.keyConfigured, true);
  assert.equal(j.pollMs, 3000);
});

test('rewritten routes: /api/universe -> massive?fn=universe', async () => {
  const m = await import('../api/massive.js');
  const j = await (await m.GET(await req('/api/massive?fn=universe&active=2'))).json();
  assert.deepEqual(j.symbols, ['NVDA', 'TSLA']);
  const vj = JSON.parse((await import('node:fs')).readFileSync('vercel.json', 'utf8'));
  assert.ok(vj.rewrites.some(r => r.source === '/api/universe' && r.destination === '/api/massive?fn=universe'));
  assert.ok(vj.rewrites.some(r => r.source === '/api/track' && r.destination === '/api/userdata'));
});

test('price bars for the chart: Massive aggregates shape, all pages, only safe paths allowed', async () => {
  const r = await massiveApi.GET(await req('/api/massive?path=' + encodeURIComponent('v2/aggs/ticker/NVDA/range/5/minute/2026-11-15/2026-11-19')));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.results.map(b => b.c), [1.5, 2]); assert.equal(j.results[0].t, Date.parse('2026-11-19T14:30:00Z'));
  const call = calls.find(c => c.url.pathname === '/v2/stocks/NVDA/bars');
  assert.equal(call.url.searchParams.get('timeframe'), '5Min'); assert.equal(call.url.searchParams.get('feed'), 'iex'); assert.equal(call.url.searchParams.get('adjustment'), 'split');
  for (const bad of ['v2/aggs/ticker/NVDA/range/5/second/2026-11-15/2026-11-19', 'v2/aggs/ticker/NVDA/range/5/minute/2026-11-15/x', 'v2/aggs/ticker/../range/1/day/2026-01-01/2026-02-01'])
    assert.equal((await massiveApi.GET(await req('/api/massive?path=' + encodeURIComponent(bad)))).status, 403, bad);
  assert.equal((await massiveApi.GET(await req('/api/massive?path=' + encodeURIComponent('v2/aggs/ticker/NVDA/range/90/minute/2026-11-15/2026-11-19')))).status, 400);
});
