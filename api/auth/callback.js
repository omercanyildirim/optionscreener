import { sign, verify, readCookie, cookie, isAllowed, STATE_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE } from '../../lib/session.js';
import { appOrigin, safeNext } from './login.js';
import { logEvent, saveProfile } from '../../lib/activity.js';
import { recordConsent, setMarketing, LEGAL_VERSION } from '../../lib/legal.js';
import { sendWelcome } from '../../lib/comms.js';
import { dbConfigured } from '../../lib/db.js';
import { storeConfigured, cmd } from '../../lib/store.js';

function decodeJwtPayload(jwt) {
  const part = jwt.split('.')[1];
  const s = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0))));
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, text, status) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font:15px/1.5 system-ui,sans-serif;background:#141518;color:#ececee;margin:0;min-height:100vh;display:grid;place-items:center;padding:20px">
<div style="background:#232428;border-radius:14px;padding:32px;max-width:420px;width:100%"><h1 style="font-size:19px;font-weight:600;margin:0 0 10px">${esc(title)}</h1>
<p style="color:#8c8e96;margin:0 0 22px">${esc(text)}</p><a href="/login" style="display:inline-block;background:#f2b51d;color:#141518;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none">Back to sign in</a></div></body>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': cookie(STATE_COOKIE, '', 0) } });
}

export async function GET(request) {
  const env = process.env;
  const url = new URL(request.url);
  const st = await verify(readCookie(request.headers.get('cookie'), STATE_COOKIE), env.SESSION_SECRET);
  if (!st || st.state !== url.searchParams.get('state')) return page('Sign-in failed', 'The sign-in request is invalid or has expired.', 400);
  if (url.searchParams.get('error')) return page('Sign-in cancelled', 'Google sign-in was not completed.', 400);

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
  if (!res.ok) return page('Sign-in failed', 'The Google token request failed.', 502);
  const { id_token } = await res.json();
  if (!id_token) return page('Sign-in failed', 'Google did not return an identity token.', 502);

  // The ID token came straight from Google's token endpoint over TLS in exchange for our
  // client secret, so its claims can be trusted; we still check audience, issuer and expiry.
  const c = decodeJwtPayload(id_token);
  const now = Math.floor(Date.now() / 1000);
  if (c.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.exp < now || !c.email_verified) {
    return page('Sign-in failed', 'The Google identity token could not be verified.', 401);
  }
  const email = String(c.email).toLowerCase();
  if (!isAllowed(email, env)) {
    return page('No access', `${email} is not on this site's access list.`, 403);
  }

  const session = await sign({ email, name: c.name || '', exp: now + SESSION_MAX_AGE }, env.SESSION_SECRET);
  const h = n => request.headers.get(n) || '';
  const dec = v => { try { return decodeURIComponent(v); } catch { return v; } };
  await saveProfile(email, {
    name: c.name, givenName: c.given_name, familyName: c.family_name, picture: c.picture, locale: c.locale,
    googleId: c.sub, domain: c.hd, country: h('x-vercel-ip-country'), region: dec(h('x-vercel-ip-country-region')), city: dec(h('x-vercel-ip-city')),
    ip: (h('x-forwarded-for').split(',')[0] || h('x-real-ip')).trim(), device: h('user-agent'), lastLogin: new Date().toISOString(),
  });
  const ip = (h('x-forwarded-for').split(',')[0] || h('x-real-ip')).trim();
  if (st.consent === LEGAL_VERSION) await recordConsent(email, { ip, how: 'sign-in' });
  if (st.mkt) { try { await setMarketing(email, true, { ip, how: 'sign-in checkbox', ua: h('user-agent') }); } catch { /* never block sign-in */ } }
  // A brand-new account gets the welcome email once (first seen in the last 10 minutes). Never blocks sign-in.
  if (dbConfigured() && storeConfigured()) {
    try {
      const first = +(await cmd(['HGET', `os:u:${email}`, 'first'])) || 0;
      if (first && Date.now() - first < 10 * 60 * 1000) await Promise.race([sendWelcome(email), new Promise(r => setTimeout(r, 4000))]);
    } catch { /* the email can fail; sign-in goes on */ }
  }
  await logEvent(email, 'login', (request.headers.get('user-agent') || '').slice(0, 120), { name: c.name || '', country: request.headers.get('x-vercel-ip-country') || '' });
  const headers = new Headers({ location: safeNext(st.next), 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(SESSION_COOKIE, session, SESSION_MAX_AGE));
  headers.append('set-cookie', cookie(STATE_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}
