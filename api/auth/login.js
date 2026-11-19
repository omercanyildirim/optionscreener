import { sign, cookie, STATE_COOKIE, json } from '../../lib/session.js';
import { LEGAL_VERSION } from '../../lib/legal.js';

export function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

// Use the address the visitor actually opened (custom domain or vercel.app) so the
// state cookie and Google's callback stay on the same host. Both callback URLs must be
// registered in Google Cloud. APP_URL is only a fallback for non-HTTPS (local) runs.
export function appOrigin(request) {
  const origin = new URL(request.url).origin;
  return (origin.startsWith('https://') ? origin : (process.env.APP_URL || origin)).replace(/\/$/, '');
}

export async function GET(request) {
  const env = process.env;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return json({ error: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET must be set' }, 500);
  }
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  // Sign-in needs the visitor to accept the current Terms, Privacy and Refund Policy on the sign-in page.
  if (url.searchParams.get('consent') !== LEGAL_VERSION) {
    return new Response(null, { status: 302, headers: { location: '/login?consent=required' + (next !== '/' ? '&next=' + encodeURIComponent(next) : ''), 'cache-control': 'no-store' } });
  }
  const state = crypto.randomUUID();
  const stateToken = await sign({ state, next, consent: LEGAL_VERSION, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);

  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  google.searchParams.set('redirect_uri', `${appOrigin(request)}/api/auth/callback`);
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('scope', 'openid email profile');
  google.searchParams.set('state', state);
  google.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: { location: google.toString(), 'set-cookie': cookie(STATE_COOKIE, stateToken, 600), 'cache-control': 'no-store' },
  });
}
