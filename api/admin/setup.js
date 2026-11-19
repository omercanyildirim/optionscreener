import { json } from '../../lib/session.js';
import { getAdminSession, getTotpSecret, saveTotpSecret, adminCookie, checkCode, tooManyFails, noteFail, clearFails } from '../../lib/admin.js';
import { newSecret, otpauthUri, base32Decode } from '../../lib/totp.js';
import { storeConfigured } from '../../lib/store.js';
import { logEvent } from '../../lib/activity.js';

// Authenticator setup, only while none is enrolled.
// POST {}                -> { secret, uri }  a new secret to scan
// POST { secret, code }  -> checks the code, then saves the secret (database) or asks for ADMIN_TOTP_SECRET in Vercel
export async function POST(request) {
  const s = await getAdminSession(request);
  if (!s) return json({ error: 'forbidden' }, 403);
  if (await getTotpSecret(s.email)) return json({ error: 'An authenticator is already set up.' }, 409);
  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  if (!body.secret) {
    const secret = newSecret();
    return json({ secret, uri: otpauthUri(secret, s.email) });
  }
  const secret = String(body.secret).toUpperCase().replace(/\s/g, '');
  try { if (base32Decode(secret).length < 16) throw new Error(); } catch { return json({ error: 'Invalid secret' }, 400); }
  if (await tooManyFails(s.email)) return json({ error: 'Too many wrong codes. Try again in 15 minutes.' }, 429);
  if (!(await checkCode(s.email, secret, body.code))) {
    await noteFail(s.email);
    return json({ error: 'That code is not right. Check the time on your phone and enter the newest code.' }, 400);
  }
  await clearFails(s.email);
  if (storeConfigured()) {
    if (!(await saveTotpSecret(s.email, secret))) return json({ error: 'An authenticator is already set up.' }, 409);
    await logEvent(s.email, 'settings_saved', 'admin authenticator set up');
    return json({ ok: true, stored: true }, 200, { 'set-cookie': await adminCookie(s.email) });
  }
  return json({ ok: true, stored: false, envName: 'ADMIN_TOTP_SECRET' });
}
