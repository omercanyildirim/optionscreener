// Admin portal access: Google sign-in with an ADMIN_EMAILS address + a Google Authenticator code.
import { getSession, sign, verify, readCookie, cookie, adminEmails } from './session.js';
import { storeConfigured, cmd } from './store.js';
import { verifyTotp } from './totp.js';

export const ADMIN_COOKIE = 'os_admin';
export const ADMIN_MAX_AGE = 12 * 3600; // the code is asked again every 12 hours
const adminSecret = () => (process.env.SESSION_SECRET || '') + ':admin-2fa';
const totpKey = email => `os:admin:totp:${email}`;

export const isAdminEmail = email => adminEmails().includes(String(email || '').toLowerCase());

// Google session of an admin (first factor only).
export async function getAdminSession(request) {
  const s = await getSession(request);
  return s && isAdminEmail(s.email) ? s : null;
}
// Both factors: admin Google session + a valid admin cookie for the same account.
export async function getVerifiedAdmin(request) {
  const s = await getAdminSession(request);
  if (!s) return null;
  const a = await verify(readCookie(request.headers.get('cookie'), ADMIN_COOKIE), adminSecret());
  return a && a.email === s.email && a.mfa === true ? s : null;
}
export async function adminCookie(email) {
  return cookie(ADMIN_COOKIE, await sign({ email, mfa: true, exp: Math.floor(Date.now() / 1000) + ADMIN_MAX_AGE }, adminSecret()), ADMIN_MAX_AGE);
}
export const clearAdminCookie = () => cookie(ADMIN_COOKIE, '', 0);

// The Authenticator secret: ADMIN_TOTP_SECRET in Vercel, or saved in Redis during setup.
export async function getTotpSecret(email) {
  if (process.env.ADMIN_TOTP_SECRET) return { secret: process.env.ADMIN_TOTP_SECRET.replace(/\s/g, '').toUpperCase(), source: 'env' };
  if (storeConfigured()) {
    try { const v = await cmd(['GET', totpKey(email)]); if (v) return { secret: v, source: 'store' }; } catch { /* unknown */ }
  }
  return null;
}
// Saves the secret only if none exists yet (setup can never replace an enrolled authenticator).
export async function saveTotpSecret(email, secret) {
  return (await cmd(['SET', totpKey(email), secret, 'NX'])) === 'OK';
}

// Wrong codes: at most 5 per 15 minutes. A code that was used once cannot be used again.
const memFails = new Map();
export async function tooManyFails(email) {
  if (storeConfigured()) { try { return (+(await cmd(['GET', `os:admin:fail:${email}`])) || 0) >= 5; } catch { /* memory */ } }
  const f = memFails.get(email); return !!f && f.n >= 5 && Date.now() - f.at < 15 * 60e3;
}
export async function noteFail(email) {
  if (storeConfigured()) { try { await cmd(['INCR', `os:admin:fail:${email}`]); await cmd(['EXPIRE', `os:admin:fail:${email}`, '900']); return; } catch { /* memory */ } }
  const f = memFails.get(email); memFails.set(email, { n: f && Date.now() - f.at < 15 * 60e3 ? f.n + 1 : 1, at: Date.now() });
}
export async function clearFails(email) {
  memFails.delete(email);
  if (storeConfigured()) { try { await cmd(['DEL', `os:admin:fail:${email}`]); } catch { /* ignore */ } }
}
const memSteps = new Map();
async function stepUnused(email, step) {
  if (storeConfigured()) {
    try { return (await cmd(['SET', `os:admin:step:${email}:${step}`, '1', 'NX', 'EX', '120'])) === 'OK'; } catch { /* memory */ }
  }
  const k = `${email}:${step}`; if (memSteps.has(k)) return false; memSteps.set(k, Date.now());
  if (memSteps.size > 200) memSteps.delete(memSteps.keys().next().value);
  return true;
}
export async function checkCode(email, secret, code) {
  const step = await verifyTotp(secret, code);
  return step != null && (await stepUnused(email, step));
}
