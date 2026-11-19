import { cookie, getSession, SESSION_COOKIE } from '../../lib/session.js';
import { ADMIN_COOKIE } from '../../lib/admin.js';
import { logEvent } from '../../lib/activity.js';

export async function GET(request) {
  const s = await getSession(request);
  if (s) await logEvent(s.email, 'logout', '');
  const headers = new Headers({ location: '/api/auth/signed-out', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(SESSION_COOKIE, '', 0));
  headers.append('set-cookie', cookie(ADMIN_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}
