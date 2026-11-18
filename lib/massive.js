// Server-side access to the Massive API. The key never leaves the server.
export const MASSIVE = 'https://api.massive.com';

// Only these read-only endpoints may be called through the proxy.
const ALLOWED = [
  /^v3\/snapshot\/options\/[A-Za-z0-9.^:]+$/,                 // option chain snapshot
  /^v3\/snapshot\/options\/[A-Za-z0-9.^:]+\/O:[A-Z0-9.]+$/,   // single contract snapshot
  /^v2\/snapshot\/locale\/us\/markets\/stocks\/tickers$/,     // multi-ticker stock snapshot
  /^v2\/snapshot\/locale\/us\/markets\/stocks\/tickers\/[A-Za-z0-9.]+$/,
  /^v2\/aggs\/ticker\/[A-Za-z0-9.:]+\/prev$/,
  /^v3\/reference\/options\/contracts$/,
];

export function isAllowedPath(path) {
  return typeof path === 'string' && !path.includes('..') && ALLOWED.some(r => r.test(path));
}

export async function massiveGet(path, params, key) {
  const up = new URL(`${MASSIVE}/${path}`);
  if (params) for (const [k, v] of params) if (k.toLowerCase() !== 'apikey') up.searchParams.set(k, v);
  up.searchParams.set('apiKey', key);
  const res = await fetch(up, { headers: { accept: 'application/json' } });
  const text = await res.text();
  return { status: res.status, text: scrub(text, key) };
}

// Remove the key from anything we return, and point pagination links back at our proxy.
export function scrub(text, key) {
  let out = key ? text.split(key).join('') : text;
  out = out.replace(/https:\/\/api\.massive\.com\/([^"?\s]+)(\?[^"\s]*)?/g, (_m, p, q) => {
    const qs = new URLSearchParams((q || '').replace(/^\?/, ''));
    qs.delete('apiKey');
    qs.delete('apikey');
    const rest = qs.toString();
    return `/api/massive?path=${encodeURIComponent(p)}${rest ? '&' + rest : ''}`;
  });
  return out;
}

// O:SPY261218C00600000 -> { underlying: 'SPY' }
export function parseOptionTicker(t) {
  const m = /^O:([A-Z.]+?)(\d{6})([CP])(\d{8})$/.exec(t || '');
  return m ? { underlying: m[1], date: m[2], type: m[3], strike: +m[4] / 1000 } : null;
}
