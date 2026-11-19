import { getSession, json } from '../lib/session.js';
import { logEvents } from '../lib/activity.js';
import { storeConfigured, cmd } from '../lib/store.js';

// POST { events: [{type, detail}] } from the app, for the admin portal's activity log.
export async function POST(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!storeConfigured()) return json({ ok: true, stored: false });
  if (Number(request.headers.get('content-length') || 0) > 8000) return json({ error: 'too large' }, 413);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const events = Array.isArray(body && body.events) ? body.events.slice(0, 30) : [];
  try { // at most 300 events per user per minute
    const k = `os:rl:${s.email}:${Math.floor(Date.now() / 60000)}`;
    const n = await cmd(['INCRBY', k, String(events.length || 1)]); await cmd(['EXPIRE', k, '120']);
    if (n > 300) return json({ ok: true, dropped: true });
  } catch { /* still log */ }
  await logEvents(s.email, events, { name: s.name, country: request.headers.get('x-vercel-ip-country') || '' });
  return json({ ok: true });
}
