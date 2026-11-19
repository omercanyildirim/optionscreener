// /api/admin?a=status|overview (GET), ?a=setup|verify (POST), ?a=verify (DELETE).
// One function for all admin routes (the Hobby plan allows 12 functions per deployment).
import { getSession, json, allowedEmails, adminEmails } from '../lib/session.js';
import { isAdminEmail, getAdminSession, getVerifiedAdmin, getTotpSecret, saveTotpSecret, adminCookie, clearAdminCookie, checkCode, tooManyFails, noteFail, clearFails } from '../lib/admin.js';
import { newSecret, otpauthUri, base32Decode } from '../lib/totp.js';
import { storeConfigured } from '../lib/store.js';
import { logEvent, overview, userDetail } from '../lib/activity.js';
import { alpacaConfigured } from '../lib/alpaca.js';

const action = request => new URL(request.url).searchParams.get('a') || '';

export async function GET(request) {
  const a = action(request);
  if (a === 'status') return status(request);
  if (a === 'overview') return overviewGet(request);
  return json({ error: 'not found' }, 404);
}
export async function POST(request) {
  const a = action(request);
  if (a === 'setup') return setup(request);
  if (a === 'verify') return verifyPost(request);
  return json({ error: 'not found' }, 404);
}
export async function DELETE(request) {
  if (action(request) === 'verify') return json({ ok: true }, 200, { 'set-cookie': clearAdminCookie() });
  return json({ error: 'not found' }, 404);
}

async function status(request) {
  const s = await getSession(request);
  if (!s) return json({ error: 'unauthorized' }, 401);
  if (!isAdminEmail(s.email)) return json({ admin: false, email: s.email });
  const t = await getTotpSecret(s.email);
  return json({
    admin: true, email: s.email, name: s.name || '',
    totpConfigured: !!t, totpSource: t ? t.source : null,
    verified: !!(await getVerifiedAdmin(request)),
    store: storeConfigured(),
  });
}

async function setup(request) {
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

async function verifyPost(request) {
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
async function overviewGet(request) {
  if (!(await getVerifiedAdmin(request))) return json({ error: 'forbidden' }, 403);
  const list = allowedEmails(process.env);
  const site = {
    access: list.includes('*') ? 'Any Google account' : `${list.length} listed account(s)`,
    admins: adminEmails().length,
    provider: alpacaConfigured() ? 'Alpaca' : process.env.MASSIVE_API_KEY ? 'Massive' : 'none',
  };
  if (!storeConfigured()) return json({ store: false, site, users: [], events: [] });
  const email = new URL(request.url).searchParams.get('email');
  try {
    if (email) return json({ store: true, ...(await userDetail(email)) });
    return json({ store: true, site, ...(await overview()) });
  } catch {
    return json({ error: 'Could not read the database' }, 502);
  }
}
