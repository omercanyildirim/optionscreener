import { getSession, json } from '../lib/session.js';
import { storeConfigured, getUserData, setUserData, sanitizeUserData } from '../lib/store.js';

// Each signed-in user's saved filters (presets), tracked contracts and watchlist.
export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ configured: false });
  try {
    const data = await getUserData(s.email);
    return json({ configured: true, data: data || null });
  } catch (e) {
    return json({ configured: true, error: 'Veritabanına ulaşılamadı' }, 502);
  }
}

export async function PUT(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ error: 'Veritabanı bağlı değil' }, 503);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 300000) return json({ error: 'Veri çok büyük' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Geçersiz JSON' }, 400); }
  let clean;
  try { clean = sanitizeUserData(body); } catch (e) { return json({ error: e.message }, 400); }
  clean.updatedAt = Date.now();
  try {
    await setUserData(s.email, clean);
  } catch {
    return json({ error: 'Veritabanına yazılamadı' }, 502);
  }
  return json({ ok: true, data: clean });
}
