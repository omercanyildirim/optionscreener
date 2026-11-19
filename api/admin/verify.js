import { json } from '../../lib/session.js';
import { getAdminSession, getTotpSecret, adminCookie, clearAdminCookie, checkCode, tooManyFails, noteFail, clearFails } from '../../lib/admin.js';

// POST { code } -> admin access for 12 hours.   DELETE -> leave the admin portal.
export async function POST(request) {
  const s = await getAdminSession(request);
  if (!s) return json({ error: 'forbidden' }, 403);
  const t = await getTotpSecret(s.email);
  if (!t) return json({ error: 'Set up Google Authenticator first.' }, 409);
  if (await tooManyFails(s.email)) return json({ error: 'Too many wrong codes. Try again in 15 minutes.' }, 429);
  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  if (!(await checkCode(s.email, t.secret, body.code))) {
    await noteFail(s.email);
    return json({ error: 'That code is not right, or it was already used. Enter the newest code.' }, 400);
  }
  await clearFails(s.email);
  return json({ ok: true }, 200, { 'set-cookie': await adminCookie(s.email) });
}
export async function DELETE() {
  return json({ ok: true }, 200, { 'set-cookie': clearAdminCookie() });
}
