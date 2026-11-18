import { getSession, json } from '../lib/session.js';

export async function GET(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  return json({
    email: s.email,
    name: s.name,
    pollMs: Math.max(1000, +(process.env.POLL_MS || 2000)),
    keyConfigured: !!process.env.MASSIVE_API_KEY,
  });
}
