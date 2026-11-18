import { sign, cookie, STATE_COOKIE, json } from '../../lib/session.js';

export function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

export function appOrigin(request) {
  return (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
}

export async function GET(request) {
  const env = process.env;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return json({ error: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ve SESSION_SECRET ortam değişkenleri tanımlı değil' }, 500);
  }
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const next = safeNext(url.searchParams.get('next'));
  const stateToken = await sign({ state, next, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);

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
