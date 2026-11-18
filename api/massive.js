import { getSession, json } from '../lib/session.js';
import { isAllowedPath, massiveGet } from '../lib/massive.js';

// GET /api/massive?path=v3/snapshot/options/SPY&limit=250&...
export async function GET(request) {
  if (!(await getSession(request))) return json({ error: 'unauthorized' }, 401);
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return json({ error: 'MASSIVE_API_KEY tanımlı değil' }, 500);

  const url = new URL(request.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!isAllowedPath(path)) return json({ error: 'Bu uç noktaya izin verilmiyor' }, 403);

  const params = [...url.searchParams].filter(([k]) => k !== 'path');
  try {
    const { status, text } = await massiveGet(path, params, key);
    return new Response(text, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
  } catch {
    return json({ error: 'Massive API yanıt vermedi' }, 502);
  }
}
