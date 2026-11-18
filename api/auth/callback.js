import { sign, verify, readCookie, cookie, allowedEmails, STATE_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE } from '../../lib/session.js';
import { appOrigin, safeNext } from './login.js';

function decodeJwtPayload(jwt) {
  const part = jwt.split('.')[1];
  const s = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0))));
}

function page(title, text, status) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#1a1a1a">
<h1 style="font-size:18px;font-weight:600">${title}</h1><p>${text}</p><p><a href="/api/auth/login">Başka bir hesapla dene</a></p></body>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': cookie(STATE_COOKIE, '', 0) } });
}

export async function GET(request) {
  const env = process.env;
  const url = new URL(request.url);
  const st = await verify(readCookie(request.headers.get('cookie'), STATE_COOKIE), env.SESSION_SECRET);
  if (!st || st.state !== url.searchParams.get('state')) return page('Giriş tamamlanamadı', 'Oturum isteği geçersiz ya da süresi doldu.', 400);
  if (url.searchParams.get('error')) return page('Giriş iptal edildi', 'Google girişi tamamlanmadı.', 400);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${appOrigin(request)}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return page('Giriş tamamlanamadı', 'Google token isteği başarısız oldu.', 502);
  const { id_token } = await res.json();
  if (!id_token) return page('Giriş tamamlanamadı', 'Google kimlik bilgisi döndürmedi.', 502);

  // The ID token came straight from Google's token endpoint over TLS in exchange for our
  // client secret, so its claims can be trusted; we still check audience, issuer and expiry.
  const c = decodeJwtPayload(id_token);
  const now = Math.floor(Date.now() / 1000);
  if (c.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.exp < now || !c.email_verified) {
    return page('Giriş tamamlanamadı', 'Google kimlik bilgisi doğrulanamadı.', 401);
  }
  const email = String(c.email).toLowerCase();
  if (!allowedEmails(env).includes(email)) {
    return page('Erişim yok', `${email} bu siteye erişim listesinde değil.`, 403);
  }

  const session = await sign({ email, name: c.name || '', exp: now + SESSION_MAX_AGE }, env.SESSION_SECRET);
  const headers = new Headers({ location: safeNext(st.next), 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(SESSION_COOKIE, session, SESSION_MAX_AGE));
  headers.append('set-cookie', cookie(STATE_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}
