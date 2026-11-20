// Postgres (Neon, added from the Vercel Marketplace) over Neon's HTTP query endpoint, so no driver package is needed.
// Vercel sets DATABASE_URL when the database is connected. Every query result comes back as one JSON value
// (json_agg in the database), so types arrive as JSON (numbers, booleans, timestamps as ISO strings).

const connStr = () => process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL || '';
export const dbConfigured = () => !!connStr();

// The HTTP endpoint: newer Neon hosts answer on api.<region host>/sql, older ones on <host>/sql. Tests set DB_HTTP_URL.
let endpoint = null;
function endpoints() {
  if (process.env.DB_HTTP_URL) return [process.env.DB_HTTP_URL];
  const host = new URL(connStr()).hostname;
  return [`https://${host.replace(/^[^.]+\./, 'api.')}/sql`, `https://${host}/sql`];
}

async function post(body, batch) {
  const headers = { 'content-type': 'application/json', 'Neon-Connection-String': connStr(), 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'true' };
  if (batch) Object.assign(headers, { 'Neon-Batch-Isolation-Level': 'ReadCommitted', 'Neon-Batch-Read-Only': 'false' });
  const list = endpoint ? [endpoint] : endpoints();
  let last;
  for (const ep of list) {
    let res;
    try { res = await fetch(ep, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (e) { last = e; continue; }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404 && !endpoint) { last = new Error('not found'); continue; }
    endpoint = ep;
    if (!res.ok) { const e = new Error(j.message || `Database HTTP ${res.status}`); e.code = j.code; e.status = 500; throw e; }
    return j;
  }
  throw Object.assign(new Error('Database is not reachable' + (last ? ': ' + last.message : '')), { status: 503 });
}

// Wraps a statement so its rows come back as one JSON array.
const DML = /^\s*(insert|update|delete)\b/i;
export const wrap = q => DML.test(q)
  ? `with t as (${q}) select coalesce(json_agg(t), '[]'::json) as j from t`
  : `select coalesce(json_agg(t), '[]'::json) as j from (${q}) t`;
const unpack = r => { const v = r && r.rows && r.rows[0] && (Array.isArray(r.rows[0]) ? r.rows[0][0] : r.rows[0].j); return typeof v === 'string' ? JSON.parse(v) : v || []; };
const norm = p => (p || []).map(v => (v === undefined ? null : typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : v));

// rows(sql, params) -> array of row objects. Use $1, $2 ... placeholders.
export async function rows(query, params) { return unpack(await post({ query: wrap(query), params: norm(params) })); }
export async function one(query, params) { return (await rows(query, params))[0] || null; }
// Statements that return nothing (DDL), run in one transaction.
export async function exec(queries) { return post({ queries: queries.map(q => (typeof q === 'string' ? { query: q, params: [] } : { query: q.query, params: norm(q.params) })) }, true); }
export const _resetEndpoint = () => { endpoint = null; };
