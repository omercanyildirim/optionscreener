import { cookie, SESSION_COOKIE } from '../../lib/session.js';

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { location: '/api/auth/signed-out', 'set-cookie': cookie(SESSION_COOKIE, '', 0), 'cache-control': 'no-store' },
  });
}
