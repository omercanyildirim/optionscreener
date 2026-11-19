import { getSession, json, cookie, SESSION_COOKIE } from '../lib/session.js';
import { recordConsent, exportData, deleteAccount } from '../lib/legal.js';
import { storeConfigured, getUserData, setUserData, sanitizeUserData } from '../lib/store.js';
import { logEvent } from '../lib/activity.js';
// POST = activity events from the app (/api/track is rewritten here in vercel.json).
export { POST } from '../lib/handlers/track.js';

const action = request => new URL(request.url).searchParams.get('a') || '';
const clientIp = request => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';

// Each signed-in user's saved filters (presets), tracked contracts and watchlist.
// GET ?a=export downloads everything stored about the user (GDPR / KVKK access and portability).
export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ configured: false });
  if (action(request) === 'export') {
    try {
      const data = await exportData(s.email);
      await logEvent(s.email, 'data_export', 'downloaded own data');
      return new Response(JSON.stringify(data, null, 2), { headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': 'attachment; filename="optionscreener-my-data.json"' } });
    } catch { return json({ error: 'Could not reach the database' }, 502); }
  }
  try {
    const data = await getUserData(s.email);
    return json({ configured: true, data: data || null });
  } catch (e) {
    return json({ configured: true, error: 'Could not reach the database' }, 502);
  }
}

// DELETE = erase the account and everything stored about it (GDPR / KVKK erasure), then sign out.
export async function DELETE(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ error: 'Database is not connected' }, 503);
  let r; try { r = await deleteAccount(s.email); } catch { return json({ error: 'Could not reach the database' }, 502); }
  if (r.error) return json({ error: r.error }, r.status || 400);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': cookie(SESSION_COOKIE, '', 0) } });
}

export async function PUT(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ error: 'Database is not connected' }, 503);
  // PUT ?a=consent: a signed-in user accepts the current Terms, Privacy and Refund Policy.
  if (action(request) === 'consent') { await recordConsent(s.email, { ip: clientIp(request), how: 'in-app' }); return json({ ok: true }); }
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 300000) return json({ error: 'Data is too large' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  let clean;
  try { clean = sanitizeUserData(body); } catch (e) { return json({ error: e.message }, 400); }
  clean.updatedAt = Date.now();
  try {
    await setUserData(s.email, clean);
  } catch {
    return json({ error: 'Could not write to the database' }, 502);
  }
  await logEvent(s.email, 'settings_saved', `${clean.presets.length} filters, ${clean.tracked.length} watched contracts`);
  return json({ ok: true, data: clean });
}
