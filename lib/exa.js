// News for a ticker via Exa (https://exa.ai). The key stays on the server (EXA_API_KEY).
const EXA = 'https://api.exa.ai';

export const exaConfigured = () => !!process.env.EXA_API_KEY;

// Company names make Exa's news search noticeably more precise than bare tickers.
const NAMES = {
  SPY: 'S&P 500 SPY ETF', QQQ: 'Nasdaq 100 QQQ ETF', IWM: 'Russell 2000 IWM ETF', DIA: 'Dow Jones DIA ETF',
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'Nvidia', TSLA: 'Tesla', AMZN: 'Amazon', META: 'Meta Platforms',
  AMD: 'AMD Advanced Micro Devices', GOOGL: 'Alphabet Google', GOOG: 'Alphabet Google', NFLX: 'Netflix', AVGO: 'Broadcom',
  PLTR: 'Palantir', COIN: 'Coinbase', MSTR: 'MicroStrategy Strategy', UBER: 'Uber', BA: 'Boeing', JPM: 'JPMorgan',
  BAC: 'Bank of America', INTC: 'Intel', MU: 'Micron', SOFI: 'SoFi', HOOD: 'Robinhood', DIS: 'Disney', NKE: 'Nike',
  PYPL: 'PayPal', XOM: 'Exxon Mobil', WMT: 'Walmart', COST: 'Costco', CRM: 'Salesforce', ORCL: 'Oracle', SHOP: 'Shopify',
  SMCI: 'Super Micro Computer', SMH: 'semiconductor SMH ETF', TLT: 'Treasury bonds TLT ETF', GLD: 'gold GLD ETF',
  XLF: 'financials XLF ETF', XLE: 'energy XLE ETF',
};
export const nameFor = sym => NAMES[sym] || sym;

async function post(path, body) {
  const res = await fetch(EXA + path, {
    method: 'POST',
    headers: { 'x-api-key': process.env.EXA_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || j.message || `Exa HTTP ${res.status}`);
  return j;
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export async function newsFor(sym, days = 14) {
  const name = nameFor(sym);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const search = await post('/search', {
    query: `${name} (${sym}) stock news`,
    type: 'auto',
    category: 'news',
    numResults: 8,
    startPublishedDate: since,
    contents: {
      highlights: { query: `What happened to ${name} stock and why it matters for investors`, maxCharacters: 400 },
      summary: { query: `In one sentence, what does this mean for ${name} (${sym}) stock?` },
    },
  });
  const articles = (search.results || [])
    .filter(r => r.url && r.title)
    .map(r => ({
      title: clip(r.title, 160),
      url: r.url,
      source: host(r.url),
      published: r.publishedDate || null,
      image: r.image || null,
      favicon: r.favicon || null,
      summary: clip(r.summary, 320),
      highlight: clip((r.highlights || [])[0], 320),
    }));
  return { sym, name, articles };
}

export async function briefFor(sym) {
  const name = nameFor(sym);
  const j = await post('/answer', {
    query: `Based on news from the last two weeks, what are the 3 most important developments affecting ${name} (${sym}) stock? ` +
      'Answer in English as short bullet points; include the date and source in each bullet. Do not give investment advice.',
    text: false,
  });
  return {
    text: clip(typeof j.answer === 'string' ? j.answer : JSON.stringify(j.answer), 1600),
    citations: (j.citations || []).slice(0, 6).map(c => ({ title: clip(c.title, 140), url: c.url, source: host(c.url), published: c.publishedDate || null })),
  };
}
